# Microsoft 365 Connector (proposed)

Status: design spec, not yet implemented. Follows the existing connector pattern (see
`api/src/connectors/purview/` for the plain-`fetch` + multi-resource-token shape this connector
should copy — it already demonstrates calling two different Microsoft API audiences from one
Azure AD app registration, which this connector extends to three).

## 1. Overview

- **Connector key**: `microsoft_365`
- **Category**: `collaboration` (free-text, no DB constraint).
- **Audit scope**: Exchange Online mail-flow/mailbox-auditing configuration, SharePoint Online
  and OneDrive tenant-level external sharing settings, Intune device compliance policy coverage,
  and Defender for Office 365 (email/collaboration) protection policies.
- **Boundary vs. the other 4 Microsoft connectors in this group** (important — this is the
  broadest-scoped app in the set and it's easy to duplicate another connector's checks):
  - **Teams**: this connector does not check Teams-specific settings (guest/external access,
    meeting/messaging policies) — that's entirely `microsoft_teams`'s job, even though "Teams" is
    nominally part of the Microsoft 365 suite.
  - **Defender for Endpoint** (devices, vulnerabilities, endpoint alerts): that's
    `microsoft_defender`'s job. This connector only covers **Defender for Office 365** (email
    protection: Safe Links, Safe Attachments) because that configuration surface is
    Exchange/mail-flow-adjacent and uses the same Exchange Online / Security & Compliance
    authentication path as the rest of this connector's checks — it would be artificial to split
    mail-security config into a third connector.
  - **Purview** (`purview`, existing connector): unified audit log subscriptions, Data Map scans,
    classification, and sensitivity labeling are entirely out of scope here. This connector's
    "audit" surface area is limited to Exchange mailbox audit logging (a per-mailbox Exchange
    setting, distinct from Purview's tenant-wide unified audit log), so there is no overlap in
    `test_key` namespaces.
  - **Entra ID** (`entra_id`, proposed separately): user/group/role/MFA/Conditional Access checks
    are entirely out of scope here, even though Entra ID underlies every M365 workload's identity.

## 2. Authentication

- **`auth_type`**: `oauth2` — the same Azure AD app registration and client-credentials flow as
  `entra_id`/`microsoft_teams`/`microsoft_defender` (see "Shared app registration" in
  `docs/connectors/entra_id.md`), extended with **Exchange-specific application permissions and
  an Entra role assignment on top of Graph admin consent** — this connector is the one place in
  the group where Graph consent alone is not sufficient.

### Setup steps

1. Reuse the shared app registration (or create one — see `entra_id.md` step 2) in
   **Microsoft Entra ID > App registrations**.
2. **API permissions > Add a permission > Microsoft Graph > Application permissions**, add:
   - `SharePointTenantSettings.Read.All` — tenant-level SharePoint/OneDrive sharing settings
     (`GET /admin/sharepoint/settings`).
   - `DeviceManagementManagedDevices.Read.All` — Intune managed device compliance state.
   - `DeviceManagementConfiguration.Read.All` — Intune device compliance policies and their
     assignments.
3. **API permissions > Add a permission > APIs my organization uses**, search for and select
   **Office 365 Exchange Online**, then **Application permissions > `Exchange.ManageAsApp`**
   (or `Exchange.ManageAsAppV2` if the tenant has the newer Exchange Online Admin API enrolled —
   functionally equivalent for read-only calls; see API Reference). This resource does not appear
   in the default API list — start typing its name for it to appear.
4. Select **Grant admin consent for `<tenant>`** for all permissions added in steps 2–3.
5. **Assign an Entra role to the app's service principal** — this is the part that's easy to
   miss and unique to Exchange among this group's APIs: holding `Exchange.ManageAsApp` alone is
   not sufficient, Exchange Online's own RBAC also gates what the resulting token can read.
   In **Entra ID > Roles and administrators**, select **Global Reader** (least-privileged built-in
   role that covers every read-only check this connector needs) and add the app's service
   principal under **Add assignments**.
6. In Prism, create the `microsoft_365` integration connection and enter the `config`/`secret`
   below (same triple as the other Microsoft connectors if the app registration is shared).

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

This connector is unusual among Prism's Microsoft connectors in calling **two** distinct API
surfaces from the same app registration (a third, if Defender for Office 365 policy reads need
the Security & Compliance PowerShell-backed cmdlets — see the caveat below):

| Surface | Base URL | Token resource/scope | Used for |
|---|---|---|---|
| Microsoft Graph | `https://graph.microsoft.com/v1.0` | `https://graph.microsoft.com/.default` | SharePoint/OneDrive tenant settings, Intune compliance policies and devices |
| Exchange Online Admin API (preview) | `https://outlook.office365.com/adminapi/v2.0/{tenantId}` | `https://outlook.office365.com/.default` | Mailbox audit logging config, transport/remote-domain rules |

- **Exchange Online Admin API request shape**: every call is a `POST` to
  `{baseUrl}/{EndpointName}` with a `CmdletInput` envelope naming the PowerShell cmdlet and its
  parameters, e.g.:
  ```json
  POST https://outlook.office365.com/adminapi/v2.0/{tenantId}/OrganizationConfig
  { "CmdletInput": { "CmdletName": "Get-OrganizationConfig" } }
  ```
  This replaces legacy EWS/PowerShell-only access with a proper HTTPS+JSON call, which fits
  Prism's existing plain-`fetch` connector shape (no PowerShell process, no WinRM) — this is the
  reason to prefer it over `Connect-ExchangeOnline`.
- **Pagination**: Graph calls follow the standard `@odata.nextLink` cursor (reuse the
  `entra_id` connector's shared pagination helper). The Exchange Admin API cmdlet-proxy responses
  are not paginated the same way; large result sets use the cmdlet's own paging parameters
  (`ResultSize`) instead.
- **Caveat — Defender for Office 365 (Safe Links/Safe Attachments) policy reads**: these are
  Security & Compliance Center cmdlets (`Get-SafeLinksPolicy`, `Get-SafeAttachmentPolicy`). As of
  this writing, the Exchange Online Admin API's documented endpoint set does not yet enumerate
  every Security & Compliance cmdlet — **verify `Get-SafeLinksPolicy`/`Get-SafeAttachmentPolicy`
  appear in the current "Exchange Online Admin API endpoints reference" before implementing these
  two checks**. If they aren't yet exposed via the REST admin API, the fallback is invoking the
  `ExchangeOnlineManagement` PowerShell module's `Connect-IPPSSession` with app-only certificate
  auth from a Node child process — a real deviation from this connector's otherwise-plain-`fetch`
  shape, and worth flagging to whoever picks up implementation rather than silently assuming REST
  parity with the Exchange Online Admin API for the OrganizationConfig/TransportRule cmdlets.
- **Rate limits**: Graph's standard per-app throttling (respect `Retry-After`); the Exchange
  Online Admin API documents its own per-tenant throttling separately — treat both the same way
  the AWS connector treats API rate limits, with a bounded retry rather than an unbounded loop.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `microsoft_365.exchange.mailbox_audit_logging_enabled` | Mailbox audit logging is enabled | critical | A.12.4.1 | Checks the organization config (`Get-OrganizationConfig` via the Exchange Online Admin API) does not have mailbox audit logging disabled tenant-wide (`AuditDisabled: false`). | Run `Set-OrganizationConfig -AuditDisabled $false`, or clear the equivalent setting under the Microsoft Purview compliance portal's audit configuration. |
| `microsoft_365.exchange.no_external_auto_forwarding` | Automatic forwarding to external domains is blocked | high | A.13.2.1 | Checks the remote domain default configuration (`Get-RemoteDomain` via the Exchange Online Admin API) has `AutoForwardEnabled: false` for the default remote domain, preventing silent mailbox exfiltration via forwarding rules. | Run `Set-RemoteDomain -Identity Default -AutoForwardEnabled $false`, and review/remove any existing user-created external forwarding rules. |
| `microsoft_365.sharepoint.external_sharing_restricted` | SharePoint and OneDrive external sharing is restricted | critical | A.13.2.1 | Checks tenant SharePoint/OneDrive settings (`GET /admin/sharepoint/settings`) report `sharingCapability` is not `ExternalUserAndGuestSharing` (fully open), i.e. sharing is limited to existing guests or disabled. | Set the external sharing level to "Existing guests" or more restrictive under the SharePoint admin center > Policies > Sharing. |
| `microsoft_365.sharepoint.default_sharing_link_not_anonymous` | Default sharing link is not anonymous "Anyone" | critical | A.9.4.1 | Checks tenant SharePoint/OneDrive settings report the default sharing link type/permission is not an anonymous "Anyone" edit link. | Change the default link type to "Specific people" or "Only people in your organization" under the SharePoint admin center > Policies > Sharing. |
| `microsoft_365.intune.compliance_policy_assigned_all_platforms` | Device compliance policies are assigned for every managed platform | high | A.6.2.1 | Checks `GET /deviceManagement/deviceCompliancePolicies` includes at least one assigned policy covering each device platform present in `GET /deviceManagement/managedDevices` (Windows, iOS, Android, macOS). | Create and assign a device compliance policy for any platform found without one, under Intune admin center > Devices > Compliance policies. |
| `microsoft_365.intune.noncompliant_devices_remediated` | Managed devices are compliant or being remediated | medium | A.6.2.1 | Checks the proportion of managed devices (`GET /deviceManagement/managedDevices`) with `complianceState: "noncompliant"` does not exceed a defined threshold (default 10%). | Investigate noncompliant devices in the Intune admin center and either remediate the underlying setting or confirm a remediation/grace-period action is in flight. |
| `microsoft_365.defenderoffice.safe_links_enabled` | Safe Links protection is enabled for email and Office apps | high | A.12.2.1 | Checks at least one enabled Safe Links policy (`Get-SafeLinksPolicy`) applies time-of-click URL rewriting to email and Office documents tenant-wide. | Enable and assign a Safe Links policy covering email, Teams, and Office apps under the Microsoft Defender portal > Email & collaboration > Policies > Safe Links. |
| `microsoft_365.defenderoffice.safe_attachments_enabled` | Safe Attachments protection is enabled | high | A.12.2.1 | Checks at least one enabled Safe Attachments policy (`Get-SafeAttachmentPolicy`) applies dynamic delivery/detonation scanning to inbound mail. | Enable and assign a Safe Attachments policy under the Microsoft Defender portal > Email & collaboration > Policies > Safe Attachments. |

## 5. Seed SQL

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('microsoft_365', 'Microsoft 365', 'collaboration', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('microsoft_365', 'microsoft_365.exchange.mailbox_audit_logging_enabled', 'Mailbox audit logging is enabled', 'Checks the organization config does not have mailbox audit logging disabled tenant-wide.', 'critical', 'Clear the AuditDisabled organization setting via Set-OrganizationConfig or the Purview compliance portal.'),
  ('microsoft_365', 'microsoft_365.exchange.no_external_auto_forwarding', 'Automatic forwarding to external domains is blocked', 'Checks the default remote domain configuration has automatic forwarding to external domains disabled.', 'high', 'Set the default remote domain AutoForwardEnabled to false and review existing forwarding rules.'),
  ('microsoft_365', 'microsoft_365.sharepoint.external_sharing_restricted', 'SharePoint and OneDrive external sharing is restricted', 'Checks tenant SharePoint/OneDrive sharing settings are not fully open to any external user.', 'critical', 'Set the external sharing level to Existing guests or more restrictive under the SharePoint admin center.'),
  ('microsoft_365', 'microsoft_365.sharepoint.default_sharing_link_not_anonymous', 'Default sharing link is not anonymous "Anyone"', 'Checks the default sharing link type is not an anonymous Anyone edit link.', 'critical', 'Change the default link type to Specific people or organization-only under the SharePoint admin center.'),
  ('microsoft_365', 'microsoft_365.intune.compliance_policy_assigned_all_platforms', 'Device compliance policies are assigned for every managed platform', 'Checks every device platform present in the tenant has at least one assigned compliance policy.', 'high', 'Create and assign a compliance policy for any platform found without one.'),
  ('microsoft_365', 'microsoft_365.intune.noncompliant_devices_remediated', 'Managed devices are compliant or being remediated', 'Checks the proportion of noncompliant managed devices does not exceed a defined threshold.', 'medium', 'Investigate noncompliant devices and remediate the underlying setting or confirm a grace-period action is in flight.'),
  ('microsoft_365', 'microsoft_365.defenderoffice.safe_links_enabled', 'Safe Links protection is enabled for email and Office apps', 'Checks at least one enabled Safe Links policy applies time-of-click URL rewriting tenant-wide.', 'high', 'Enable and assign a Safe Links policy covering email, Teams, and Office apps.'),
  ('microsoft_365', 'microsoft_365.defenderoffice.safe_attachments_enabled', 'Safe Attachments protection is enabled', 'Checks at least one enabled Safe Attachments policy applies detonation scanning to inbound mail.', 'high', 'Enable and assign a Safe Attachments policy under the Defender portal.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('microsoft_365.exchange.mailbox_audit_logging_enabled', 'A.12.4.1'),
  ('microsoft_365.exchange.no_external_auto_forwarding', 'A.13.2.1'),
  ('microsoft_365.sharepoint.external_sharing_restricted', 'A.13.2.1'),
  ('microsoft_365.sharepoint.default_sharing_link_not_anonymous', 'A.9.4.1'),
  ('microsoft_365.intune.compliance_policy_assigned_all_platforms', 'A.6.2.1'),
  ('microsoft_365.intune.noncompliant_devices_remediated', 'A.6.2.1'),
  ('microsoft_365.defenderoffice.safe_links_enabled', 'A.12.2.1'),
  ('microsoft_365.defenderoffice.safe_attachments_enabled', 'A.12.2.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `microsoft_365` — add to `api/src/connectors/registry.js` alongside the
  other four.
- **Files to add**:
  - `api/src/connectors/microsoft_365/credentials.js` — calls the shared
    `resolveMicrosoftGraphCredentials()` helper (see `entra_id.md`) **twice**: once with
    `resource: "https://graph.microsoft.com"` for the Graph-backed checks, once with
    `resource: "https://outlook.office365.com"` for the Exchange Online Admin API checks —
    mirroring `purview/credentials.js`'s `getDataMapToken`/`getAuditToken` dual-resource pattern
    exactly.
  - `api/src/connectors/microsoft_365/index.js` — `key`, `tests`, `testConnection` (probe both
    resources with `Promise.allSettled`, matching Purview's `testConnection` shape so a
    misconfigured Exchange RBAC role assignment doesn't block SharePoint/Intune checks from
    still running, and vice versa), `runTests`, `describeM365Error()`.
  - `api/src/connectors/microsoft_365/tests/exchange.js`, `tests/sharepoint.js`,
    `tests/intune.js`, `tests/defenderOffice.js`.
- **Files to edit**: `init.sql`, `api/src/connectors/registry.js`.
- **Reuses** the shared `resolveMicrosoftGraphCredentials()` helper proposed in `entra_id.md` —
  do not add a second, parallel token-caching implementation here.
- **Verify before implementing** the two Defender for Office 365 checks: confirm
  `Get-SafeLinksPolicy`/`Get-SafeAttachmentPolicy` are present in the current Exchange Online
  Admin API endpoint reference; if not, implementation needs to fall back to the
  `ExchangeOnlineManagement` PowerShell module with app-only certificate auth, which is a
  meaningfully different implementation shape (spawns a PowerShell process) than every other
  check in this connector group and should be called out in code review rather than discovered
  during implementation.
