# Salesforce Connector

## 1. Overview

- **Proposed `integrations.category`**: `business_apps`
- **Proposed `integrations.key`**: `salesforce`
- **Proposed `integrations.auth_type`**: `oauth2`

Salesforce is a cloud SaaS CRM with a mature, well-documented REST API surface and a standard OAuth2 story for server-to-server integrations. This connector reads user/profile/permission/MFA/audit configuration from a customer's Salesforce org to evidence identity and access-management controls (ISO 27001 Annex A.9) plus logging/audit controls (A.12.4).

Scope for v1: read-only checks against Setup metadata (users, profiles, permission sets, connected apps, MFA/session policy) and the Setup Audit Trail. No write access is required — every check is a `SELECT`/metadata-read operation.

## 2. Authentication

**`auth_type`: `oauth2`**

Salesforce supports several OAuth2 flows. For a background, unattended integration like Prism's evidence collector, the **OAuth 2.0 JWT Bearer Flow** is Salesforce's current recommendation over the deprecated username-password flow:

- It is server-to-server: no interactive login, no stored end-user password, no session to keep alive.
- It authenticates via a digital signature (an uploaded X.509 certificate) rather than a client secret, which Salesforce documents as the more secure option for this integration pattern.
- The deprecated **OAuth 2.0 Username-Password Flow** requires storing the org password + security token and is explicitly discouraged by Salesforce for new integrations (and is being phased toward removal) — do not implement it.
- Note: as of Spring '26, Salesforce disables creation of new "Connected Apps" by default in favor of **External Client Apps**, which use the same JWT Bearer flow and scope model. Setup steps below use Connected App terminology (still supported for existing orgs / can be re-enabled) but call out the External Client App equivalent.

### Setup steps (Salesforce Setup)

1. **Generate a certificate keypair** (RSA, 2048-bit minimum) locally, e.g. `openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout salesforce.key -out salesforce.crt`. Prism stores the private key as `secret.privateKey`; the `.crt` is uploaded to Salesforce only.
2. In Salesforce Setup, go to **App Manager > New Connected App** (or **External Client App Manager > New External Client App** on Spring '26+ orgs).
3. Enable OAuth Settings. Set the callback URL to a placeholder (e.g. `https://login.salesforce.com/services/oauth2/callback`) — it's unused by the JWT flow but required by the form.
4. Under **Use digital signatures**, upload the `.crt` file generated in step 1.
5. Select OAuth scopes: **`api`** (Manage user data via APIs — required for all REST/SOQL calls) and **`refresh_token`, `offline_access`** (Perform requests at any time — required so the JWT-issued token lifecycle works unattended). Do not select broader scopes (e.g. `full`, `web`) than needed.
6. Save, then wait for the app to propagate (Salesforce documents this can take up to 10 minutes).
7. Under **Manage Connected Apps > (this app) > Edit Policies**, set **Permitted Users** to "Admin approved users are pre-authorized", then add the integration user's profile or a dedicated permission set under **Manage Profiles/Permission Sets**.
8. Create (or reuse) a dedicated **integration user** with a minimal permission set: `API Enabled`, `View Setup and Configuration`, `View All Data` (read-only equivalents) — avoid granting `Modify All Data`.
9. Record the **Consumer Key** (`client_id`) from the Connected App's Manage Consumer Details page.
10. Note the org's **My Domain** login URL (e.g. `https://yourorg.my.salesforce.com`) — required as the JWT audience/token endpoint host.

### `config` shape (non-secret, stored on `integration_connections.config`)

```json
{
  "loginUrl": "https://yourorg.my.salesforce.com",
  "clientId": "3MVG9...consumerKey...",
  "username": "integration-user@yourorg.com.prism",
  "apiVersion": "v61.0"
}
```

### `secret` shape (encrypted, stored via `integration_credentials`)

```json
{
  "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
}
```

The connector signs a JWT (`iss` = clientId, `sub` = username, `aud` = login URL, `exp` within 5 minutes — clock skew is the most common cause of JWT auth failures per Salesforce docs) with `privateKey`, then POSTs it to `/services/oauth2/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` to obtain an access token + the org's instance URL.

## 3. API Reference

- **Base URL**: the `instance_url` returned by the token exchange (e.g. `https://yourorg.my.salesforce.com` or a `*.lightning.force.com`/`*.my.salesforce.com` pod-specific host) — never hardcode a pod.
- **Query language**: SOQL (Salesforce Object Query Language) via `GET /services/data/{apiVersion}/query/?q={SOQL}`. Standard objects used: `User`, `Profile`, `PermissionSet`, `PermissionSetAssignment`, `ConnectedApplication` (or `SetupEntityAccess` for connected app grants), `SetupAuditTrail`, `LoginHistory`, `NetworkAccess` (trusted IP ranges), and `SecuritySettings`/`SessionSettings` (via the Metadata API's `Metadata.Security` singleton, since these are org-wide settings not queryable via SOQL).
- **Metadata API**: `POST /services/data/{apiVersion}/tooling/query/` (Tooling API, a superset of SOQL that additionally exposes setup entities like `ProfilePasswordPolicy` and `SecuritySettings` not visible to plain SOQL) is used where Setup-only entities are needed.
- **Pagination**: REST SOQL query results cap at 2,000 rows per page (lower if wide rows/blob fields are selected). A response with more rows includes `nextRecordsUrl`; follow it until `done: true`. The underlying query locator/cursor stays valid for up to 2 days (API v56.0+, "Winter '23"). Do not use client-side `OFFSET` beyond 2,000 rows — page via `nextRecordsUrl` instead.
- **Rate limits**: org-wide daily API request limits apply (tier-dependent, e.g. 15,000–1,000,000+ calls/24h) and are returned via the `Sforce-Limit-Info` response header (`api-usage=X/Y`); the connector should log/back off as usage approaches the ceiling. Concurrent long-running request limits also apply separately from the daily quota.
- **API version**: pin `apiVersion` in `config` (e.g. `v61.0`) so a Salesforce release upgrade doesn't silently change response shapes.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `salesforce.user.mfa_enforced` | Multi-factor authentication is enforced for all users | critical | A.9.4.2 | Checks the org's `SessionSettings`/`SecuritySettings` (or per-profile login policy) requires MFA at login for all profiles, not just high-assurance sessions. | Enable "Require multi-factor authentication (MFA)" under Setup > Session Settings, or assign the "Multi-Factor Authentication for User Interface Logins" permission org-wide. |
| `salesforce.user.no_inactive_high_privilege` | No inactive users retain a high-privilege profile or permission set | high | A.9.2.1 | Checks `User` records with `IsActive = false` do not still carry an admin-tier `Profile` (e.g. System Administrator) or an admin-tier `PermissionSetAssignment`. | Deactivate or reassign the profile/permission set on the inactive user record; deactivated users should be moved to a minimal-access profile before deactivation completes. |
| `salesforce.profile.password_policy_strength` | Org password policy meets minimum strength requirements | high | A.9.4.3 | Checks `PasswordPolicy` (via Tooling API) enforces a minimum length, complexity, and expiration consistent with the company's policy baseline. | Update the password policy under Setup > Password Policies (minimum 8+ characters, complexity required, expiration <= 90 days). |
| `salesforce.profile.least_privilege_admin_count` | Number of users with the System Administrator profile is within policy | medium | A.9.2.3 | Checks the count of active users assigned the System Administrator profile does not exceed the configured threshold. | Review System Administrator assignments and move users who don't require full admin rights to a scoped permission set instead. |
| `salesforce.connected_app.oauth_scopes_minimal` | Connected/External Client Apps do not request excessive OAuth scopes | high | A.9.1.2 | Checks each `ConnectedApplication` grant does not include broad scopes (`full`, `Manage Data`) unless explicitly justified/allow-listed. | Edit the Connected App's OAuth policy to remove unused scopes; prefer narrowly scoped access (`api`, `refresh_token`) over `full`. |
| `salesforce.connected_app.admin_approval_required` | Connected Apps require admin pre-authorization | high | A.9.2.2 | Checks each Connected App's OAuth policy has "Permitted Users" set to "Admin approved users are pre-authorized" rather than "All users may self-authorize". | Set the Connected App's OAuth Policies > Permitted Users to admin-approved and explicitly assign the profiles/permission sets that need it. |
| `salesforce.audit.setup_audit_trail_retention` | Setup Audit Trail history is available for the required retention window | medium | A.12.4.1 | Checks `SetupAuditTrail` records exist covering at least the last 180 days (Salesforce's standard retention window), confirming audit history isn't being lost. | If gaps exist, export Setup Audit Trail on a recurring schedule to external storage before the 180-day platform retention window rolls off. |
| `salesforce.audit.login_history_available` | Login History is retained and queryable | medium | A.12.4.1 | Checks `LoginHistory` returns records for the trailing period, evidencing login/audit logging is active (not disabled or purged). | Confirm no automation is purging LoginHistory; escalate to Salesforce support if login events stop appearing. |
| `salesforce.network.trusted_ip_ranges_configured` | Login IP restrictions or trusted ranges are configured | medium | A.13.1.1 | Checks the org has configured login IP ranges (org-wide or per-profile) rather than allowing sign-in from any network. | Configure Setup > Network Access trusted IP ranges, or set profile-level Login IP Ranges for sensitive profiles. |
| `salesforce.permissionset.sensitive_permissions_reviewed` | Sensitive system permissions are limited to a reviewed set of assignees | high | A.9.2.3 | Checks permission sets/profiles granting sensitive system permissions (`ModifyAllData`, `ViewAllData`, `ManageUsers`, `ApiEnabled` combined with `ModifyAllData`) are assigned only to an expected, documented set of users. | Audit `PermissionSetAssignment` for the flagged permissions and remove assignments not tied to a documented business justification. |

## 5. Seed SQL

```sql
-- ===== Salesforce connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('salesforce', 'Salesforce', 'business_apps', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('salesforce', 'salesforce.user.mfa_enforced', 'Multi-factor authentication is enforced for all users', 'Checks the org''s session/security settings require MFA at login for all profiles, not just high-assurance sessions.', 'critical', 'Enable "Require multi-factor authentication (MFA)" under Setup > Session Settings, or assign the "Multi-Factor Authentication for User Interface Logins" permission org-wide.'),
  ('salesforce', 'salesforce.user.no_inactive_high_privilege', 'No inactive users retain a high-privilege profile or permission set', 'Checks inactive users do not still carry an admin-tier profile or an admin-tier permission set assignment.', 'high', 'Deactivate or reassign the profile/permission set on the inactive user record; deactivated users should be moved to a minimal-access profile before deactivation completes.'),
  ('salesforce', 'salesforce.profile.password_policy_strength', 'Org password policy meets minimum strength requirements', 'Checks the password policy enforces a minimum length, complexity, and expiration consistent with the company''s policy baseline.', 'high', 'Update the password policy under Setup > Password Policies (minimum 8+ characters, complexity required, expiration <= 90 days).'),
  ('salesforce', 'salesforce.profile.least_privilege_admin_count', 'Number of users with the System Administrator profile is within policy', 'Checks the count of active users assigned the System Administrator profile does not exceed the configured threshold.', 'medium', 'Review System Administrator assignments and move users who don''t require full admin rights to a scoped permission set instead.'),
  ('salesforce', 'salesforce.connected_app.oauth_scopes_minimal', 'Connected/External Client Apps do not request excessive OAuth scopes', 'Checks each connected app grant does not include broad scopes (full, Manage Data) unless explicitly justified/allow-listed.', 'high', 'Edit the Connected App''s OAuth policy to remove unused scopes; prefer narrowly scoped access (api, refresh_token) over full.'),
  ('salesforce', 'salesforce.connected_app.admin_approval_required', 'Connected Apps require admin pre-authorization', 'Checks each Connected App''s OAuth policy has Permitted Users set to admin-approved rather than self-authorize.', 'high', 'Set the Connected App''s OAuth Policies > Permitted Users to admin-approved and explicitly assign the profiles/permission sets that need it.'),
  ('salesforce', 'salesforce.audit.setup_audit_trail_retention', 'Setup Audit Trail history is available for the required retention window', 'Checks Setup Audit Trail records exist covering at least the last 180 days, confirming audit history isn''t being lost.', 'medium', 'If gaps exist, export Setup Audit Trail on a recurring schedule to external storage before the 180-day platform retention window rolls off.'),
  ('salesforce', 'salesforce.audit.login_history_available', 'Login History is retained and queryable', 'Checks Login History returns records for the trailing period, evidencing login/audit logging is active.', 'medium', 'Confirm no automation is purging Login History; escalate to Salesforce support if login events stop appearing.'),
  ('salesforce', 'salesforce.network.trusted_ip_ranges_configured', 'Login IP restrictions or trusted ranges are configured', 'Checks the org has configured login IP ranges (org-wide or per-profile) rather than allowing sign-in from any network.', 'medium', 'Configure Setup > Network Access trusted IP ranges, or set profile-level Login IP Ranges for sensitive profiles.'),
  ('salesforce', 'salesforce.permissionset.sensitive_permissions_reviewed', 'Sensitive system permissions are limited to a reviewed set of assignees', 'Checks permission sets/profiles granting sensitive system permissions are assigned only to an expected, documented set of users.', 'high', 'Audit permission set assignments for the flagged permissions and remove assignments not tied to a documented business justification.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('salesforce.user.mfa_enforced', 'A.9.4.2'),
  ('salesforce.user.no_inactive_high_privilege', 'A.9.2.1'),
  ('salesforce.profile.password_policy_strength', 'A.9.4.3'),
  ('salesforce.profile.least_privilege_admin_count', 'A.9.2.3'),
  ('salesforce.connected_app.oauth_scopes_minimal', 'A.9.1.2'),
  ('salesforce.connected_app.admin_approval_required', 'A.9.2.2'),
  ('salesforce.audit.setup_audit_trail_retention', 'A.12.4.1'),
  ('salesforce.audit.login_history_available', 'A.12.4.1'),
  ('salesforce.network.trusted_ip_ranges_configured', 'A.13.1.1'),
  ('salesforce.permissionset.sensitive_permissions_reviewed', 'A.9.2.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `salesforce` (used in `registry.js`).
- **Suggested files**:
  - `api/src/connectors/salesforce/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/azure/index.js`'s structure (build a small SOQL/Tooling API client, run each test's `run(clients)`).
  - `api/src/connectors/salesforce/credentials.js` — `resolveSalesforceCredentials({ authType, config, secret })`: builds the signed JWT, POSTs to `{config.loginUrl}/services/oauth2/token`, returns `{ accessToken, instanceUrl }`. Consider a thin `jsonwebtoken`-based signer (RS256) rather than pulling in a full Salesforce SDK.
  - `api/src/connectors/salesforce/client.js` — small wrapper around `fetch` for `query()` (follows `nextRecordsUrl`) and `toolingQuery()`, plus `Sforce-Limit-Info` header parsing for rate-limit logging.
  - `api/src/connectors/salesforce/tests/users.js`, `tests/profiles.js`, `tests/connectedApps.js`, `tests/audit.js` — grouped the same way `api/src/connectors/aws/tests/*.js` is split by resource area.
- **Registry wiring**: add `import * as salesforce from "./salesforce/index.js";` and `[salesforce.key]: salesforce` to `api/src/connectors/registry.js`, matching the existing one-line-per-connector shape.
- **`testConnection()`** should perform a cheap connectivity probe — e.g. `SELECT Id FROM Organization LIMIT 1` — analogous to AWS's `GetCallerIdentity` / Azure's `resourceGroups.list().next()` pattern, and return `{ ok: true, externalAccountId: <Organization Id> }`.
- Ready to build now — no external dependency on customer network access; this is a standard OAuth2 SaaS integration.
