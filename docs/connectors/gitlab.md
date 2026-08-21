# GitLab Connector

> **New connector.** Structured to parallel the GitHub connector's checks (`docs/connectors/github.md`) so a reviewer sees consistent naming/severity/ISO-mapping conventions across `github`/`gitlab`/`bitbucket`. Follows the existing connector module pattern in `api/src/connectors/<key>/index.js` (see `api/src/connectors/github/index.js` as reference).

## 1. Overview

- **Category**: `devops` (matches GitHub's existing `integrations.category` value — keeps all VCS connectors grouped together in the UI).
- **Connector key**: `gitlab` (new — to be added to `api/src/connectors/registry.js`).
- **Scope**: Groups, users, repositories (projects), protected branches, CI/CD, secrets.
- **Parallel to GitHub**: 2FA/SSO enforcement (group-level, parallels `github.org.two_factor_required`), protected/default branch review requirements (parallels `github.repo.branch_protection_required_reviews`), CI/CD variable/secret exposure (parallels `github.repo.secret_scanning_enabled`), and repo visibility/permission audit (new axis, no direct GitHub analogue proposed yet but a natural extension).

## 2. Authentication

`auth_type`: `access_key` — GitLab does not have a first-class "OAuth2 app installed on an org" concept the way GitHub Apps work; the standard machine-to-machine pattern is a **token with fixed scopes**, which Prism's `access_key` auth type models most accurately (secret is a static bearer token, not a rotating installation credential — same shape as AWS's `access_key` type, not a full 3-legged OAuth2 dance).

### Token model: Group Access Token (recommended) vs. Personal Access Token vs. OAuth2 app

- **Group Access Token (recommended)**: scoped to a single top-level group (and its subgroups/projects), created under **Group > Settings > Access Tokens**. Does not tie evidence collection to an individual human's account (avoids breakage when that person leaves or rotates their own PAT), and cannot itself be used to create further access tokens (a deliberate GitLab restriction that limits blast radius if the token leaks).
- **Personal Access Token (PAT)**: broader — grants access to every group/project the *user* can see, not just the target group. Works, but ties collection to an individual account's lifecycle; use only if the org doesn't have Group Access Tokens available on their GitLab tier (available on GitLab Premium/Ultimate for groups; Free tier supports Project Access Tokens as a narrower alternative).
- **OAuth2 application**: GitLab supports registering an OAuth2 app (Group > Settings > Applications) for a full authorization-code flow with refresh tokens. This is the closer analogue to GitHub's App model and is the better long-term fit if Prism wants token rotation without manual re-issuance, but it's more setup than a Group Access Token and not necessary for a first cut — documented here for future migration, not implemented in v1.

**Required scopes** (Group Access Token or PAT):
- `read_api` — read-only access to the full REST/GraphQL API surface (groups, projects, members, protected branches, CI/CD variables, merge request approval rules). Prefer this over the broader `api` scope, which also grants write access — Prism's checks are read-only.
- `read_user` — read the authenticated token's own user info (used by `testConnection` to verify the token resolves to an identity before running checks).

### Setup steps (Group Access Token)

1. In GitLab, navigate to the target **group** (or subgroup) that scopes what Prism should audit.
2. Go to **Settings > Access Tokens**.
3. Create a new token: give it a name (`prism-evidence-collection`), set role to **Reporter** or **Guest** (read-only roles are sufficient for every check below — do not grant Maintainer/Owner), select scopes **`read_api`** and **`read_user`**, and set an expiration date (GitLab requires one; plan to rotate before expiry — Prism does not auto-refresh a Group Access Token the way it does a GitHub App installation token).
4. Copy the generated token immediately — GitLab shows it once.
5. In Prism, add a GitLab connection with `config.groupId` (the group's numeric ID or full path) and `config.baseUrl` (only needed for self-managed instances; omit for GitLab.com), and paste the token into `secret.accessToken`.

### `config` / `secret` shapes

```json
// integration_connections.config
{
  "groupId": "my-org-group",
  "baseUrl": "https://gitlab.example.com"
}
```

```json
// integration_credentials (decrypted secret shape)
{
  "accessToken": "glpat-xxxxxxxxxxxxxxxxxxxx"
}
```

`baseUrl` defaults to `https://gitlab.com` when omitted, so GitLab.com connections only need `groupId` + `secret.accessToken`.

## 3. API Reference

- **Base URL**: `https://gitlab.com/api/v4` for GitLab.com; `https://<self-managed-host>/api/v4` for self-managed instances (mirrors GitHub's `api.github.com` vs. GHES `/api/v3` split — same `config.baseUrl` pattern Prism should use).
- **Pagination**: offset-based by default (`page`/`per_page` query params, `per_page` default 20, max 100), with `Link` response headers (`rel="next"`) — same shape as GitHub's pagination, so the connector can follow an equivalent `paginate()`-style helper. Keyset pagination exists on some endpoints for large collections but isn't required at Prism's scale (per-group project/member counts).
- **Rate limits**: GitLab.com applies per-endpoint, per-user authenticated rate limits (e.g. `GET /groups` ~200/min, `GET /groups/:id` ~400/min, `GET /groups/:id/projects` ~600/min) rather than one global bucket like GitHub's 5,000/hour; self-managed instances are unlimited by default unless the admin configures limits. The connector should treat any `429` response the same way `describeGithubError()` treats GitHub's rate-limit case — surface `Retry-After` if present.
- **Endpoints needed**:
  - `GET /user` — token identity check for `testConnection`
  - `GET /groups/{id}` — `require_two_factor_authentication` field
  - `GET /groups/{id}/projects` (paginated) — project enumeration, `default_branch`, `visibility`
  - `GET /projects/{id}/protected_branches/{branch}` — protection rule for the default branch
  - `GET /projects/{id}/approval_rules` (Merge Request Approvals API) — `approvals_required`
  - `GET /projects/{id}/variables` — CI/CD variables, each with `protected`/`masked` booleans (values themselves are never returned by the API when masked — only the flags, which is what these checks need)
  - `GET /groups/{id}/members?query=&access_level=50` (Owner = access level 50) — group owners

## 4. Proposed Checks (8)

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `gitlab.group.two_factor_required` | Group requires two-factor authentication | critical | A.9.4.2 | Checks `GET /groups/{id}` reports `require_two_factor_authentication: true`, parallel to `github.org.two_factor_required`. | Enable "Require two-factor authentication" under Group > Settings > General > Permissions and group features. |
| `gitlab.project.protected_default_branch` | Default branch is protected against direct pushes | high | A.14.2.2 | Checks the project's default branch has a protected-branch rule (`GET /projects/{id}/protected_branches/{branch}`) that does not allow `push_access_level: developer` unrestricted pushes, parallel to `github.repo.branch_protection_required_reviews`. | Add a protected branch rule for the default branch restricting push access to Maintainer or higher under Project > Settings > Repository > Protected branches. |
| `gitlab.project.merge_request_approvals_required` | Default branch requires merge request approval before merging | high | A.14.2.2 | Checks the project's approval rules (`GET /projects/{id}/approval_rules`) require at least 1 approval before merge, the direct analogue of `github.repo.branch_protection_required_reviews`'s required-reviewer-count check. | Set "Approvals required" to at least 1 under Project > Settings > Merge requests > Merge request approvals. |
| `gitlab.project.dependency_scanning_enabled` | Dependency scanning is enabled in CI/CD | high | A.12.6.1 | Checks the project's `.gitlab-ci.yml` (via `GET /projects/{id}/repository/files/.gitlab-ci.yml`) includes the `Dependency-Scanning` CI/CD template, parallel to `github.repo.vulnerability_alerts_enabled`. | Include `template: Security/Dependency-Scanning.gitlab-ci.yml` in the project's CI/CD pipeline configuration. |
| `gitlab.project.secret_detection_enabled` | Secret detection is enabled in CI/CD | medium | A.9.4.3 | Checks the project's CI/CD configuration includes the `Secret-Detection` template, parallel to `github.repo.secret_scanning_enabled`. | Include `template: Security/Secret-Detection.gitlab-ci.yml` in the project's CI/CD pipeline configuration. |
| `gitlab.project.ci_variables_protected_and_masked` | CI/CD variables are protected and masked | high | A.9.4.1 | Checks every CI/CD variable (`GET /projects/{id}/variables`) has both `protected: true` (only exposed on protected branches/tags) and `masked: true` (redacted from job logs). | Edit each variable under Project > Settings > CI/CD > Variables and enable both "Protect variable" and "Mask variable". |
| `gitlab.group.owners_count_minimized` | Group owner role is limited to necessary personnel | medium | A.9.2.3 | Checks the number of group members with Owner access level (`GET /groups/{id}/members?access_level=50`) does not exceed a defined threshold (default 5), parallel to `github.org.owners_count_minimized`. | Review the group's member list and demote accounts that don't require full Owner-level access to Maintainer or below. |
| `gitlab.project.visibility_restricted` | Project visibility is not public | medium | A.8.2.3 | Checks each project's `visibility` field (`GET /groups/{id}/projects`) is `private` or `internal`, not `public`. | Change the project's visibility level under Project > Settings > General > Visibility, project features, permissions. |

## 5. Seed SQL

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('gitlab', 'GitLab', 'devops', 'access_key', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('gitlab', 'gitlab.group.two_factor_required', 'Group requires two-factor authentication', 'Checks the GitLab group enforces two-factor authentication for all members.', 'critical', 'Enable "Require two-factor authentication" under Group > Settings > General > Permissions and group features.'),
  ('gitlab', 'gitlab.project.protected_default_branch', 'Default branch is protected against direct pushes', 'Checks each project''s default branch has a protected branch rule restricting push access.', 'high', 'Add a protected branch rule for the default branch restricting push access to Maintainer or higher under Project > Settings > Repository > Protected branches.'),
  ('gitlab', 'gitlab.project.merge_request_approvals_required', 'Default branch requires merge request approval before merging', 'Checks each project requires at least one approval before a merge request can be merged.', 'high', 'Set "Approvals required" to at least 1 under Project > Settings > Merge requests > Merge request approvals.'),
  ('gitlab', 'gitlab.project.dependency_scanning_enabled', 'Dependency scanning is enabled in CI/CD', 'Checks each project''s CI/CD pipeline includes the Dependency-Scanning security template.', 'high', 'Include template: Security/Dependency-Scanning.gitlab-ci.yml in the project''s CI/CD pipeline configuration.'),
  ('gitlab', 'gitlab.project.secret_detection_enabled', 'Secret detection is enabled in CI/CD', 'Checks each project''s CI/CD pipeline includes the Secret-Detection security template.', 'medium', 'Include template: Security/Secret-Detection.gitlab-ci.yml in the project''s CI/CD pipeline configuration.'),
  ('gitlab', 'gitlab.project.ci_variables_protected_and_masked', 'CI/CD variables are protected and masked', 'Checks every CI/CD variable is both protected (restricted to protected branches/tags) and masked (redacted from job logs).', 'high', 'Edit each variable under Project > Settings > CI/CD > Variables and enable both "Protect variable" and "Mask variable".'),
  ('gitlab', 'gitlab.group.owners_count_minimized', 'Group owner role is limited to necessary personnel', 'Checks the number of group Owners does not exceed a defined threshold, flagging excessive standing privileged access.', 'medium', 'Review the group''s member list and demote accounts that don''t require full Owner-level access to Maintainer or below.'),
  ('gitlab', 'gitlab.project.visibility_restricted', 'Project visibility is not public', 'Checks each project''s visibility level is private or internal, not public.', 'medium', 'Change the project''s visibility level under Project > Settings > General > Visibility, project features, permissions.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('gitlab.group.two_factor_required', 'A.9.4.2'),
  ('gitlab.project.protected_default_branch', 'A.14.2.2'),
  ('gitlab.project.merge_request_approvals_required', 'A.14.2.2'),
  ('gitlab.project.dependency_scanning_enabled', 'A.12.6.1'),
  ('gitlab.project.secret_detection_enabled', 'A.9.4.3'),
  ('gitlab.project.ci_variables_protected_and_masked', 'A.9.4.1'),
  ('gitlab.group.owners_count_minimized', 'A.9.2.3'),
  ('gitlab.project.visibility_restricted', 'A.8.2.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `gitlab` (new) — register in `api/src/connectors/registry.js`:
  ```js
  import * as gitlab from "./gitlab/index.js";
  const connectors = { [aws.key]: aws, [azure.key]: azure, [github.key]: github, [gitlab.key]: gitlab, [purview.key]: purview };
  ```
- **Files to add** (mirroring `api/src/connectors/github/` layout):
  - `api/src/connectors/gitlab/credentials.js` — `resolveGitlabCredentials({ authType, config, secret })`, validates `authType === "access_key"`, constructs a client from `secret.accessToken` + `config.baseUrl` (default `https://gitlab.com`).
  - `api/src/connectors/gitlab/index.js` — exports `key = "gitlab"`, `tests`, `testConnection`, `runTests`; builds `clients = { api, groupId, projects }` (fetch group + paginate projects once per run, same shape as GitHub's `buildClients`).
  - `api/src/connectors/gitlab/tests/access.js` — `gitlab.group.two_factor_required`, `gitlab.group.owners_count_minimized`.
  - `api/src/connectors/gitlab/tests/branchProtection.js` — `gitlab.project.protected_default_branch`, `gitlab.project.merge_request_approvals_required`.
  - `api/src/connectors/gitlab/tests/security.js` — `gitlab.project.dependency_scanning_enabled`, `gitlab.project.secret_detection_enabled`, `gitlab.project.ci_variables_protected_and_masked`, `gitlab.project.visibility_restricted`.
- **Files to edit**: `init.sql` (append seed blocks above, following the existing `-- ===== <X> connector: catalog seed data =====` comment convention used for Purview), `api/src/connectors/registry.js`.
- **Client library**: `@gitbeaker/rest` (actively maintained, typed, built-in pagination helpers via `.all()`) — construct with `new Gitlab({ host: config.baseUrl || "https://gitlab.com", token: secret.accessToken })`. Avoids hand-rolling `Link`-header pagination the way a raw-fetch approach would require.
- **CI/CD template detection caveat**: `gitlab.project.dependency_scanning_enabled` / `secret_detection_enabled` need to parse `.gitlab-ci.yml` (and any files it `include:`s) for the relevant `template:` reference — YAML parsing plus include-resolution is more involved than a simple field check. If this proves too fragile for v1, fall back to GitLab's Security & Compliance API (`GET /projects/{id}/security_dashboard` or the Vulnerability findings API) which reports scanner results directly rather than inferring intent from pipeline config — evaluate during implementation which is more reliable against a live instance.
