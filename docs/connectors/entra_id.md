# Microsoft Entra ID Connector (proposed)

Status: design spec, not yet implemented. Follows the existing connector pattern (see
`api/src/connectors/azure/` for the OAuth2/client-credentials shape and `api/src/connectors/purview/`
for the plain-`fetch` + cached-token-getter shape this connector should copy instead of the Azure
SDK client shape, since Entra ID checks call Microsoft Graph over HTTPS, not an ARM SDK).

## 1. Overview

- **Connector key**: `entra_id`
- **Category**: `identity` (free-text, no DB constraint — matches the informal convention of
  `cloud` for aws/azure, `devops` for github, `data_governance` for purview).
- **Audit scope**: directory users and groups, directory role assignments, MFA / Conditional
  Access enforcement, authentication methods policy, Enterprise Applications / App Registrations
  / Service Principals and their API permission grants, and sign-in / directory audit log
  availability.
- **Boundary vs. the other 4 Microsoft connectors in this group**: Entra ID owns identity and
  access management *for the tenant itself* (who exists, what they can sign in as, what they're
  allowed to do, what apps can act as them). It does **not** own:
  - Exchange/SharePoint/OneDrive/Intune application-level configuration — that's `microsoft_365`.
  - Teams-specific guest/external-access/policy settings — that's `microsoft_teams` (even though
    Teams guest access is technically an Entra ID B2B feature, the Teams-scoped checks live in
    that connector to avoid two connectors racing to report the same finding).
  - Device compliance/threat data — that's `microsoft_defender`.
  - Data governance (Data Map scans, classification, sensitivity labels, unified audit log
    subscriptions) — that's the existing `purview` connector.
  - Azure resource-level config (subscriptions, VMs, storage, SQL, Key Vault, etc.) — that's the
    existing `azure` connector, which uses ARM, not Graph, and is a structurally separate identity
    (Azure RBAC) from the Entra ID directory roles this connector reads.

## 2. Authentication

- **`auth_type`**: `oauth2` — an Azure AD app registration authenticated via the OAuth2
  client-credentials grant (no user, no browser), exactly like the existing `azure` connector's
  `ClientSecretCredential` and the existing `purview` connector's `fetchToken()`. This connector
  should use the **same shared token-acquisition helper** as `microsoft_365`, `microsoft_teams`,
  and `microsoft_defender` (see Implementation Notes) rather than reimplementing the client-credentials
  POST inline a fourth time.

### Setup steps (performed once by the customer's Entra ID admin)

1. Sign in to the [Azure portal](https://portal.azure.com) as at least a **Cloud Application
   Administrator** (Global Administrator is also sufficient but not least-privilege).
2. Navigate to **Microsoft Entra ID > App registrations > New registration**. Name it (e.g.
   "Prism Compliance Connector"), leave the redirect URI blank (this is a daemon app, not
   interactive), and select **Register**. If the customer already created this app registration
   for the `microsoft_365`/`microsoft_teams`/`microsoft_defender` connectors, reuse it instead of
   creating a new one — see "Shared app registration" below.
3. Note the **Application (client) ID** and **Directory (tenant) ID** from the app's Overview page.
4. **Certificates & secrets > New client secret** — create a secret, copy its value immediately
   (it is not retrievable later). This becomes `secret.clientSecret`.
5. **API permissions > Add a permission > Microsoft Graph > Application permissions**, add:
   - `User.Read.All` — least-privileged read for the guest-account-hygiene check.
   - `RoleManagement.Read.Directory` — least-privileged read for directory role assignments
     (`/roleManagement/directory/roleAssignments`, `/directoryRoles`), needed instead of the much
     broader `Directory.Read.All`.
   - `Policy.Read.All` — Conditional Access policies; also required (alongside `AuditLog.Read.All`)
     for the `appliedConditionalAccessPolicies` field to appear on sign-in log entries.
   - `Policy.Read.AuthenticationMethod` — the tenant's authentication methods policy (SMS/voice/
     Authenticator/FIDO2 enablement), distinct from `UserAuthenticationMethod.Read.All` which
     reads *per-user* registered methods and is not needed for these tenant-level checks.
   - `Application.Read.All` — app registrations, service principals, and their `appRoleAssignments`
     (API permission grants) and credential (`keyCredentials`/`passwordCredentials`) expiry.
   - `AuditLog.Read.All` — sign-in logs (`/auditLogs/signIns`) and directory audit logs
     (`/auditLogs/directoryAudits`), and `user.signInActivity` staleness data.
6. Select **Grant admin consent for `<tenant>`** — every permission above requires admin consent
   and none can be delegated/user-consented.
7. In Prism, create the `entra_id` integration connection and enter the `config`/`secret` below.

### Shared app registration across the Microsoft connector group

All five Microsoft-ecosystem connectors (`entra_id`, `microsoft_365`, `azure`, `microsoft_teams`,
`microsoft_defender`) can point at **one** Azure AD app registration — the customer just adds each
connector's required API permissions (Graph scopes here; Exchange/Teams/Defender-specific
resources for the other connectors) to the same app object, and grants admin consent once per
permission. Prism still stores one `integration_connections` row (and one encrypted `secret`) per
connector — the customer re-enters the same `tenantId`/`clientId`/`clientSecret` triple into each
connector's setup form. This mirrors how a single GitHub App can back multiple future
GitHub-adjacent connectors; it isn't a new pattern.

### `config` / `secret` shapes

```json
// integration_connections.config
{
  "tenantId": "contoso.onmicrosoft.com"
}
```

```json
// integration_credentials (decrypted secret shape)
{
  "clientId": "11111111-1111-1111-1111-111111111111",
  "clientSecret": "<client secret value>"
}
```

## 3. API Reference

- **Base URL**: `https://graph.microsoft.com/v1.0` (all checks below are available in v1.0; none
  require `/beta`).
- **Pagination**: standard Graph `@odata.nextLink` cursor — follow it until absent, same shape the
  connector should reuse for `/users`, `/auditLogs/signIns`, and `/servicePrincipals` list calls.
- **Rate limiting**: Graph returns `429` with a `Retry-After` header on throttling; directory/
  identity workloads have per-tenant, per-app limits documented under Graph throttling guidance —
  the connector should honor `Retry-After` with a single retry, consistent with how
  `describeAzureError`/`describePurviewError` centralize error handling in the other connectors
  (a parallel `describeGraphError` should do the same here).
- **Token acquisition**: `POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`,
  `grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default` — via the shared
  helper, not reimplemented per connector.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `entra_id.mfa.conditional_access_enforced` | Multi-factor authentication is enforced tenant-wide | critical | A.9.4.2 | Checks at least one enabled Conditional Access policy (`GET /identity/conditionalAccess/policies`) requires MFA for all users, or that Security Defaults is enabled as a fallback. | Create a Conditional Access policy requiring MFA for all users and all cloud apps, or enable Security Defaults under Entra ID > Properties if Conditional Access (Entra ID P1/P2) isn't licensed. |
| `entra_id.conditionalaccess.legacy_auth_blocked` | Conditional Access blocks legacy authentication | critical | A.9.4.2 | Checks an enabled Conditional Access policy targets the legacy authentication client apps condition and has a block grant control, preventing basic-auth clients from bypassing modern auth controls. | Create a Conditional Access policy scoping "Other clients" (legacy authentication) and set the grant control to Block access. |
| `entra_id.authmethods.weak_methods_disabled` | Weak authentication methods are disabled | medium | A.9.4.2 | Checks the tenant's authentication methods policy (`GET /policies/authenticationMethodsPolicy`) has SMS and voice call methods disabled in favor of phishing-resistant methods (Authenticator, FIDO2, Windows Hello for Business). | Disable the SMS and Voice call authentication method policies under Entra ID > Authentication methods, and enable Authenticator/FIDO2/Passkey policies instead. |
| `entra_id.roles.privileged_role_assignments_limited` | Global Administrator assignments are limited and not permanent | high | A.9.2.3 | Checks the number of active `Global Administrator` role assignments (`GET /roleManagement/directory/roleAssignments`) does not exceed a defined threshold (default 5) and flags any assignment lacking a PIM-eligible/time-bound scope. | Reduce standing Global Administrator assignments below the threshold, and move remaining assignments to Privileged Identity Management (PIM) eligible (time-bound, activation-required) assignments. |
| `entra_id.users.stale_guest_accounts_reviewed` | Inactive guest accounts are disabled or removed | high | A.9.2.6 | Checks guest users (`GET /users?$filter=userType eq 'Guest'` with `signInActivity`) who have had no interactive sign-in within 90 days are disabled (`accountEnabled: false`) or removed. | Disable or remove guest accounts with no sign-in activity in the last 90 days, or document a business justification for retaining them. |
| `entra_id.enterpriseapps.high_privilege_grants_reviewed` | Enterprise apps with high-privilege Graph permissions are reviewed | high | A.9.4.1 | Checks service principals (`GET /servicePrincipals` + `appRoleAssignments`) holding high-privilege application permissions (e.g. `RoleManagement.ReadWrite.Directory`, `Directory.ReadWrite.All`, `Application.ReadWrite.All`) are documented as reviewed/approved rather than silently present. | Review each flagged enterprise application's business justification; remove the grant or the app registration if it's no longer needed, following least privilege. |
| `entra_id.appregistrations.credentials_not_expiring_soon` | App registration secrets and certificates are rotated before expiry | medium | A.9.2.4 | Checks each app registration's `keyCredentials`/`passwordCredentials` (`GET /applications`) has no credential already expired or expiring within 30 days, and no credential with an original validity period over 12 months. | Rotate the flagged credential now (before expiry causes an outage) and issue new secrets/certificates with a validity period of 12 months or less going forward. |
| `entra_id.audit.signin_and_directory_logs_available` | Sign-in and directory audit logs are actively retained | critical | A.12.4.1 | Checks `GET /auditLogs/signIns` and `GET /auditLogs/directoryAudits` both return entries within the last 24 hours, evidencing that Entra ID auditing is active and not silently stalled. | Investigate why no recent sign-in or audit log entries exist — this can indicate the tenant has no license entitling audit log retention (Entra ID P1/P2), or that the retention period has lapsed. |

## 5. Seed SQL

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('entra_id', 'Microsoft Entra ID', 'identity', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('entra_id', 'entra_id.mfa.conditional_access_enforced', 'Multi-factor authentication is enforced tenant-wide', 'Checks at least one enabled Conditional Access policy requires MFA for all users, or that Security Defaults is enabled as a fallback.', 'critical', 'Create a Conditional Access policy requiring MFA for all users and all cloud apps, or enable Security Defaults if Conditional Access isn''t licensed.'),
  ('entra_id', 'entra_id.conditionalaccess.legacy_auth_blocked', 'Conditional Access blocks legacy authentication', 'Checks an enabled Conditional Access policy blocks legacy (basic) authentication clients.', 'critical', 'Create a Conditional Access policy scoping legacy authentication clients and set the grant control to Block access.'),
  ('entra_id', 'entra_id.authmethods.weak_methods_disabled', 'Weak authentication methods are disabled', 'Checks the tenant authentication methods policy has SMS and voice call methods disabled in favor of phishing-resistant methods.', 'medium', 'Disable SMS and Voice call authentication methods, and enable Authenticator/FIDO2/Passkey policies instead.'),
  ('entra_id', 'entra_id.roles.privileged_role_assignments_limited', 'Global Administrator assignments are limited and not permanent', 'Checks the number of active Global Administrator role assignments does not exceed a defined threshold and flags non-PIM-eligible assignments.', 'high', 'Reduce standing Global Administrator assignments and move remaining assignments to PIM-eligible, time-bound assignments.'),
  ('entra_id', 'entra_id.users.stale_guest_accounts_reviewed', 'Inactive guest accounts are disabled or removed', 'Checks guest users with no interactive sign-in within 90 days are disabled or removed.', 'high', 'Disable or remove guest accounts with no sign-in activity in the last 90 days.'),
  ('entra_id', 'entra_id.enterpriseapps.high_privilege_grants_reviewed', 'Enterprise apps with high-privilege Graph permissions are reviewed', 'Checks service principals holding high-privilege application permissions are documented as reviewed.', 'high', 'Review each flagged application''s business justification and remove the grant if no longer needed.'),
  ('entra_id', 'entra_id.appregistrations.credentials_not_expiring_soon', 'App registration secrets and certificates are rotated before expiry', 'Checks app registration credentials are not expired, not expiring within 30 days, and not issued with over 12 months'' validity.', 'medium', 'Rotate the flagged credential now and issue new credentials with a validity period of 12 months or less.'),
  ('entra_id', 'entra_id.audit.signin_and_directory_logs_available', 'Sign-in and directory audit logs are actively retained', 'Checks sign-in and directory audit logs both show entries within the last 24 hours.', 'critical', 'Investigate why no recent log entries exist — check licensing and retention configuration.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('entra_id.mfa.conditional_access_enforced', 'A.9.4.2'),
  ('entra_id.conditionalaccess.legacy_auth_blocked', 'A.9.4.2'),
  ('entra_id.authmethods.weak_methods_disabled', 'A.9.4.2'),
  ('entra_id.roles.privileged_role_assignments_limited', 'A.9.2.3'),
  ('entra_id.users.stale_guest_accounts_reviewed', 'A.9.2.6'),
  ('entra_id.enterpriseapps.high_privilege_grants_reviewed', 'A.9.4.1'),
  ('entra_id.appregistrations.credentials_not_expiring_soon', 'A.9.2.4'),
  ('entra_id.audit.signin_and_directory_logs_available', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `entra_id` — new entry in `api/src/connectors/registry.js`:
  `import * as entraId from "./entra_id/index.js";` and add `[entraId.key]: entraId` to the
  `connectors` map.
- **Files to add**:
  - `api/src/connectors/entra_id/credentials.js` — thin wrapper calling the shared
    `resolveMicrosoftGraphCredentials()` helper (see below) with `resource: "https://graph.microsoft.com"`.
  - `api/src/connectors/entra_id/index.js` — `key`, `tests`, `testConnection` (probe
    `GET /organization` — cheap, always-permitted with any Graph app permission, analogous to
    Azure's `resourceGroups.list().next()` probe), `runTests`, and a `describeGraphError()` mirroring
    `describeAzureError`/`describePurviewError`.
  - `api/src/connectors/entra_id/tests/mfaAndAccess.js`, `tests/roles.js`,
    `tests/enterpriseApps.js`, `tests/audit.js` — one file per check group, matching the
    `azure`/`purview` convention of grouping by concern, not one file per check.
- **Files to edit**: `init.sql` (append the seed blocks above), `api/src/connectors/registry.js`.
- **Shared Microsoft Graph auth helper** (new): `api/src/connectors/shared/microsoftGraphAuth.js`
  exporting `resolveMicrosoftGraphCredentials({ config, secret, resource })`, generalizing
  `purview/credentials.js`'s `fetchToken`/`createCachedTokenGetter` pattern so `entra_id`,
  `microsoft_365`, `microsoft_teams`, and `microsoft_defender` all call one implementation of the
  client-credentials POST and per-resource token cache instead of four near-identical copies.
  `resource` defaults to `https://graph.microsoft.com` for this connector; the other three
  connectors pass a different resource string for their non-Graph API surfaces (Exchange Online
  Admin API, the Teams Tenant Admin API, Defender for Endpoint) while reusing the same token-POST
  and caching logic.
- **Pagination helper**: add a small `graphPaginate(client, path)` async generator (mirrors
  `octokit.paginate()`'s role in the `github` connector) so every Graph-backed connector follows
  `@odata.nextLink` the same way instead of reimplementing the loop per check file.
