# Microsoft Azure Connector

> **This extends the existing `azure` connector** (`api/src/connectors/azure/`). It does not
> introduce a new `integrations` row, a new registry key, or a new auth model — it adds checks to
> the connector that already ships in Prism. Everything under "Proposed Checks" and "Seed SQL"
> below is additive to the 4 checks already live today.

## 1. Overview

- **Category**: `cloud` (matches the existing `integrations.category` value for `azure`).
- **Connector key**: `azure` (existing — see `api/src/connectors/registry.js`).
- **Scope today**: Activity Log diagnostic settings, Microsoft Defender for Cloud enablement,
  Storage account public blob access, and NSG open-management-port ingress rules — implemented in
  `api/src/connectors/azure/tests/logging.js` and `tests/network.js`.
- **Scope this doc adds**: Azure SQL (encryption at rest, public network access, auditing),
  Key Vault (purge protection, RBAC-vs-access-policy authorization model), Azure Monitor
  (diagnostic settings coverage beyond the existing Activity Log check), and Azure Policy
  (compliance state of assigned policies).
- **Explicitly out of scope for this doc** (owned by a different connector in the Microsoft
  group, not re-proposed here): Microsoft Entra ID checks (identity, MFA, Conditional Access,
  app registrations — see the proposed `entra_id` connector) and Microsoft Purview checks (Data
  Map, classification, unified audit log — see the existing `purview` connector). This connector
  stays scoped to **Azure Resource Manager (ARM)-managed infrastructure** only.

Target coverage sheet vs. status:

| Area | Status |
|---|---|
| Subscriptions | Implicit (every check is scoped to `config.subscriptionId`) |
| VMs | Not covered (no VM-specific check exists or is proposed here — flagged as a gap, not silently dropped) |
| NSGs | Done |
| Storage | Done |
| SQL | Proposed here (encryption, public access, auditing) |
| Key Vault | Partial (Defender for Cloud coverage exists; vault-specific config proposed here) |
| Monitor | Partial (Activity Log diagnostics done; broader diagnostic-settings coverage proposed here) |
| Policy | Proposed here (compliance state) |
| Purview | Out of scope — separate `purview` connector |
| Entra ID | Out of scope — separate proposed `entra_id` connector |

## 2. Authentication

`auth_type`: `oauth2` (existing value — client-credentials flow via `ClientSecretCredential` from
`@azure/identity`, unchanged by this doc).

Unlike the other four connectors in this Microsoft group, **this connector does not call
Microsoft Graph at all** — it authenticates against Azure Resource Manager (`management.azure.com`)
using Azure RBAC, a structurally separate authorization model from Entra ID directory roles or
Graph API permissions. No new Graph scopes are needed for anything proposed here.

### Extending the existing Service Principal's role assignment

The new checks read additional ARM resource types the existing Service Principal may already have
access to (if it holds subscription-level `Reader`), but confirm the following before implementing:

1. In the Azure portal, go to the target **Subscription > Access control (IAM)**.
2. Confirm the existing Service Principal (used for the 4 live checks) holds the **Reader** role
   at the subscription scope — this alone is sufficient for every new check proposed here (SQL,
   Key Vault, Monitor, and Policy compliance data are all read-only ARM operations covered by the
   built-in `Reader` role). No custom role, no new role assignment, no new consent step.
3. If the Service Principal was scoped to a narrower resource group instead of the subscription,
   either broaden its scope or accept that SQL/Key Vault/Monitor/Policy checks will only cover
   resources inside that resource group — same limitation the existing 4 checks already have.

### `config` / `secret` shapes (unchanged)

```json
// integration_connections.config
{
  "tenantId": "11111111-1111-1111-1111-111111111111",
  "subscriptionId": "22222222-2222-2222-2222-222222222222"
}
```

```json
// integration_credentials (decrypted secret shape)
{
  "clientId": "33333333-3333-3333-3333-333333333333",
  "clientSecret": "<client secret value>"
}
```

## 3. API Reference

- **Base URL**: `https://management.azure.com` (ARM — unchanged; the connector uses the
  `@azure/arm-*` SDK families rather than raw `fetch`, unlike the Graph-based connectors in this
  group).
- **API versions**: each new check needs its own SDK package pinned to a recent stable API
  version — `@azure/arm-sql` (SQL server/database resources), `@azure/arm-keyvault` (vault
  properties), `@azure/arm-monitor` (already a dependency, used for `diagnosticSettings` beyond
  the existing Activity Log check), `@azure/arm-policyinsights` (policy compliance state).
- **Pagination**: ARM SDKs return async iterables (`.list()` returns a `PagedAsyncIterableIterator`)
  exactly like the existing `StorageManagementClient`/`NetworkManagementClient` usage — no new
  pagination pattern needed, just `for await (const item of client.x.list())`.
- **Rate limiting / errors**: reuse the existing `describeAzureError()` in `index.js` unchanged —
  it already generically unwraps ARM's `RestError` shape regardless of which `@azure/arm-*`
  package threw it.

## 4. Proposed Checks (new — 7)

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `azure.sql.transparent_data_encryption_enabled` | SQL databases have transparent data encryption enabled | critical | A.8.2.3 | Checks every Azure SQL database (`@azure/arm-sql`'s `transparentDataEncryptions.get`) has TDE state `Enabled`. | Enable Transparent Data Encryption under the database's Transparent data encryption settings blade (enabled by default for new databases since 2017 — this flags legacy databases). |
| `azure.sql.public_network_access_disabled` | SQL servers do not allow public network access | critical | A.13.1.1 | Checks every Azure SQL logical server (`@azure/arm-sql`'s `servers.get`) has `publicNetworkAccess: "Disabled"`, or if enabled, has no firewall rule spanning `0.0.0.0`-`255.255.255.255`. | Disable public network access under the server's Networking blade, and connect via a private endpoint or VNet service endpoint instead. |
| `azure.sql.auditing_enabled` | SQL server auditing is enabled | high | A.12.4.1 | Checks every SQL server's auditing policy (`@azure/arm-sql`'s `serverBlobAuditingPolicies.get`) has `state: "Enabled"` with a configured retention. | Enable auditing under the server's Auditing blade and set a retention period meeting the organization's log retention policy. |
| `azure.keyvault.purge_protection_enabled` | Key Vaults have purge protection enabled | high | A.8.2.3 | Checks every Key Vault (`@azure/arm-keyvault`'s `vaults.get`) has `properties.enablePurgeProtection: true`, preventing permanent deletion of keys/secrets during the soft-delete retention window. | Enable purge protection under the vault's Properties blade (irreversible once enabled — by design). |
| `azure.keyvault.rbac_authorization_enabled` | Key Vaults use Azure RBAC instead of legacy access policies | medium | A.9.1.2 | Checks every Key Vault has `properties.enableRbacAuthorization: true`, so access is governed by auditable Azure role assignments rather than vault-local access policies that don't integrate with Conditional Access or PIM. | Migrate the vault's permission model to Azure RBAC under the vault's Access configuration blade, then recreate equivalent access via role assignments. |
| `azure.monitor.diagnostic_settings_cover_key_resources` | Diagnostic settings are configured for key resource types | medium | A.12.4.1 | Checks SQL servers, Key Vaults, and NSGs each have at least one diagnostic setting (`@azure/arm-monitor`'s `diagnosticSettings.list` scoped to the resource ID) forwarding logs to a Log Analytics workspace, Storage account, or Event Hub — extending the existing Activity Log-only diagnostics check to resource-level logs. | Add a diagnostic setting on the flagged resource forwarding relevant log categories to a Log Analytics workspace. |
| `azure.policy.assignments_compliant` | Assigned Azure Policy definitions report a compliant state | medium | A.18.2.2 | Checks policy compliance summaries (`@azure/arm-policyinsights`'s `policyStates.summarizeForSubscription`) report no policy assignment with a non-compliant resource count above a defined threshold (default: 0 non-compliant resources for assignments tagged as compliance-critical). | Review non-compliant resources listed under Azure Policy > Compliance and remediate them, or use a policy remediation task where supported. |

## 5. Seed SQL

The `integrations` row for `azure` already exists — no new insert needed. Append to the existing
`automated_tests` / `test_control_mappings` blocks in `init.sql` (same statement style,
`ON CONFLICT ... DO NOTHING` so this is safe to run against an already-seeded database):

```sql
INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('azure', 'azure.sql.transparent_data_encryption_enabled', 'SQL databases have transparent data encryption enabled', 'Checks every Azure SQL database has transparent data encryption enabled.', 'critical', 'Enable Transparent Data Encryption under the database''s Transparent data encryption settings blade.'),
  ('azure', 'azure.sql.public_network_access_disabled', 'SQL servers do not allow public network access', 'Checks every Azure SQL logical server disables public network access or has no fully-open firewall rule.', 'critical', 'Disable public network access under the server''s Networking blade and use a private endpoint or VNet service endpoint.'),
  ('azure', 'azure.sql.auditing_enabled', 'SQL server auditing is enabled', 'Checks every SQL server has an enabled auditing policy with a configured retention.', 'high', 'Enable auditing under the server''s Auditing blade and set a retention period.'),
  ('azure', 'azure.keyvault.purge_protection_enabled', 'Key Vaults have purge protection enabled', 'Checks every Key Vault has purge protection enabled.', 'high', 'Enable purge protection under the vault''s Properties blade.'),
  ('azure', 'azure.keyvault.rbac_authorization_enabled', 'Key Vaults use Azure RBAC instead of legacy access policies', 'Checks every Key Vault uses Azure RBAC for authorization instead of vault-local access policies.', 'medium', 'Migrate the vault''s permission model to Azure RBAC under Access configuration.'),
  ('azure', 'azure.monitor.diagnostic_settings_cover_key_resources', 'Diagnostic settings are configured for key resource types', 'Checks SQL servers, Key Vaults, and NSGs each have at least one diagnostic setting forwarding logs.', 'medium', 'Add a diagnostic setting on the flagged resource forwarding logs to a Log Analytics workspace.'),
  ('azure', 'azure.policy.assignments_compliant', 'Assigned Azure Policy definitions report a compliant state', 'Checks policy compliance summaries report no non-compliant resources above a defined threshold.', 'medium', 'Review non-compliant resources under Azure Policy > Compliance and remediate them.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('azure.sql.transparent_data_encryption_enabled', 'A.8.2.3'),
  ('azure.sql.public_network_access_disabled', 'A.13.1.1'),
  ('azure.sql.auditing_enabled', 'A.12.4.1'),
  ('azure.keyvault.purge_protection_enabled', 'A.8.2.3'),
  ('azure.keyvault.rbac_authorization_enabled', 'A.9.1.2'),
  ('azure.monitor.diagnostic_settings_cover_key_resources', 'A.12.4.1'),
  ('azure.policy.assignments_compliant', 'A.18.2.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `azure` (existing, no `registry.js` change needed).
- **New dependencies**: `@azure/arm-sql`, `@azure/arm-keyvault`, `@azure/arm-policyinsights`
  (`@azure/arm-monitor` is already a dependency, used by the existing Activity Log check).
- **Files to add**:
  - `api/src/connectors/azure/tests/sql.js` — exports `sqlTests` with
    `checkTransparentDataEncryptionEnabled`, `checkPublicNetworkAccessDisabled`,
    `checkAuditingEnabled`.
  - `api/src/connectors/azure/tests/keyVault.js` — exports `keyVaultTests` with
    `checkPurgeProtectionEnabled`, `checkRbacAuthorizationEnabled`.
  - `api/src/connectors/azure/tests/monitor.js` — exports `monitorTests` with
    `checkDiagnosticSettingsCoverKeyResources` (distinct from the existing `logging.js`, which
    stays scoped to the Activity Log-specific check to avoid one file growing unboundedly).
  - `api/src/connectors/azure/tests/policy.js` — exports `policyTests` with
    `checkAssignmentsCompliant`.
- **Files to edit**:
  - `api/src/connectors/azure/index.js` — add `sql: new SqlManagementClient(credential, subscriptionId)`,
    `keyVault: new KeyVaultManagementClient(credential, subscriptionId)`,
    `policyInsights: new PolicyInsightsClient(credential, subscriptionId)` to `buildClients()`,
    and import + spread the four new test arrays into `tests` alongside `loggingTests`/`networkTests`.
  - `init.sql` — append the SQL blocks above directly after the existing `azure` seed blocks
    (lines ~657–673).
- **VM checks remain a gap**: the user's prioritization sheet lists VMs as in-scope for Azure, but
  no VM-specific check is proposed in this pass (disk encryption, NSG association, and endpoint
  protection are the obvious candidates) — call this out explicitly rather than letting it look
  like an oversight; it's deferred to a follow-up doc/PR to keep this one focused on SQL/Key
  Vault/Monitor/Policy as scoped by the prioritization sheet's "not yet covered" list.
- **No new auth work**: unlike `entra_id`/`microsoft_365`/`microsoft_teams`/`microsoft_defender`,
  this connector needs no shared Graph-auth helper and no new Azure AD app permissions — it's a
  pure Azure RBAC extension of the existing Service Principal's `Reader` role.
