# Slack Connector

## 1. Overview

- **Proposed `integrations.category`**: `collaboration`
- **Proposed `integrations.key`**: `slack`
- **Proposed `integrations.auth_type`**: `oauth2`

Slack is the company's collaboration/messaging platform. This connector reads workspace/organization-level administrative configuration — user and guest inventory, 2FA status, external (Slack Connect) channel sharing, and installed-app approvals — to evidence identity/access-management controls (ISO 27001 Annex A.9) and third-party/supplier controls (A.14, A.15).

Scope for v1: read-only checks against Slack's **Admin API** (the `admin.*` method namespace). These endpoints only exist for **Enterprise Grid** organizations — Slack's `admin.*` scopes are gated to Enterprise Grid regardless of which individual workspace token requests them ([Slack admin scope reference](https://docs.slack.dev/reference/scopes/admin/)). Standalone (non-Grid) Pro/Business+ workspaces do not expose this API surface at all; for those customers this connector should report `not_applicable`/unavailable rather than attempting the calls. No write scopes are requested — every check is a `*.read`-scoped call.

## 2. Authentication

**`auth_type`: `oauth2`**

Slack's admin-level data (org-wide user list, guest status, 2FA, app installs, external channel sharing) is only reachable through **admin scopes**, and a token only carries admin scopes if the app is installed on the **entire Enterprise Grid organization**, not a single workspace within it ([Slack admin scope reference](https://docs.slack.dev/reference/scopes/admin/)). This requires org-owner-level approval at install time — there is no lower-privilege path to this data.

Slack also exposes a separate **SCIM API** for user/group provisioning (`https://api.slack.com/scim`), gated behind Business+/Enterprise and an `admin` OAuth scope token ([Slack SCIM API docs](https://docs.slack.dev/admins/scim-api/)). Because `admin.users.list` already returns the fields this connector needs (`has_2fa`, `is_restricted`, `is_ultra_restricted`, `is_admin`, `is_owner`) in the same Admin API surface used for the other checks, **SCIM is not used** — it would add a second auth/token model for no additional coverage. Revisit this only if a future check needs SCIM-only data (e.g. provisioning source-of-truth reconciliation).

### Setup steps (Slack app configuration, api.slack.com)

1. At [api.slack.com/apps](https://api.slack.com/apps), create a new app ("From scratch") named e.g. "Prism Compliance Reader".
2. Under **OAuth & Permissions**, add the following **User Token Scopes** (admin scopes are user-token, not bot-token, scopes):
   - `admin.users:read` — org/workspace user list, guest flags (`is_restricted`, `is_ultra_restricted`), `has_2fa`, `is_admin`/`is_owner`/`is_primary_owner`.
   - `admin.roles:read` — enumerate custom admin roles and their assignees, for role-based admin review beyond the built-in owner/admin flags.
   - `admin.apps:read` — list org-approved and pending/restricted app installations and their granted scopes.
   - `admin.conversations:read` — search/list channels org-wide, including Slack Connect / external-share flags (`is_ext_shared`, `is_org_shared`, `is_pending_ext_shared`, `connected_team_ids`).
   - `admin.teams:read` — enumerate workspaces within the Enterprise Grid org (needed to scope per-workspace checks and for `testConnection`).
3. Install the app **to the Enterprise organization** (not an individual workspace) — this step requires an **Org Owner** to approve; a Workspace Owner/Admin cannot grant Enterprise-scoped admin tokens. In Slack: **Enterprise Overview > apps** (or the install prompt on the app's OAuth page when "Install to Organization" is selected).
4. Slack returns a **user OAuth token** (`xoxp-...`) scoped to the approving Org Owner's grants. Store this as `secret.userToken`. There is no separate client_id/client_secret exchange needed for ongoing calls once this token is issued (Slack admin tokens are long-lived until revoked; there is no refresh-token rotation for this token type as of today).
5. Record the **Enterprise ID** (`E0...`, visible in the Enterprise admin URL or returned by `admin.teams:list`/`team.info`) as `config.enterpriseId`, used to scope org-wide calls.

### `config` shape (non-secret, stored on `integration_connections.config`)

```json
{
  "enterpriseId": "E01ABCXYZ"
}
```

### `secret` shape (encrypted, stored via `integration_credentials`)

```json
{
  "userToken": "xoxp-...redacted..."
}
```

## 3. API Reference

- **Base URL**: `https://slack.com/api/` — all methods are POST (or GET with query params) to `https://slack.com/api/{method}`, e.g. `https://slack.com/api/admin.users.list`.
- **Pagination**: cursor-based across all `admin.*` list methods — pass `limit` (default/typical 100) and follow `response_metadata.next_cursor` until it's an empty string.
- **Rate limits**: standard Slack API tiering applies to Admin API methods (most `admin.*` read methods are Tier 2, roughly low tens of requests/minute per workspace/org); a `429` response includes a `Retry-After` header (seconds) that must be honored before retrying.
- **Key endpoints**:
  - `POST admin.users.list` — org user inventory; fields include `has_2fa`, `has_sso`, `is_admin`, `is_owner`, `is_primary_owner`, `is_restricted` (single-channel/multi-channel guest), `is_ultra_restricted` (single-channel guest), `is_active`, `expiration_ts` (guest account expiry).
  - `POST admin.roles.list` / `admin.roles.entities.list` — custom admin role assignments (available on orgs using Grid's granular admin roles feature).
  - `POST admin.apps.approved.list` — apps approved org-wide/per-workspace, including each app's granted `scopes`.
  - `POST admin.apps.requests.list` — pending app-install requests awaiting admin action (evidences whether unreviewed requests are piling up).
  - `POST admin.conversations.search` — channel search with `is_ext_shared`, `is_org_shared`, `is_global_shared`, `is_pending_ext_shared`, `connected_team_ids` fields for Slack Connect exposure.
  - `POST admin.teams.list` — Enterprise Grid workspace enumeration, used by `testConnection`.
- **Docs**: [Slack Admin API scopes](https://docs.slack.dev/reference/scopes) · [admin.users.list](https://docs.slack.dev/reference/methods/admin.users.list) · [admin.conversations.search](https://docs.slack.dev/reference/methods/admin.conversations.search) · [admin.apps.approved.list](https://docs.slack.dev/reference/methods/admin.apps.approved.list)

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `slack.user.2fa_enforced` | All active members have two-factor authentication enabled | critical | A.9.4.2 | Checks `admin.users.list` for active, non-bot, non-SSO members where `has_2fa` is `false`, flagging accounts without 2FA (SSO-authenticated accounts are excluded since 2FA is enforced at the IdP). | Require 2FA workspace-wide under Workspace Settings > Security, or move authentication to SSO with MFA enforced at the identity provider. |
| `slack.user.guest_accounts_reviewed` | Guest accounts are time-bound and periodically reviewed | high | A.9.2.5 | Checks members flagged `is_restricted` or `is_ultra_restricted` (multi-channel/single-channel guests) have a non-null `expiration_ts` and that no guest account is older than the review threshold without a documented renewal. | Set an expiration date on every guest invite, and remove or renew guest access that has exceeded the review window. |
| `slack.user.admin_role_review` | Admin and owner roles are limited to a reviewed set of accounts | high | A.9.2.3 | Checks the combined count of `is_admin`/`is_owner`/`is_primary_owner` accounts (plus any `admin.roles` custom role assignees) against an expected roster, flagging unreviewed or excessive standing admin access. | Review the admin/owner list under Enterprise Overview > Administrators; demote accounts that no longer require standing administrative access. |
| `slack.user.inactive_reviewed` | Deactivated members are removed from active workspace membership | medium | A.9.2.6 | Checks `admin.users.list` for accounts with `is_active: false` alongside a recent `deactivated_ts` still holding roles/entitlements that should have been revoked at offboarding. | Confirm the offboarding process deactivates Slack access at termination and clears any residual admin/role assignments. |
| `slack.app.installation_review` | Installed apps are limited to admin-approved, minimally-scoped installs | high | A.14.2.4 | Checks `admin.apps.approved.list` for apps holding broad/sensitive scopes (e.g. full message history, `admin.*` scopes granted to a third-party app) and that `admin.apps.requests.list` has no long-pending unreviewed requests. | Revoke apps with excessive scopes under Enterprise Overview > Apps > Manage, and require App Approval so installs need explicit admin sign-off. |
| `slack.app.approval_required` | App installation requires admin approval (not open self-install) | high | A.14.2.4 | Checks the org's app management policy is set to require admin approval for new app installs rather than allowing members to self-install any app. | Enable "Require app approval" under Enterprise Overview > Settings > Permissions so all new app installs route through an admin review. |
| `slack.channel.external_sharing_reviewed` | Externally shared (Slack Connect) channels are reviewed | medium | A.13.2.1 | Checks `admin.conversations.search` for channels with `is_ext_shared`/`connected_team_ids` populated, confirming each external/Connect channel maps to an approved, documented partner organization. | Audit Slack Connect channels under Enterprise Overview > Connect Channels and remove connections to organizations no longer part of an active engagement. |
| `slack.channel.connect_restricted_by_default` | Slack Connect invitations require admin approval | medium | A.13.2.1 | Checks the org-level Slack Connect policy restricts who can send/accept external channel invitations (approved domains list or admin-approval-only) rather than allowing any member to connect externally. | Restrict Slack Connect under Enterprise Overview > Settings > Slack Connect to an approved domain allowlist or admin-approval workflow. |

## 5. Seed SQL

```sql
-- ===== Slack connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('slack', 'Slack', 'collaboration', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('slack', 'slack.user.2fa_enforced', 'All active members have two-factor authentication enabled', 'Checks active, non-bot, non-SSO members do not have has_2fa false, flagging accounts without 2FA.', 'critical', 'Require 2FA workspace-wide under Workspace Settings > Security, or move authentication to SSO with MFA enforced at the identity provider.'),
  ('slack', 'slack.user.guest_accounts_reviewed', 'Guest accounts are time-bound and periodically reviewed', 'Checks multi-channel and single-channel guest accounts have an expiration date set and have not exceeded the review window without renewal.', 'high', 'Set an expiration date on every guest invite, and remove or renew guest access that has exceeded the review window.'),
  ('slack', 'slack.user.admin_role_review', 'Admin and owner roles are limited to a reviewed set of accounts', 'Checks the count of admin, owner, and custom-role-assigned accounts against an expected roster, flagging unreviewed or excessive standing admin access.', 'high', 'Review the admin/owner list under Enterprise Overview > Administrators; demote accounts that no longer require standing administrative access.'),
  ('slack', 'slack.user.inactive_reviewed', 'Deactivated members are removed from active workspace membership', 'Checks deactivated accounts do not still hold roles or entitlements that should have been revoked at offboarding.', 'medium', 'Confirm the offboarding process deactivates Slack access at termination and clears any residual admin/role assignments.'),
  ('slack', 'slack.app.installation_review', 'Installed apps are limited to admin-approved, minimally-scoped installs', 'Checks approved apps do not hold excessively broad scopes and that pending app install requests are not going unreviewed.', 'high', 'Revoke apps with excessive scopes under Enterprise Overview > Apps > Manage, and require App Approval so installs need explicit admin sign-off.'),
  ('slack', 'slack.app.approval_required', 'App installation requires admin approval (not open self-install)', 'Checks the org requires admin approval for new app installs rather than allowing members to self-install any app.', 'high', 'Enable "Require app approval" under Enterprise Overview > Settings > Permissions so all new app installs route through an admin review.'),
  ('slack', 'slack.channel.external_sharing_reviewed', 'Externally shared (Slack Connect) channels are reviewed', 'Checks externally shared channels map to an approved, documented partner organization.', 'medium', 'Audit Slack Connect channels under Enterprise Overview > Connect Channels and remove connections to organizations no longer part of an active engagement.'),
  ('slack', 'slack.channel.connect_restricted_by_default', 'Slack Connect invitations require admin approval', 'Checks the Slack Connect policy restricts who can send or accept external channel invitations rather than allowing any member to connect externally.', 'medium', 'Restrict Slack Connect under Enterprise Overview > Settings > Slack Connect to an approved domain allowlist or admin-approval workflow.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('slack.user.2fa_enforced', 'A.9.4.2'),
  ('slack.user.guest_accounts_reviewed', 'A.9.2.5'),
  ('slack.user.admin_role_review', 'A.9.2.3'),
  ('slack.user.inactive_reviewed', 'A.9.2.6'),
  ('slack.app.installation_review', 'A.14.2.4'),
  ('slack.app.approval_required', 'A.14.2.4'),
  ('slack.channel.external_sharing_reviewed', 'A.13.2.1'),
  ('slack.channel.connect_restricted_by_default', 'A.13.2.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `slack` (used in `registry.js`).
- **Suggested files**:
  - `api/src/connectors/slack/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/github/index.js`'s structure (a thin fetch-based client rather than a full SDK — Slack's Web API is simple enough not to need one).
  - `api/src/connectors/slack/credentials.js` — `resolveSlackCredentials({ authType, config, secret })`: validates `authType === "oauth2"`, returns `{ userToken: secret.userToken, enterpriseId: config.enterpriseId }`. No token exchange/refresh needed since the stored token is the long-lived Enterprise-installed user token.
  - `api/src/connectors/slack/client.js` — small wrapper around `fetch(https://slack.com/api/{method}, ...)` handling the cursor pagination pattern (`response_metadata.next_cursor`) and Slack's convention of returning HTTP 200 with `{ ok: false, error: "..." }` on API-level errors (must be checked explicitly — a non-2xx HTTP status is not how Slack signals failures).
  - `api/src/connectors/slack/tests/users.js` — `check2faEnforced`, `checkGuestAccountsReviewed`, `checkAdminRoleReview`, `checkInactiveReviewed`.
  - `api/src/connectors/slack/tests/apps.js` — `checkInstallationReview`, `checkApprovalRequired`.
  - `api/src/connectors/slack/tests/channels.js` — `checkExternalSharingReviewed`, `checkConnectRestrictedByDefault`.
- **Registry wiring**: add `import * as slack from "./slack/index.js";` and `[slack.key]: slack` to `api/src/connectors/registry.js`.
- **`testConnection()`**: call `admin.teams.list` with `limit=1` — a cheap, low-privilege admin call that confirms both token validity and that the token actually carries Enterprise-level admin scopes (a workspace-only token will return `not_allowed_token_type` or similar, which should be surfaced as a clear "app must be installed to the Enterprise organization, not a single workspace" error).
- **Non-Grid customers**: since `admin.*` scopes require Enterprise Grid, `testConnection` should detect and clearly report the `not_allowed_token_type`/`missing_scope` failure mode for non-Grid workspaces as "Slack Enterprise Grid is required for this connector" rather than a generic auth error.
- **Error handling precedent**: follow `describeGithubError()`'s pattern in `api/src/connectors/github/index.js` — Slack's rate-limit signal is a `Retry-After` header on HTTP 429, and API-level failures arrive as `{ ok: false, error }` in a 200 response, both of which need explicit handling distinct from network/HTTP-status errors.
- **Not-applicable handling**: `admin.roles.list`/custom role assignment data is only meaningful on orgs that have configured granular admin roles — if the endpoint returns an empty set, treat `slack.user.admin_role_review` as folding back to just the `is_admin`/`is_owner` fields rather than failing.
