# ServiceNow Connector

## 1. Overview

- **Proposed `integrations.category`**: `business_apps`
- **Proposed `integrations.key`**: `servicenow`
- **Proposed `integrations.auth_type`**: `oauth2`

ServiceNow is a cloud SaaS ITSM/ITOM/GRC platform with a well-documented REST Table API and a standard OAuth2 story. This connector reads user, role, group, ACL, and audit configuration from a customer's ServiceNow instance to evidence identity/access-management controls (ISO 27001 Annex A.9) and configuration/change controls (A.12, A.14).

Scope for v1: read-only checks against `sys_user`, `sys_user_role`, `sys_user_group`, `sys_user_has_role`, `sys_security_acl`, and `sys_audit`/`syslog` records. No write access is required — every check is a `GET` against the Table API.

## 2. Authentication

**`auth_type`: `oauth2`**

ServiceNow supports Basic Auth, OAuth 2.0 Authorization Code, and (since the Washington DC release) **OAuth 2.0 Client Credentials** for inbound machine-to-machine integrations. For an unattended background integration like Prism's evidence collector, **OAuth 2.0 Client Credentials** is the correct choice:

- No end-user password stored, no interactive consent/redirect needed (unlike Authorization Code).
- More secure than Basic Auth, which ServiceNow's own guidance now discourages for REST integrations in favor of OAuth — and Basic Auth can be disabled instance-wide via the REST API Access Policy feature once OAuth is adopted, which most security-conscious customers do.
- Requires a system property to be enabled instance-wide (`glide.oauth.inbound.client.credential.grant_type.enabled`) — call this out explicitly in setup since it's not on by default on older instance releases.

### Setup steps (ServiceNow admin console)

1. As an instance admin, navigate to **System Properties > Security**, and confirm/set `glide.oauth.inbound.client.credential.grant_type.enabled = true` (required for the Client Credentials grant; on Washington DC+ releases this may already default appropriately — verify per instance).
2. Navigate to **System OAuth > Application Registry > New**, and choose **"Create an OAuth API endpoint for external clients."**
3. Fill in **Name** (e.g. "Prism Evidence Collector"), leave **Client ID**/**Client Secret** to auto-generate, set **Accessible from** to "All application scopes" (or scope it to the API scope Prism needs if the instance uses scoped apps), and check **Active**.
4. Do **not** enable "Public Client" — per RFC 6749 §4.4 only confidential clients should use the Client Credentials grant, and ServiceNow's own guidance flags this.
5. Add the **OAuth Application User** field to the registry form (it's not shown by default) and set it to a dedicated integration user (create one if it doesn't exist, e.g. `svc.prism.integration`).
6. Create the integration user under **User Administration > Users** with **Web service access only** checked (so it cannot log in interactively) and assign it a minimal role set: `snc_platform_rest_api_access` plus a custom read-only role scoped to `sys_user`, `sys_user_role`, `sys_user_group`, `sys_user_has_role`, `sys_security_acl`, and `sys_audit` (avoid `admin` or `itil` unless the instance's ACLs require it for these tables — many out-of-box ACLs on `sys_security_acl`/`sys_audit` require elevated roles; confirm against the instance's actual ACL config, since Prism should be granted the narrowest role that can read these tables).
7. Optionally: configure a **REST API Access Policy** restricting these tables to OAuth-only (blocking Basic Auth) for defense in depth.
8. Record the instance's base URL (e.g. `https://yourinstance.service-now.com`), the **Client ID**, and **Client Secret** from the Application Registry record.

### `config` shape

```json
{
  "instanceUrl": "https://yourinstance.service-now.com",
  "clientId": "a1b2c3d4e5f6..."
}
```

### `secret` shape

```json
{
  "clientSecret": "***",
  "username": "svc.prism.integration",
  "password": "***"
}
```

Note: ServiceNow's inbound Client Credentials grant, per its own community documentation, still associates the token with an **OAuth Application User** for auditing/impersonation context — some instance configurations require a username/password pair bound to that service account in addition to `client_id`/`client_secret` depending on release; confirm against the target instance and prefer omitting `username`/`password` (pure client_credentials, no resource-owner password) wherever the release supports it.

## 3. API Reference

- **Base URL**: `{instanceUrl}/api/now/`.
- **Query interface**: **Table API** — `GET /api/now/table/{tableName}` with `sysparm_query` (encoded query string, ServiceNow's own query syntax, e.g. `active=true^roles=admin`), `sysparm_fields` to select only needed columns, and `sysparm_display_value=true` where human-readable values (vs. sys_ids) are needed.
- **Key tables**:
  - `sys_user` — user records (`active`, `locked_out`, `last_login`, `user_password` metadata).
  - `sys_user_role` — role definitions.
  - `sys_user_has_role` — user-to-role assignments (join table).
  - `sys_user_group` — groups.
  - `sys_user_grmember` — group membership.
  - `sys_security_acl` — Access Control List rules (`name`, `operation`, `admin_overrides`, `roles`).
  - `sys_audit` — field-level audit history (change tracking).
  - `syslog`/`sys_history_set` — system/transaction logs, used for broader activity evidencing.
- **OAuth token endpoint**: `POST {instanceUrl}/oauth_token.do` with `grant_type=client_credentials&client_id=...&client_secret=...` (form-encoded), returning a bearer `access_token` with a TTL (default 30 min; refresh proactively rather than waiting for 401s).
- **Pagination**: `sysparm_limit` (page size; ServiceNow's practical default cap is commonly cited around 10,000 but 100–500 is the recommended range for consistent performance) and `sysparm_offset` (records to skip). Offset-based pagination degrades on large tables since the query re-executes and discards prior rows each page — keep page sizes modest (e.g. 250) and prefer narrow `sysparm_query` filters (e.g. `active=true`) over paging through an entire table.
- **Rate limits**: instance-specific (no universal published number); the connector should treat HTTP 429 responses with exponential backoff and respect any `Retry-After` header returned.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `servicenow.user.no_inactive_privileged` | No inactive users retain a privileged role | high | A.9.2.1 | Checks `sys_user` records with `active=false` do not still have rows in `sys_user_has_role` for admin-tier roles (`admin`, `security_admin`, `user_admin`). | Remove the role assignment via `sys_user_has_role` when deactivating a user, or run a scheduled cleanup job for stale privileged assignments. |
| `servicenow.user.mfa_enforced` | Multi-factor authentication is enforced instance-wide | critical | A.9.4.2 | Checks the instance's MFA enforcement property (`glide.authenticate.multifactor.enabled` and related enforcement group membership) requires MFA for all users, not an opt-in subset. | Enable Multi-Factor Authentication under System Security > Multi-Factor Authentication and enforce it for all user criteria groups, not just admins. |
| `servicenow.role.admin_count_within_policy` | Number of users with the `admin` role is within policy | medium | A.9.2.3 | Checks the count of active users holding the `admin` role in `sys_user_has_role` does not exceed the configured threshold. | Review `admin` role assignments and move users who don't require full admin rights to a scoped custom role instead. |
| `servicenow.acl.default_deny_sensitive_tables` | Sensitive tables have explicit (non-public) ACLs defined | high | A.9.4.1 | Checks `sys_security_acl` has explicit role-restricted read/write rules for sensitive tables (`sys_user`, `sys_user_has_role`, `sys_security_acl` itself) rather than relying on an open/public default. | Add or tighten an ACL rule on the table restricting the operation to an explicit role list under System Security > Access Control (ACL). |
| `servicenow.group.privileged_groups_reviewed` | Privileged groups have a bounded, reviewed membership | medium | A.9.2.5 | Checks `sys_user_group` records flagged as privileged (e.g. containing "admin" in name/description, or mapped to admin roles) have membership counts within the configured threshold via `sys_user_grmember`. | Review membership of the flagged group and remove members without a documented business need for privileged group access. |
| `servicenow.integrationuser.web_service_only` | Integration/service accounts are restricted to web service access | high | A.9.2.3 | Checks known integration users (`user_name` matching a configured service-account naming convention, e.g. `svc.*`) have `web_service_access_only=true`, preventing interactive login with a service credential. | Edit the service account user record and check "Web service access only". |
| `servicenow.password_policy.strength_enforced` | Password policy meets minimum strength requirements | high | A.9.4.3 | Checks the instance's password policy (`sys_properties` / Password Policy plugin records) enforces minimum length, complexity, and expiration consistent with company baseline. | Update the applicable Password Policy record under User Administration > Password Policies. |
| `servicenow.audit.field_audit_enabled` | Field-level audit history is enabled for sensitive tables | medium | A.12.4.1 | Checks `sys_audit` is actively recording changes (non-empty, recent entries) for sensitive tables like `sys_user` and `sys_security_acl`, confirming the "Audit" flag is enabled on those tables/fields. | Enable the "Audit" flag on the table/dictionary entry under System Definition > Tables, or via the Field Audit related list. |
| `servicenow.audit.login_activity_logged` | User login activity is logged and retrievable | medium | A.12.4.1 | Checks login-event records (`sys_user` `last_login`/`login_count`, or a dedicated login/session log table if enabled) reflect recent activity, evidencing login auditing hasn't been disabled. | Confirm the relevant logging plugin/property is enabled and no scheduled cleanup job is purging login records prematurely. |
| `servicenow.oauth.basic_auth_restricted` | Basic Authentication is restricted for REST API access | high | A.9.4.2 | Checks a REST API Access Policy is configured to block Basic Auth on sensitive table endpoints, forcing OAuth-only access. | Create a REST API Access Policy under System Web Services > API Access Policies restricting the target tables to OAuth authentication only. |

## 5. Seed SQL

```sql
-- ===== ServiceNow connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('servicenow', 'ServiceNow', 'business_apps', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('servicenow', 'servicenow.user.no_inactive_privileged', 'No inactive users retain a privileged role', 'Checks inactive users do not still have admin-tier role assignments (admin, security_admin, user_admin).', 'high', 'Remove the role assignment when deactivating a user, or run a scheduled cleanup job for stale privileged assignments.'),
  ('servicenow', 'servicenow.user.mfa_enforced', 'Multi-factor authentication is enforced instance-wide', 'Checks the instance''s MFA enforcement requires MFA for all users, not an opt-in subset.', 'critical', 'Enable Multi-Factor Authentication under System Security > Multi-Factor Authentication and enforce it for all user criteria groups, not just admins.'),
  ('servicenow', 'servicenow.role.admin_count_within_policy', 'Number of users with the admin role is within policy', 'Checks the count of active users holding the admin role does not exceed the configured threshold.', 'medium', 'Review admin role assignments and move users who don''t require full admin rights to a scoped custom role instead.'),
  ('servicenow', 'servicenow.acl.default_deny_sensitive_tables', 'Sensitive tables have explicit (non-public) ACLs defined', 'Checks ACL rules exist restricting read/write on sensitive tables rather than relying on an open/public default.', 'high', 'Add or tighten an ACL rule on the table restricting the operation to an explicit role list under System Security > Access Control (ACL).'),
  ('servicenow', 'servicenow.group.privileged_groups_reviewed', 'Privileged groups have a bounded, reviewed membership', 'Checks privileged groups have membership counts within the configured threshold.', 'medium', 'Review membership of the flagged group and remove members without a documented business need for privileged group access.'),
  ('servicenow', 'servicenow.integrationuser.web_service_only', 'Integration/service accounts are restricted to web service access', 'Checks known integration/service users have web service access only, preventing interactive login with a service credential.', 'high', 'Edit the service account user record and check "Web service access only".'),
  ('servicenow', 'servicenow.password_policy.strength_enforced', 'Password policy meets minimum strength requirements', 'Checks the instance''s password policy enforces minimum length, complexity, and expiration consistent with company baseline.', 'high', 'Update the applicable Password Policy record under User Administration > Password Policies.'),
  ('servicenow', 'servicenow.audit.field_audit_enabled', 'Field-level audit history is enabled for sensitive tables', 'Checks field-level audit is actively recording changes for sensitive tables like sys_user and sys_security_acl.', 'medium', 'Enable the Audit flag on the table/dictionary entry under System Definition > Tables, or via the Field Audit related list.'),
  ('servicenow', 'servicenow.audit.login_activity_logged', 'User login activity is logged and retrievable', 'Checks login-event records reflect recent activity, evidencing login auditing hasn''t been disabled.', 'medium', 'Confirm the relevant logging plugin/property is enabled and no scheduled cleanup job is purging login records prematurely.'),
  ('servicenow', 'servicenow.oauth.basic_auth_restricted', 'Basic Authentication is restricted for REST API access', 'Checks a REST API Access Policy blocks Basic Auth on sensitive table endpoints, forcing OAuth-only access.', 'high', 'Create a REST API Access Policy under System Web Services > API Access Policies restricting the target tables to OAuth authentication only.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('servicenow.user.no_inactive_privileged', 'A.9.2.1'),
  ('servicenow.user.mfa_enforced', 'A.9.4.2'),
  ('servicenow.role.admin_count_within_policy', 'A.9.2.3'),
  ('servicenow.acl.default_deny_sensitive_tables', 'A.9.4.1'),
  ('servicenow.group.privileged_groups_reviewed', 'A.9.2.5'),
  ('servicenow.integrationuser.web_service_only', 'A.9.2.3'),
  ('servicenow.password_policy.strength_enforced', 'A.9.4.3'),
  ('servicenow.audit.field_audit_enabled', 'A.12.4.1'),
  ('servicenow.audit.login_activity_logged', 'A.12.4.1'),
  ('servicenow.oauth.basic_auth_restricted', 'A.9.4.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `servicenow` (used in `registry.js`).
- **Suggested files**:
  - `api/src/connectors/servicenow/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/azure/index.js`.
  - `api/src/connectors/servicenow/credentials.js` — `resolveServiceNowCredentials({ authType, config, secret })`: POSTs `grant_type=client_credentials` to `{config.instanceUrl}/oauth_token.do`, returns `{ accessToken, expiresIn }`; connector should cache/refresh proactively before the ~30 min TTL expires.
  - `api/src/connectors/servicenow/client.js` — thin `fetch` wrapper for `GET /api/now/table/{table}` with `sysparm_query`/`sysparm_fields`/`sysparm_limit`/`sysparm_offset` pagination and 429 backoff.
  - `api/src/connectors/servicenow/tests/users.js`, `tests/roles.js`, `tests/acls.js`, `tests/audit.js` — grouped by resource area, matching the `api/src/connectors/aws/tests/*.js` split.
- **Registry wiring**: add `import * as servicenow from "./servicenow/index.js";` and `[servicenow.key]: servicenow` to `api/src/connectors/registry.js`.
- **`testConnection()`** should probe a cheap, always-permitted table, e.g. `GET /api/now/table/sys_user?sysparm_limit=1`, and return `{ ok: true, externalAccountId: config.instanceUrl }` (ServiceNow instances don't expose a distinct "account id" the way AWS/Salesforce orgs do — the instance URL itself is the natural identifier).
- Confirm during onboarding which ACL/role combination the target instance actually requires to read `sys_security_acl` and `sys_audit` — some instances lock these behind `security_admin` rather than a scoped custom role; document the minimum role per customer if it varies.
- Ready to build now — no external dependency on customer network access; this is a standard OAuth2 SaaS integration.
