# GitHub Connector

> **This extends the existing `github` connector** (`api/src/connectors/github/`). It does not introduce a new `integrations` row, a new registry key, or a new auth model — it adds checks to the connector that already ships in Prism. Everything under "Proposed Checks" and "Seed SQL" below has been implemented and is now live (9 checks total) — this doc is kept as the design record for that work rather than an open proposal.

## 1. Overview

- **Category**: `devops` (matches the existing `integrations.category` value for `github`)
- **Connector key**: `github` (existing — see `api/src/connectors/registry.js`)
- **Scope today (9 checks, all live)**: Organization 2FA enforcement, default-branch PR review requirements, Dependabot vulnerability alerts, secret scanning, default repo permission, organization owner count, Actions default workflow token permissions, Actions third-party restriction, and CodeQL default setup.
- **Originally shipped** (Phase 1): `github.org.two_factor_required`, `github.repo.branch_protection_required_reviews`, `github.repo.vulnerability_alerts_enabled`, `github.repo.secret_scanning_enabled`.
- **Added by this doc** (implemented in `tests/orgManagement.js`, `tests/actions.js`, `tests/codeScanning.js`): `github.org.default_repository_permission_restricted`, `github.org.owners_count_minimized`, `github.org.actions_default_workflow_permissions_readonly`, `github.org.actions_third_party_restricted`, `github.repo.code_scanning_default_setup_enabled`.

Target coverage sheet vs. status:

| Area | Status |
|---|---|
| Organization | Done (2FA, default repo permission) |
| Users / Teams | Done (owner count) |
| Repositories | Done (enumerated via `octokit.paginate(repos.listForOrg)`) |
| Branch protection | Done |
| Secrets (scanning) | Done — secret *exposure/rotation* is not in scope for this doc (GitHub has no API-exposed "secret age" concept the way AWS access keys do) |
| Actions | Done (workflow permissions, allowed actions) |
| Security settings | Done (2FA, secret scanning, Actions settings) |
| Dependabot | Done |
| Code scanning | Done (CodeQL default setup) |

Note: the App's permissions must still be widened per the "Extending the existing GitHub App's permissions" section below before these 5 new checks can return real pass/fail data on a live connection — until an org owner approves the updated installation, they'll surface as `not_applicable`.

## 2. Authentication

`auth_type`: `oauth2` (existing value — used for the GitHub App installation-token flow, not a literal user OAuth2 grant; this is the existing convention in `credentials.js` and is unchanged).

Prism authenticates as a **GitHub App** installed on the organization (see `api/src/connectors/github/credentials.js`, `resolveGithubCredentials`), using `@octokit/auth-app`'s `createAppAuth` strategy to mint short-lived installation tokens.

### Extending the existing GitHub App's permissions

The checks proposed here need **additional GitHub App permissions** beyond what the 4 existing checks require. No new App, no new auth flow — just an update to the App's permission set (organization admins will need to re-approve the installation after this change, standard GitHub App behavior).

1. In the GitHub organization, go to **Settings > Developer settings > GitHub Apps** and open Prism's existing App.
2. Under **Permissions**, add/confirm:
   - **Organization permissions > Administration**: `Read-only` (needed for `GET /orgs/{org}` fields like `default_repository_permission`, and for `GET /orgs/{org}/actions/permissions*`) — this may already be `Read-only` if it was granted for the existing 2FA check; if so, no change needed.
   - **Organization permissions > Members**: `Read-only` (needed to enumerate org owners via `GET /orgs/{org}/members?role=admin`).
   - **Repository permissions > Actions**: `Read-only` (needed for repo-level Actions permission reads, if a future check narrows to the repo level).
   - **Repository permissions > Code scanning alerts**: `Read-only` (needed for `GET /repos/{owner}/{repo}/code-scanning/default-setup` and `.../alerts`).
3. Save changes, then **accept the updated permissions** on the installation (org owner must approve — GitHub shows a pending-permissions banner on the installation settings page).
4. No changes to `config` or `secret` shapes — Prism's stored `installationId`, `appId`, and `privateKey` continue to work unmodified once the App's permission set is widened.

### `config` / `secret` shapes (unchanged)

```json
// integration_connections.config
{
  "org": "my-github-org",
  "installationId": "12345678"
}
```

```json
// integration_credentials (decrypted secret shape)
{
  "appId": "987654",
  "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
}
```

## 3. API Reference

- **Base URL**: `https://api.github.com` (GitHub.com; GitHub Enterprise Server uses `https://<host>/api/v3`, not covered by the current connector).
- **Pagination**: standard `Link` header (`rel="next"`); the connector already uses `octokit.paginate()` for repo listing, and new checks that page (e.g. org members) should follow the same pattern.
- **Rate limits**: GitHub App installation tokens get a base 5,000 requests/hour (some GitHub Enterprise Cloud orgs get higher limits); `x-ratelimit-remaining`/`x-ratelimit-reset` headers are already surfaced by `describeGithubError()` in `index.js` and require no new handling.
- **New endpoints needed**:
  - `GET /orgs/{org}` (already called for `testConnection`/2FA — the new checks read additional fields off the same response: `default_repository_permission`)
  - `GET /orgs/{org}/members?role=admin` — list organization owners
  - `GET /orgs/{org}/actions/permissions` — org-wide Actions enablement + `allowed_actions` (`all` | `local_only` | `selected`)
  - `GET /orgs/{org}/actions/permissions/workflow` — `default_workflow_permissions` (`read` | `write`) and `can_approve_pull_request_reviews`
  - `GET /repos/{owner}/{repo}/code-scanning/default-setup` — `state` (`configured` | `not-configured`)

## 4. Proposed Checks (new — 5)

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `github.org.default_repository_permission_restricted` | Default repository permission is not admin | medium | A.9.2.3 | Checks the organization's default repository permission (`GET /orgs/{org}`) is not `admin`, so new members don't inherit admin access to every repo by default. | Set the default repository permission to `read` or `write` under Organization settings > Member privileges. |
| `github.org.owners_count_minimized` | Organization owner role is limited to necessary personnel | medium | A.9.2.3 | Checks the number of organization owners (`GET /orgs/{org}/members?role=admin`) does not exceed a defined threshold (default 5), flagging excessive standing privileged access. | Review the organization owners list and demote accounts that don't require full administrative access to a lower role. |
| `github.org.actions_default_workflow_permissions_readonly` | Actions default workflow token permissions are read-only | high | A.9.4.1 | Checks `GET /orgs/{org}/actions/permissions/workflow` reports `default_workflow_permissions: "read"`, so the automatic `GITHUB_TOKEN` cannot write to repository contents/packages/etc. by default. | Set the default workflow permissions to read-only under Organization settings > Actions > General, and grant write access per-workflow via explicit `permissions:` blocks instead. |
| `github.org.actions_third_party_restricted` | Actions are restricted to verified or selected sources | medium | A.14.2.2 | Checks `GET /orgs/{org}/actions/permissions` reports `allowed_actions` is not `all`, meaning the org restricts which third-party Actions/reusable workflows can run rather than allowing anything from the Marketplace. | Set Actions permissions to "Allow enterprise, and select non-enterprise, actions and reusable workflows" (or stricter) under Organization settings > Actions > General. |
| `github.repo.code_scanning_default_setup_enabled` | Code scanning (CodeQL) default setup is enabled | high | A.12.6.1 | Checks `GET /repos/{owner}/{repo}/code-scanning/default-setup` reports `state: "configured"` for each repository, evidencing automated static analysis for known vulnerability patterns. | Enable CodeQL default setup under Repository settings > Code security and analysis > Code scanning, or onboard via `PATCH /repos/{owner}/{repo}/code-scanning/default-setup` with `state=configured`. |

## 5. Seed SQL

The `integrations` row for `github` already exists — no new insert needed. Append to the existing `automated_tests` / `test_control_mappings` blocks in `init.sql` (same statement style, `ON CONFLICT ... DO NOTHING` so this is safe to run against an already-seeded database):

```sql
INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('github', 'github.org.default_repository_permission_restricted', 'Default repository permission is not admin', 'Checks the organization''s default repository permission is not admin, so new members don''t inherit admin access to every repo.', 'medium', 'Set the default repository permission to read or write under Organization settings > Member privileges.'),
  ('github', 'github.org.owners_count_minimized', 'Organization owner role is limited to necessary personnel', 'Checks the number of organization owners does not exceed a defined threshold, flagging excessive standing privileged access.', 'medium', 'Review the organization owners list and demote accounts that don''t require full administrative access to a lower role.'),
  ('github', 'github.org.actions_default_workflow_permissions_readonly', 'Actions default workflow token permissions are read-only', 'Checks the default GITHUB_TOKEN permissions for Actions workflows are read-only rather than read-write.', 'high', 'Set the default workflow permissions to read-only under Organization settings > Actions > General.'),
  ('github', 'github.org.actions_third_party_restricted', 'Actions are restricted to verified or selected sources', 'Checks the organization restricts which third-party Actions and reusable workflows can run rather than allowing anything from the Marketplace.', 'medium', 'Set Actions permissions to allow only enterprise and selected non-enterprise actions under Organization settings > Actions > General.'),
  ('github', 'github.repo.code_scanning_default_setup_enabled', 'Code scanning (CodeQL) default setup is enabled', 'Checks CodeQL default setup is configured for each repository.', 'high', 'Enable CodeQL default setup under Repository settings > Code security and analysis > Code scanning.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('github.org.default_repository_permission_restricted', 'A.9.2.3'),
  ('github.org.owners_count_minimized', 'A.9.2.3'),
  ('github.org.actions_default_workflow_permissions_readonly', 'A.9.4.1'),
  ('github.org.actions_third_party_restricted', 'A.14.2.2'),
  ('github.repo.code_scanning_default_setup_enabled', 'A.12.6.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `github` (existing, no `registry.js` change needed).
- **Files to add**:
  - `api/src/connectors/github/tests/orgManagement.js` — exports `orgManagementTests` with `checkDefaultRepositoryPermissionRestricted` and `checkOwnersCountMinimized`.
  - `api/src/connectors/github/tests/actions.js` — exports `actionsTests` with `checkActionsDefaultWorkflowPermissionsReadonly` and `checkActionsThirdPartyRestricted`.
  - `api/src/connectors/github/tests/codeScanning.js` — exports `codeScanningTests` with `checkCodeScanningDefaultSetupEnabled`.
- **Files to edit**:
  - `api/src/connectors/github/index.js` — import the three new test arrays and spread them into `tests` alongside `accessTests`/`securityTests`.
  - `init.sql` — append the SQL blocks above directly after the existing `github` seed blocks (lines ~679–691).
- **Client library**: no new dependency — continue using the existing `@octokit/rest` instance built by `resolveGithubCredentials`.
- **Threshold config**: `github.org.owners_count_minimized`'s threshold (proposed default: 5) should live as a named constant in `orgManagement.js`, following the same inline-constant style as other connectors rather than adding new config surface.
- **Not-applicable handling**: follow the existing precedent in `access.js`/`security.js` — if `default_workflow_permissions` or `allowed_actions` come back `undefined` (App permissions insufficient), return `not_applicable` rather than `fail`, exactly like `checkTwoFactorRequired` and `checkSecretScanningEnabled` do today.
