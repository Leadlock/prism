# Microsoft Azure Connector

> **This extends the existing `azure` connector** (`api/src/connectors/azure/`). It does not
> introduce a new `integrations` row, a new registry key, or a new auth model — it adds checks to
> the connector that already ships in Prism.

## 1. Overview

- **Category**: `cloud` (matches the existing `integrations.category` value for `azure`).
- **Connector key**: `azure` (existing — see `api/src/connectors/registry.js`).
- **Scope today (implemented, 15 checks)**: Activity Log diagnostic settings, Microsoft Defender
  for Cloud enablement, Storage account public blob access, NSG open-management-port ingress
  rules (`tests/logging.js`, `tests/network.js`); Azure SQL encryption/public access/auditing
  (`tests/sql.js`); Key Vault purge protection and RBAC authorization (`tests/keyVault.js`);
  diagnostic-settings coverage across SQL/Key Vault/NSGs (`tests/monitor.js`); Azure Policy
  compliance state (`tests/policy.js`); VM encryption-at-host and public-IP exposure
  (`tests/compute.js`); subscription-level classic administrators and Owner-role sprawl
  (`tests/subscription.js`).
- **Explicitly out of scope for this doc** (owned by a different connector in the Microsoft
  group, not re-proposed here): Microsoft Entra ID checks (identity, MFA, Conditional Access,
  app registrations — see the `entra_id` connector) and Microsoft Purview checks (Data
  Map, classification, unified audit log — see the existing `purview` connector). This connector
  stays scoped to **Azure Resource Manager (ARM)-managed infrastructure** only.

Target coverage sheet vs. status:

| Area | Status |
|---|---|
| Subscriptions | Done (classic administrators, Owner-role assignment count) |
| VMs | Done (encryption at host, public IP exposure) |
| NSGs | Done |
| Storage | Done |
| SQL | Done (TDE, public network access, auditing) |
| Key Vault | Done (purge protection, RBAC authorization) |
| Monitor | Done (Activity Log diagnostics, plus diagnostic-settings coverage for SQL/Key Vault/NSGs) |
| Policy | Done (compliance state) |
| Purview | Out of scope — separate `purview` connector |
| Entra ID | Out of scope — separate `entra_id` connector |

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
- **API versions**: each new check has its own SDK package — `@azure/arm-sql` (SQL server/database
  resources), `@azure/arm-keyvault` (vault properties), `@azure/arm-monitor` (already a dependency,
  used for `diagnosticSettings` beyond the existing Activity Log check), `@azure/arm-policyinsights`
  (policy compliance state), `@azure/arm-compute` (VM properties), `@azure/arm-authorization`
  (classic administrators, role assignments).
- **Pagination**: verified against the installed SDK versions (not assumed) — `.list()`/`.listAll()`/
  `.listByServer()`/`.listByDatabase()`/`.listForScope()` all return a `PagedAsyncIterableIterator`,
  while `.get()` and `policyStates.summarizeForSubscription()` return a plain `Promise`. Both shapes
  are pinned by regression tests in `connectorsAzureSdkShapes.test.js` — this connector already had
  one SDK version drift bug of exactly this kind, so every new list/get call got the same guard
  before being trusted in the check implementations.
- **Rate limiting / errors**: reuse the existing `describeAzureError()` in `index.js` unchanged —
  it already generically unwraps ARM's `RestError` shape regardless of which `@azure/arm-*`
  package threw it.

## 4. Implemented Checks (new — 11)

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `azure.sql.transparent_data_encryption_enabled` | SQL databases have transparent data encryption enabled | critical | A.8.2.3 | Checks every Azure SQL database (`@azure/arm-sql`'s `transparentDataEncryptions.listByDatabase`) has TDE state `Enabled`. The system `master` database is skipped — its TDE state isn't independently configurable. | Enable Transparent Data Encryption under the database's Transparent data encryption settings blade (enabled by default for new databases since 2017 — this flags legacy databases). |
| `azure.sql.public_network_access_disabled` | SQL servers do not allow public network access | critical | A.13.1.1 | Checks every Azure SQL logical server has `publicNetworkAccess: "Disabled"`, or if enabled, has no firewall rule spanning `0.0.0.0`-`255.255.255.255`. | Disable public network access under the server's Networking blade, and connect via a private endpoint or VNet service endpoint instead. |
| `azure.sql.auditing_enabled` | SQL server auditing is enabled | high | A.12.4.1 | Checks every SQL server's auditing policy (`@azure/arm-sql`'s `serverBlobAuditingPolicies.get`) has `state: "Enabled"`. | Enable auditing under the server's Auditing blade and set a retention period meeting the organization's log retention policy. |
| `azure.keyvault.purge_protection_enabled` | Key Vaults have purge protection enabled | high | A.8.2.3 | Checks every Key Vault (`@azure/arm-keyvault`'s `vaults.get`) has `properties.enablePurgeProtection: true`, preventing permanent deletion of keys/secrets during the soft-delete retention window. | Enable purge protection under the vault's Properties blade (irreversible once enabled — by design). |
| `azure.keyvault.rbac_authorization_enabled` | Key Vaults use Azure RBAC instead of legacy access policies | medium | A.9.1.2 | Checks every Key Vault has `properties.enableRbacAuthorization: true`, so access is governed by auditable Azure role assignments rather than vault-local access policies. | Migrate the vault's permission model to Azure RBAC under the vault's Access configuration blade, then recreate equivalent access via role assignments. |
| `azure.monitor.diagnostic_settings_cover_key_resources` | Diagnostic settings are configured for key resource types | medium | A.12.4.1 | Checks SQL servers, Key Vaults, and NSGs each have at least one diagnostic setting (`@azure/arm-monitor`'s `diagnosticSettings.list` scoped to the resource ID) forwarding logs — extending the existing Activity Log-only diagnostics check to resource-level logs. | Add a diagnostic setting on the flagged resource forwarding relevant log categories to a Log Analytics workspace. |
| `azure.policy.assignments_compliant` | Assigned Azure Policy definitions report a compliant state | medium | A.18.2.2 | Checks the subscription's policy compliance summary (`@azure/arm-policyinsights`'s `policyStates.summarizeForSubscription`) reports zero non-compliant resources. | Review non-compliant resources listed under Azure Policy > Compliance and remediate them, or use a policy remediation task where supported. |
| `azure.compute.disk_encryption_enabled` | Virtual machines have encryption at host enabled | high | A.8.2.3 | Checks every VM (`@azure/arm-compute`'s `virtualMachines.listAll`) has `securityProfile.encryptionAtHost: true`, so both OS and data disk caches are encrypted. | Enable encryption at host under the VM's Disks blade (Additional settings) — requires the `EncryptionAtHost` subscription feature to be registered first. |
| `azure.compute.no_public_ip_association` | Virtual machines are not directly exposed via a public IP address | critical | A.13.1.1 | For each VM's network interfaces (resolved via `@azure/arm-network`'s `networkInterfaces.get`), checks no `ipConfigurations[].publicIPAddress` is set. | Remove the public IP association from the network interface under Networking, and use a load balancer, Bastion, or VPN for access instead. |
| `azure.subscription.no_classic_administrators` | Subscription has no classic (co-)administrators | high | A.9.2.3 | Checks `@azure/arm-authorization`'s `classicAdministrators.list()` returns no entries — the legacy Service Administrator/Co-Administrator model predates Azure RBAC and doesn't show up in role-assignment reviews. | Remove classic administrators under Subscription > Access control (IAM) > Classic administrators, and grant equivalent access via Azure RBAC instead. |
| `azure.subscription.limited_owner_assignments` | Subscription-scope Owner role assignments are limited | medium | A.9.1.2 | Checks the count of distinct principals holding the built-in Owner role (`roleAssignments.listForScope` matched against Owner's well-known role-definition GUID) at subscription scope doesn't exceed 2. | Review Owner role assignments under Subscription > Access control (IAM), and replace unnecessary Owner grants with least-privilege roles. |

## 5. Seed SQL

The `integrations` row for `azure` already exists — no new insert needed. The
`automated_tests` / `test_control_mappings` inserts for all 11 new checks live in `init.sql`
directly after the existing `azure` seed blocks, using the same `ON CONFLICT ... DO NOTHING`
statement style so it's safe to run against an already-seeded database.

## 6. Implementation Notes

- **Connector key**: `azure` (existing, no `registry.js` change needed).
- **New dependencies** (added to `api/package.json`): `@azure/arm-sql`, `@azure/arm-keyvault`,
  `@azure/arm-policyinsights`, `@azure/arm-compute`, `@azure/arm-authorization`
  (`@azure/arm-monitor` and `@azure/arm-network` were already dependencies).
- **Files added**:
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
  - `api/src/connectors/azure/tests/compute.js` — exports `computeTests` with
    `checkDiskEncryptionEnabled`, `checkNoPublicIpAssociation`.
  - `api/src/connectors/azure/tests/subscription.js` — exports `subscriptionTests` with
    `checkNoClassicAdministrators`, `checkLimitedOwnerAssignments`.
  - Matching unit tests under `api/src/__tests__/connectorsAzure{Sql,KeyVault,Monitor,Policy,
    Compute,Subscription}.test.js`, plus new shape-guard cases in
    `connectorsAzureSdkShapes.test.js` for every new SDK's `list`/`get` call.
- **Files edited**:
  - `api/src/connectors/azure/index.js` — added `sql`, `keyVault`, `policyInsights`, `compute`,
    `authorization` clients to `buildClients()`, and imported + spread all six new test arrays
    into `tests`.
  - `api/src/connectors/azure/connector.json` — added the 11 new `tests[]` manifest entries
    (kept in sync with the JS `tests` array per `registry.js`'s drift check).
  - `init.sql` — appended seed rows for the 11 new tests.
  - `api/src/__tests__/connectorsAzureIndex.test.js` — added mocks for the 5 new SDK packages,
    bumped the expected result count from 4 to 15.
  - `api/src/__tests__/connectorsRegistry.test.js` — updated the azure exact-key-list assertion
    from the 4 Phase-1 keys to all 15.
- **No new auth work**: unlike `entra_id`/`microsoft_365`/`microsoft_teams`/`microsoft_defender`,
  this connector needs no shared Graph-auth helper and no new Azure AD app permissions — it's a
  pure Azure RBAC extension of the existing Service Principal's `Reader` role.
