# Bitbucket Connector

> **New connector.** Structured to parallel the GitHub connector's checks (`docs/connectors/github.md`) and the GitLab connector (`docs/connectors/gitlab.md`) so all three VCS connectors read consistently — same naming shape, same severity choices where the underlying control is equivalent, same ISO mappings. Follows the existing connector module pattern in `api/src/connectors/<key>/index.js`.

## 1. Overview

- **Category**: `devops` (matches GitHub's and GitLab's `integrations.category` value).
- **Connector key**: `bitbucket` (new — to be added to `api/src/connectors/registry.js`).
- **Scope**: Workspace, users, repositories, permissions, branch restrictions, pipelines.
- **Parallel to GitHub/GitLab**: 2FA enforcement (workspace-level, parallels `github.org.two_factor_required` / `gitlab.group.two_factor_required`), branch restriction / merge-check review requirements (parallels the branch-protection checks in both other connectors), pipeline variable secrecy (parallels `gitlab.project.ci_variables_protected_and_masked`), and repo visibility/permission audit (parallels `gitlab.project.visibility_restricted`).
- **Known coverage gap, called out honestly rather than glossed over**: Bitbucket Cloud's REST API does not expose a queryable field for workspace-enforced two-step verification the way GitHub's `two_factor_requirement_enabled` or GitLab's `require_two_factor_authentication` do. The check below is still proposed (parity matters for a reviewer comparing all three connectors), but its `run()` should follow the same "can't observe it → `not_applicable`, don't fabricate a fail" precedent already established by `checkTwoFactorRequired` in `api/src/connectors/github/tests/access.js` for GitHub's own "field absent" case. Confirm the exact field during implementation against a live workspace before assuming it's fully unavailable — Atlassian's docs describe the *setting* but not a documented API field for reading it back.

## 2. Authentication

`auth_type`: `oauth2` — Bitbucket Cloud's workspace-level **OAuth2 consumer** is the closest real analogue to GitHub's App model (a credential registered against the workspace rather than tied to one user's PAT), so this is the right fit among the four allowed `auth_type` values, unlike GitLab where no such workspace-scoped OAuth app exists as the primary pattern.

### Setup steps (OAuth2 consumer, workspace-level)

1. In Bitbucket, go to the target **workspace > Settings > OAuth consumers** (Workspace admin required).
2. Click **Add consumer**. Give it a name (`Prism Evidence Collection`) and a callback URL (required by the form even for the client-credentials-style flow Prism uses — Bitbucket's app-password/API-token alternatives are being deprecated in favor of this consumer + scoped access token model, so this is the forward-looking choice).
3. Under **Permissions**, select scopes:
   - **Account: Read** (`account`) — read workspace/user identity, used by `testConnection`.
   - **Workspace membership: Read** (`team`) — enumerate workspace members and their permission levels (needed for the owner/admin-count check).
   - **Repositories: Read** (`repository`) — enumerate repos, branch restrictions, default branch.
   - **Pipelines: Read** (`pipeline`) — read pipeline configuration and variable metadata (not values — masked "secured" variables never return their value via the API, same principle as GitLab's `masked` variables).
   - **Webhooks: Read** (`webhook`) — only needed if a future webhook-configuration check is added; include now to avoid a second permissions round-trip later, or omit if strictly minimizing scope — either is defensible, note the tradeoff to whoever configures the consumer.
4. Save. Bitbucket issues a **Key** and **Secret** for the consumer.
5. Prism exchanges the Key/Secret for a workspace access token via Bitbucket's OAuth2 client-credentials grant (`POST https://bitbucket.org/site/oauth2/access_token` with `grant_type=client_credentials`), which is scoped to the consumer's configured permissions and does not require a per-user authorization redirect — this is what makes it usable for unattended evidence collection rather than a 3-legged user-authorization flow.
6. In Prism, add a Bitbucket connection with `config.workspace` (the workspace slug), and store `secret.clientId` / `secret.clientSecret` (the OAuth consumer's Key/Secret) — Prism's `credentials.js` performs the client-credentials token exchange per collection run (tokens are short-lived, similar in spirit to GitHub App installation tokens, so no refresh-token storage is needed).

### `config` / `secret` shapes

```json
// integration_connections.config
{
  "workspace": "my-bitbucket-workspace"
}
```

```json
// integration_credentials (decrypted secret shape)
{
  "clientId": "abcXYZ123consumerKey",
  "clientSecret": "abcXYZ123consumerSecret"
}
```

## 3. API Reference

- **Base URL**: `https://api.bitbucket.org/2.0/` (single base URL for all Bitbucket Cloud REST resources; there is no separate self-managed variant to account for here — Bitbucket Server/Data Center is a different, unrelated product not covered by this connector).
- **OAuth2 token endpoint**: `https://bitbucket.org/site/oauth2/access_token` (note: `bitbucket.org`, not `api.bitbucket.org` — a common integration mistake worth calling out to whoever implements `credentials.js`).
- **Pagination**: cursor-style — every collection response is `{ values: [...], page, pagelen, next }`; follow `next` (a full URL) until absent, rather than constructing page numbers manually. Request a larger page size via `?pagelen=100` (100 is the practical max for most endpoints) to reduce round-trips.
- **Rate limits**: base 1,000 requests/hour per workspace for workspaces up to 100 seats, scaling with paid seats up to a 10,000/hour cap; exceeding the limit returns `429` (no `Retry-After`-equivalent header parsing exists in the current GitHub connector to copy from directly — this will need its own handling, checking Bitbucket's documented rate-limit response headers during implementation).
- **Endpoints needed**:
  - `GET /2.0/workspaces/{workspace}` — workspace identity, used by `testConnection`
  - `GET /2.0/workspaces/{workspace}/members` (paginated) — member list + permission level, for owner-count and (best-effort) 2FA-adjacent checks
  - `GET /2.0/workspaces/{workspace}/permissions` — per-member permission role (`owner`/`collaborator`/`member`)
  - `GET /2.0/repositories/{workspace}` (paginated) — repository enumeration, `is_private`, `mainbranch.name`
  - `GET /2.0/repositories/{workspace}/{repo_slug}/branch-restrictions` — branch restriction rules (`kind`: `push`, `require_approvals_to_merge`, `restrict_merges`, etc.), each with a `pattern` and, where applicable, `value` (e.g. minimum approval count)
  - `GET /2.0/repositories/{workspace}/{repo_slug}/pipelines_config` — whether Pipelines is enabled for the repo
  - `GET /2.0/repositories/{workspace}/{repo_slug}/pipelines_config/variables` — pipeline variables with `secured` (boolean) flag (values redacted when `secured: true`)

## 4. Proposed Checks (7)

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `bitbucket.workspace.two_factor_enforced` | Workspace enforces two-step verification | critical | A.9.4.2 | Checks the workspace enforces two-step verification for all members, parallel to `github.org.two_factor_required` / `gitlab.group.two_factor_required`. Returns `not_applicable` if this isn't observable via the API with the granted scopes (see the coverage-gap note in Overview), rather than reporting a false "fail". | Enable "Require two-step verification" under Workspace settings > Security (requires a paid plan). |
| `bitbucket.repo.branch_restriction_no_direct_push` | Default branch restricts direct pushes | high | A.14.2.2 | Checks a `push` branch restriction exists on the repository's main branch (`GET .../branch-restrictions`), preventing pushes that bypass pull requests. | Add a branch restriction of kind "Push" on the main branch, scoped to no users/groups (or only designated release managers), under Repository settings > Branch restrictions. |
| `bitbucket.repo.merge_checks_minimum_approvals` | Default branch requires minimum approvals before merge | high | A.14.2.2 | Checks a `require_approvals_to_merge` branch restriction exists on the main branch with `value >= 1`, the direct analogue of `github.repo.branch_protection_required_reviews` / `gitlab.project.merge_request_approvals_required`. | Add a branch restriction of kind "require approval(s)" on the main branch with a minimum of 1 required approval, under Repository settings > Branch restrictions. |
| `bitbucket.repo.pipelines_enabled` | Pipelines (CI/CD) is enabled | medium | A.14.2.2 | Checks `GET .../pipelines_config` reports Pipelines enabled for the repository, establishing that build/test automation runs on changes before merge. | Enable Pipelines under Repository settings > Pipelines > Settings. |
| `bitbucket.pipeline.variables_secured` | Pipeline variables are secured | high | A.9.4.1 | Checks every pipeline variable (`GET .../pipelines_config/variables`) has `secured: true`, so values are encrypted at rest and redacted from build logs, parallel to `gitlab.project.ci_variables_protected_and_masked`. | Edit each pipeline variable under Repository settings > Pipelines > Repository variables and enable "Secured". |
| `bitbucket.workspace.owners_count_minimized` | Workspace owner role is limited to necessary personnel | medium | A.9.2.3 | Checks the number of workspace members with the `owner` permission level (`GET .../workspaces/{workspace}/members` cross-referenced with `.../permissions`) does not exceed a defined threshold (default 5), parallel to `github.org.owners_count_minimized` / `gitlab.group.owners_count_minimized`. | Review the workspace's member list under Workspace settings > User groups / Members and demote accounts that don't require full Owner-level access. |
| `bitbucket.repo.visibility_restricted` | Repository is private | medium | A.8.2.3 | Checks each repository's `is_private` field is `true`, parallel to `gitlab.project.visibility_restricted`. | Change the repository to private under Repository settings > General > Repository details. |

## 5. Seed SQL

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('bitbucket', 'Bitbucket', 'devops', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('bitbucket', 'bitbucket.workspace.two_factor_enforced', 'Workspace enforces two-step verification', 'Checks the workspace enforces two-step verification for all members where observable via the API.', 'critical', 'Enable "Require two-step verification" under Workspace settings > Security (requires a paid plan).'),
  ('bitbucket', 'bitbucket.repo.branch_restriction_no_direct_push', 'Default branch restricts direct pushes', 'Checks a push branch restriction exists on the repository''s main branch, preventing pushes that bypass pull requests.', 'high', 'Add a branch restriction of kind "Push" on the main branch under Repository settings > Branch restrictions.'),
  ('bitbucket', 'bitbucket.repo.merge_checks_minimum_approvals', 'Default branch requires minimum approvals before merge', 'Checks the main branch requires at least one approval before a pull request can be merged.', 'high', 'Add a branch restriction requiring at least 1 approval on the main branch under Repository settings > Branch restrictions.'),
  ('bitbucket', 'bitbucket.repo.pipelines_enabled', 'Pipelines (CI/CD) is enabled', 'Checks Pipelines is enabled for the repository.', 'medium', 'Enable Pipelines under Repository settings > Pipelines > Settings.'),
  ('bitbucket', 'bitbucket.pipeline.variables_secured', 'Pipeline variables are secured', 'Checks every pipeline variable is marked secured so values are encrypted at rest and redacted from build logs.', 'high', 'Edit each pipeline variable under Repository settings > Pipelines > Repository variables and enable "Secured".'),
  ('bitbucket', 'bitbucket.workspace.owners_count_minimized', 'Workspace owner role is limited to necessary personnel', 'Checks the number of workspace Owners does not exceed a defined threshold, flagging excessive standing privileged access.', 'medium', 'Review the workspace''s member list and demote accounts that don''t require full Owner-level access.'),
  ('bitbucket', 'bitbucket.repo.visibility_restricted', 'Repository is private', 'Checks each repository is private rather than public.', 'medium', 'Change the repository to private under Repository settings > General > Repository details.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('bitbucket.workspace.two_factor_enforced', 'A.9.4.2'),
  ('bitbucket.repo.branch_restriction_no_direct_push', 'A.14.2.2'),
  ('bitbucket.repo.merge_checks_minimum_approvals', 'A.14.2.2'),
  ('bitbucket.repo.pipelines_enabled', 'A.14.2.2'),
  ('bitbucket.pipeline.variables_secured', 'A.9.4.1'),
  ('bitbucket.workspace.owners_count_minimized', 'A.9.2.3'),
  ('bitbucket.repo.visibility_restricted', 'A.8.2.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `bitbucket` (new) — register in `api/src/connectors/registry.js`:
  ```js
  import * as bitbucket from "./bitbucket/index.js";
  const connectors = { [aws.key]: aws, [azure.key]: azure, [github.key]: github, [gitlab.key]: gitlab, [bitbucket.key]: bitbucket, [purview.key]: purview };
  ```
- **Files to add** (mirroring `api/src/connectors/github/` layout):
  - `api/src/connectors/bitbucket/credentials.js` — `resolveBitbucketCredentials({ authType, config, secret })`, validates `authType === "oauth2"`, performs the client-credentials token exchange against `https://bitbucket.org/site/oauth2/access_token` using `secret.clientId`/`secret.clientSecret`, returns an authenticated client bound to `config.workspace`.
  - `api/src/connectors/bitbucket/index.js` — exports `key = "bitbucket"`, `tests`, `testConnection`, `runTests`; builds `clients = { api, workspace, repos }` (fetch workspace + paginate repos once per run, same shape as GitHub's `buildClients`).
  - `api/src/connectors/bitbucket/tests/access.js` — `bitbucket.workspace.two_factor_enforced`, `bitbucket.workspace.owners_count_minimized`.
  - `api/src/connectors/bitbucket/tests/branchRestrictions.js` — `bitbucket.repo.branch_restriction_no_direct_push`, `bitbucket.repo.merge_checks_minimum_approvals`.
  - `api/src/connectors/bitbucket/tests/pipelines.js` — `bitbucket.repo.pipelines_enabled`, `bitbucket.pipeline.variables_secured`.
  - `api/src/connectors/bitbucket/tests/repos.js` — `bitbucket.repo.visibility_restricted`.
- **Files to edit**: `init.sql` (append seed blocks above, following the same `-- ===== <X> connector: catalog seed data =====` comment convention), `api/src/connectors/registry.js`.
- **Client library**: no single dominant maintained client library exists for Bitbucket Cloud's v2.0 API the way `@gitbeaker/rest` covers GitLab or `@octokit/rest` covers GitHub (the `bitbucket` npm package targets the older v1 API and is largely unmaintained) — use raw `fetch` against `https://api.bitbucket.org/2.0/`, following the `next`-URL cursor pagination pattern, with a small internal helper (`paginate(url)`) analogous to `octokit.paginate()` rather than pulling in an unmaintained dependency.
- **Token refresh**: unlike GitHub's App installation tokens (handled transparently by `@octokit/auth-app`), the Bitbucket client-credentials exchange has no SDK to lean on — `credentials.js` needs to request a fresh token at the start of each `testConnection`/`runTests` call (tokens are short-lived, ~2 hours) rather than caching one across runs, matching the "resolve fresh per invocation" pattern `resolveGithubCredentials` and `resolveAwsCredentials` already use.
- **2FA check caveat**: confirm during implementation whether `GET /2.0/workspaces/{workspace}` or `/2.0/workspaces/{workspace}/settings` (if such an endpoint exists) actually surfaces enforced-2FA state before writing `bitbucket.workspace.two_factor_enforced`'s `run()`. If no field is found, the check should still ship but always return `not_applicable` with a message noting manual verification is required — do not silently drop the check, since a reviewer comparing the three connectors will expect to see it listed even if Bitbucket's API can't back it fully.
