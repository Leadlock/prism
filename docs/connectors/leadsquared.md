# LeadSquared Connector

## 1. Overview

- **Proposed `integrations.category`**: `crm`
- **Proposed `integrations.key`**: `leadsquared`
- **Proposed `integrations.auth_type`**: `api_key`

LeadSquared is a marketing-automation/CRM SaaS platform, India-founded with global usage. It ships a well-documented public REST API (`apidocs.leadsquared.com`) authenticated with a static **Access Key + Secret Key** pair per user — a straightforward, well-documented key-pair auth model, the second-strongest documentation posture of the three connectors in this batch (behind Keka, ahead of Darwinbox).

Scope for v1: read-only checks against user accounts, roles/permission-template assignments, and account activity to evidence identity/access-management controls (ISO 27001 Annex A.9) and audit/logging controls (A.12.4). **Caveat**: LeadSquared documents a `Get User Permissions` API (permission templates) and a `Get Users` API (with role field), which cover the "users, roles, permissions" part of scope well. For "audit" specifically, LeadSquared's most audit-relevant *documented* API-accessible data is `Get Activity Change History` (field-level change history on lead/prospect activities) — there is no documented dedicated *admin/security audit log* API (e.g. login events, permission changes, admin actions) found in this research pass; the closest artifact is the **API Logs** feature, which LeadSquared's own help docs describe as viewable only in the web application (My Profile > Settings > API and Webhooks > API Logs), not as a queryable API endpoint. This gap is called out explicitly in the checks below rather than inventing an endpoint.

## 2. Authentication

**`auth_type`: `api_key`** (Access Key + Secret Key pair, confirmed via `apidocs.leadsquared.com/authentication/`)

Every LeadSquared API call requires an `accessKey` and `secretKey` pair, either as query-string parameters or (recommended, and required for some newer "Service CRM" APIs) as request headers (`x-LSQ-AccessKey`, `x-LSQ-SecretKey`).

### Setup steps (LeadSquared application)

1. Log in to LeadSquared as (or have) an **Admin** user — LeadSquared's docs explicitly recommend using an Admin user's keys so the integration isn't restricted by Marketing User/Sales User role-based limitations.
2. Navigate to **My Profile > Settings > API and Webhooks > API Access Keys**.
3. Generate (or view existing) **Access Key** and **Secret Key**; this page also displays the account's **Host URL** — the region-specific API base URL required for all calls (see Section 3).
4. Store both keys as connector secrets; never expose them client-side or in query strings if avoidable (LeadSquared's docs flag query-string auth as the less secure of the two supported methods).
5. Confirm the account's subscription plan (Pro vs. Super) since it determines the applicable rate limits (Section 3).

### `config` shape (non-secret, stored on `integration_connections.config`)

```json
{
  "apiHost": "https://api-in21.leadsquared.com/v2"
}
```

### `secret` shape (encrypted, stored via `integration_credentials`)

```json
{
  "accessKey": "...",
  "secretKey": "..."
}
```

The connector sends `x-LSQ-AccessKey`/`x-LSQ-SecretKey` headers (preferred over query-string params) on every request to `{config.apiHost}/...`. An incorrect host returns `401 Unauthorized` even with valid keys — LeadSquared's docs note the response can indicate the correct host to use, which the connector should surface in its connection-test error message rather than a generic auth failure.

## 3. API Reference

- **Base URL (region-specific — confirmed via `apidocs.leadsquared.com/api-host/`)**:
  | Region | API Host |
  |---|---|
  | Singapore | `https://api.leadsquared.com/v2/` |
  | US | `https://api-us11.leadsquared.com/v2/` |
  | India (Mumbai) | `https://api-in21.leadsquared.com/v2/` |
  | India (Hyderabad) | `https://api-in22.leadsquared.com/v2/` |
  | Middle East | `https://api-me61.leadsquared.com/v2/` |
  | Ireland | `https://api-ir31.leadsquared.com/v2/` |
  | Canada | `https://api-ca12.leadsquared.com/v2/` |

  The correct host for a given account is shown on the API Access Keys settings page; store it in `config.apiHost` rather than hardcoding a region.
- **Confirmed endpoints**:
  - `GET /UserManagement.svc/Users.Get?accessKey=...&secretKey=...` — list all users; response includes `Id`, `FirstName`, `LastName`, `EmailAddress`, `Role`, `StatusCode` (`0` = active, `1` = inactive), `MemberOfGroups`, `Tag`, `IsPhoneCallAgent`.
  - `GET /UserManagement.svc/User/Get?...&Id={id}` — get a single user by ID.
  - `POST /UserManagement.svc/Users/Create` — create a user (not used by read-only evidence checks; noted for completeness).
  - `GET /PermissionTemplate.svc/User/GetPermissions?accessKey=...&secretKey=...` (per-user, via `userId` parameter) — returns a user's consolidated permissions across all assigned permission templates: `UserId`, `EntityPermissions[]` (each with `Entity`, and `Permissions[]` of `{Action, Access, Properties}` covering actions like Create/Update/Delete/Export/Import).
  - `POST /ProspectActivity.svc/Retrieve` — activities for a lead, including custom field values.
  - `POST /ProspectActivity.svc/CustomActivity/RetrieveByActivityEvent` — bulk-retrieve activity instances by activity type/event.
  - **Get Activity Change History** (documented at `apidocs.leadsquared.com/get-activity-change-history/`) — retrieves field-level change history for activities within a date range, including old/new values; the closest documented API-accessible "audit trail" artifact, though scoped to lead/prospect activity records rather than account/security administration events.
  - **User Advanced Search** (documented at `apidocs.leadsquared.com/user-advanced-search/`) — multi-condition search over users, useful for filtering by status/role at scale instead of paging the full `Users.Get` list.
- **Admin/security audit log gap**: no documented endpoint returning login history, permission-change history, or admin-action audit events was found. The in-app **API Logs** feature (My Profile > Settings > API and Webhooks > API Logs) is UI-only per LeadSquared's help documentation — it is not exposed as a queryable API in the sources checked. Treat any "audit log availability" check against LeadSquared as either (a) a manual/screenshot evidence type against the API Logs UI, or (b) scoped down to what `Get Activity Change History` actually covers (lead/prospect data changes, not account security events) — do not invent a `/AuditLog` endpoint.
- **Pagination**: not explicitly detailed for `Users.Get` in the pages fetched; `User Advanced Search` and bulk activity-retrieval endpoints are documented as supporting paged/bulk retrieval patterns — confirm exact page-size/cursor parameters against the live reference for each endpoint before implementation.
- **Rate limits** (confirmed via `apidocs.leadsquared.com/rate-limits/`, plan-dependent):
  - **Pro plan**: 10,000 calls/day account-wide + 1,000 calls/day per user (max 250,000/day); standard APIs limited to 10 calls/5 seconds, Bulk APIs to 5 calls/5 seconds.
  - **Super plan**: 100,000 calls/day account-wide + 1,000 calls/day per user (max 1,000,000/day); standard APIs limited to 20 calls/5 seconds, Bulk APIs to 10 calls/5 seconds.
  - Limits are configurable upward via Settings > Manage Subscription or the account's LeadSquared account manager.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `leadsquared.users.roster_accessible` | User roster is retrievable via API | medium | A.9.2.1 | Checks `Users.Get` returns the account's user list successfully, confirming the source of truth for LeadSquared access is reachable for downstream access reviews. | Confirm the Access Key/Secret Key pair is valid and belongs to an active Admin user; regenerate keys under My Profile > Settings > API and Webhooks if authentication fails. |
| `leadsquared.users.inactive_access_revoked` | Deactivated users no longer hold active status | high | A.9.2.6 | Checks users with `StatusCode = 1` (inactive) correspond to employees known to be offboarded, and that no user expected to be offboarded still reports `StatusCode = 0` (active), evidencing timely access revocation. | Deactivate the user under Settings > User Management promptly upon offboarding; confirm the account is not still receiving lead assignments or logging in. |
| `leadsquared.users.admin_role_reviewed` | Users with Admin role are limited to necessary personnel | critical | A.9.2.3 | Checks the count/list of users with `Role` indicating Admin (via `Users.Get`) is limited to an expected, documented set of accounts. | Review the Admin-role user list and downgrade any account that does not require full administrative access to a scoped role (e.g. Marketing User, Sales User). |
| `leadsquared.users.permissions_least_privilege` | User permission-template assignments follow least privilege | high | A.9.2.3 | Checks `PermissionTemplate.svc/User/GetPermissions` for each user does not grant broad `Delete`/`Export`/`Import` access on sensitive entities (e.g. Lead) beyond what the user's role requires. | Edit the user's assigned permission template(s) to remove Delete/Export/Import access on entities the role does not require; assign a narrower template instead of the default broad one. |
| `leadsquared.users.no_shared_credentials` | No evidence of shared/generic user accounts | medium | A.9.2.1 | Checks the user list for accounts with generic naming patterns (e.g. "admin", "support", "test") that suggest shared credentials rather than individually attributable accounts. | Replace shared/generic accounts with individually attributable named user accounts; disable the generic account once individual accounts are provisioned. |
| `leadsquared.audit.activity_change_history_available` | Activity change history is available and populated | medium | A.12.4.1 | Checks `Get Activity Change History` returns records for the trailing period, evidencing that field-level change logging on lead/prospect activity data is active. Note: this does not cover account-level security/admin audit events (see caveat in Section 3) — it is scoped to activity data changes only. | If no change history is returned, confirm activities are being logged normally in LeadSquared; this check does not substitute for a security/admin audit log, which LeadSquared does not expose via API per current documentation. |
| `leadsquared.audit.api_logs_reviewed` | API access logs have been reviewed (manual — UI-only) | low | A.12.4.1 | Placeholder check: LeadSquared's API Logs (My Profile > Settings > API and Webhooks > API Logs) are UI-only per LeadSquared's help documentation and not exposed as a queryable API; requires periodic manual review/export as evidence until an API is confirmed. | Periodically review API Logs in the LeadSquared web application and upload a screenshot/export as manual evidence; contact LeadSquared support if programmatic access to these logs becomes a requirement. |

## 5. Seed SQL

```sql
-- ===== LeadSquared connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('leadsquared', 'LeadSquared', 'crm', 'api_key', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('leadsquared', 'leadsquared.users.roster_accessible', 'User roster is retrievable via API', 'Checks the user list endpoint returns successfully, confirming the source of truth for LeadSquared access is reachable for downstream access reviews.', 'medium', 'Confirm the Access Key/Secret Key pair is valid and belongs to an active Admin user; regenerate keys under My Profile > Settings > API and Webhooks if authentication fails.'),
  ('leadsquared', 'leadsquared.users.inactive_access_revoked', 'Deactivated users no longer hold active status', 'Checks inactive-status users correspond to known offboarded employees, and no user expected to be offboarded still reports an active status, evidencing timely access revocation.', 'high', 'Deactivate the user under Settings > User Management promptly upon offboarding; confirm the account is not still receiving lead assignments or logging in.'),
  ('leadsquared', 'leadsquared.users.admin_role_reviewed', 'Users with Admin role are limited to necessary personnel', 'Checks the count/list of users with an Admin role is limited to an expected, documented set of accounts.', 'critical', 'Review the Admin-role user list and downgrade any account that does not require full administrative access to a scoped role.'),
  ('leadsquared', 'leadsquared.users.permissions_least_privilege', 'User permission-template assignments follow least privilege', 'Checks each user''s permission template assignments do not grant broad Delete/Export/Import access on sensitive entities beyond what the user''s role requires.', 'high', 'Edit the user''s assigned permission template(s) to remove Delete/Export/Import access on entities the role does not require; assign a narrower template instead of the default broad one.'),
  ('leadsquared', 'leadsquared.users.no_shared_credentials', 'No evidence of shared/generic user accounts', 'Checks the user list for accounts with generic naming patterns that suggest shared credentials rather than individually attributable accounts.', 'medium', 'Replace shared/generic accounts with individually attributable named user accounts; disable the generic account once individual accounts are provisioned.'),
  ('leadsquared', 'leadsquared.audit.activity_change_history_available', 'Activity change history is available and populated', 'Checks activity change history returns records for the trailing period, evidencing field-level change logging on lead/prospect activity data is active. Scoped to activity data changes only, not account-level security/admin events.', 'medium', 'If no change history is returned, confirm activities are being logged normally in LeadSquared; this does not substitute for a security/admin audit log, which is not exposed via API per current documentation.'),
  ('leadsquared', 'leadsquared.audit.api_logs_reviewed', 'API access logs have been reviewed (manual - UI-only)', 'Placeholder check: LeadSquared API Logs are UI-only and not exposed as a queryable API; requires periodic manual review/export as evidence until an API is confirmed.', 'low', 'Periodically review API Logs in the LeadSquared web application and upload a screenshot/export as manual evidence; contact LeadSquared support if programmatic access to these logs becomes a requirement.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('leadsquared.users.roster_accessible', 'A.9.2.1'),
  ('leadsquared.users.inactive_access_revoked', 'A.9.2.6'),
  ('leadsquared.users.admin_role_reviewed', 'A.9.2.3'),
  ('leadsquared.users.permissions_least_privilege', 'A.9.2.3'),
  ('leadsquared.users.no_shared_credentials', 'A.9.2.1'),
  ('leadsquared.audit.activity_change_history_available', 'A.12.4.1'),
  ('leadsquared.audit.api_logs_reviewed', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `leadsquared` (used in `registry.js`).
- **Suggested files**:
  - `api/src/connectors/leadsquared/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/aws/index.js`'s structure.
  - `api/src/connectors/leadsquared/credentials.js` — `resolveLeadSquaredCredentials({ authType, config, secret })`: no token exchange needed (static key pair); simply validates presence of `accessKey`/`secretKey`/`apiHost` and returns them for the client to attach as headers.
  - `api/src/connectors/leadsquared/client.js` — thin `fetch` wrapper for `{config.apiHost}/...` attaching `x-LSQ-AccessKey`/`x-LSQ-SecretKey` headers, with basic rate-limit-aware throttling (respect the 5-second sliding window from Section 3 — e.g. a simple token-bucket limiter defaulting to the Pro-plan numbers unless `config.plan === "super"`).
  - `api/src/connectors/leadsquared/tests/users.js` — `leadsquared.users.*` checks (roster, inactive-access, admin-role, least-privilege, shared-credential heuristics).
  - `api/src/connectors/leadsquared/tests/audit.js` — `leadsquared.audit.activity_change_history_available`; `leadsquared.audit.api_logs_reviewed` should likely be modeled as a manual-evidence control rather than a `run()`-based API check, since there's no API for it (same modeling question flagged in the Keka/Darwinbox docs for their manual placeholders).
- **Registry wiring**: add `import * as leadsquared from "./leadsquared/index.js";` and `[leadsquared.key]: leadsquared` to `api/src/connectors/registry.js`.
- **`testConnection()`**: call `Users.Get` with a minimal/paged request as a cheap connectivity probe (no dedicated "whoami"/identity endpoint was identified — the user list call itself is the practical connectivity check, since an invalid key pair returns `401 Unauthorized` per the documented error behavior) and return `{ ok: true, externalAccountId: config.apiHost }` (LeadSquared does not appear to expose a distinct account/tenant ID separate from the host+keys, based on sources consulted — confirm this before finalizing what to store as `externalAccountId`).
- **Confirm before implementation**: (a) exact `Users.Get` pagination parameters, (b) exact `Role` field values/enum (to reliably detect "Admin" vs. other roles programmatically), and (c) whether `GetPermissions` requires a `userId` per call (looping over all users) or supports a bulk mode — the documentation snippet obtained only confirms a per-user shape.
