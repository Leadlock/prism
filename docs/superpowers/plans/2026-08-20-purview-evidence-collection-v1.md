# Microsoft Purview Connector for Prism

## Context

Prism already collects automated compliance evidence from AWS, Azure, and GitHub through a generic "integration connector" framework: a Postgres catalog of connectors and their Tier-1 checks, a shared credential vault, a shared evidence-collection runner, and a shared set of API routes/UI screens that each connector plugs into with only a handful of connector-specific files. The user wants to extend this to Microsoft Purview so that Purview data becomes another automated evidence source for ISO 27001 questions.

Research (via context7 + Microsoft Learn docs) found that "Microsoft Purview" is really three different capabilities with very different API stories:
- **Data Map / Unified Catalog** — a real, documented REST API (Atlas 2.2-based), authenticated via an Azure AD app registration with a **Purview-account-level RBAC role** (not an Entra permission). Good fit for automated checks on data classification and asset-inventory controls.
- **Purview Audit (Unified Audit Log)** — a real, documented REST API (Office 365 Management Activity API), authenticated via a *different* grant type: Entra "Office 365 Management APIs" **application permissions**, admin-consented, against a different token audience (`https://manage.office.com`). Good fit for logging/monitoring/DLP controls. Its interaction shape (subscribe to a content type, then poll for content blobs) is fundamentally different from Data Map's request/response REST calls.
- **Compliance Manager** (assessment scores/controls) — confirmed to have **no public REST API**. It's portal-driven only; Microsoft Graph's Purview-adjacent compliance APIs cover eDiscovery, subject rights requests, and records management, but not Compliance Manager assessments. The user chose to list this as a `coming_soon` catalog entry with no backend work, rather than build a fake/manual evidence path now.

Net result: **one new connector, `purview`**, with two independent check groups (Data Map, Audit) sharing one Azure-AD-based credential setup but minting tokens for two different audiences — plus a second, catalog-only-placeholder row (`purview_compliance`) that needs no connector code at all.

This document is written to be self-contained enough to execute later without re-deriving the research — it includes the exact SQL, file layout, and function-level design decisions found during planning.

## Architecture being extended (confirmed by direct file reads)

- Catalog/schema lives entirely in `init.sql` (repo root, no migrations folder): `integrations` (catalog row: `key, name, category, auth_type, status`), `integration_connections` (per-company instance: `integration_key`, `status`, `config JSONB`, `external_account_id`), `integration_credentials` (AES-256-GCM encrypted secret blob via `api/src/utils/credentialCrypto.js` / `api/src/db/integrationCredentials.js` — `storeCredential`/`getActiveCredential`/`revokeCredentials`), `automated_tests` (Tier-1 check catalog: `test_key`, `severity_default`, `remediation_guidance`), `test_control_mappings` (`test_key → iso_reference` — the *entire* mechanism linking a check to ISO 27001 questions), `evidence_collection_runs`/`evidence_test_results`/`automated_evidence_items`/`findings`.
- `evidence_test_results.status` and hence every check function's return value is constrained by `CHECK (status IN ('pass','fail','warn','error','not_applicable'))` — this vocabulary must be respected exactly.
- Every connector in `api/src/connectors/<key>/` exports `{ key, tests, testConnection, runTests }`. **Azure** (`api/src/connectors/azure/`) is the closest template since it's also Azure-AD-Service-Principal-shaped:
  - `credentials.js`: `resolveAzureCredentials({authType, config, secret})` builds `new ClientSecretCredential(config.tenantId, secret.clientId, secret.clientSecret)` from `@azure/identity`, throwing on missing required fields or unsupported `authType`.
  - `index.js`: `buildClients(credential, subscriptionId)` builds one SDK client per resource area; `testConnection` does one cheap connectivity probe (`resources.resourceGroups.list().next()`) and returns `{ok: true, externalAccountId}`; `runTests` iterates the flat `tests` array, calls `test.run(clients)` per entry, flattens to `{testKey, title, severity, ...result}`; both wrap SDK errors via `describeAzureError`, which extracts the real ARM error message (the SDK's paging helper otherwise discards it) and appends actionable guidance (e.g. "if this is AuthorizationFailed, double-check the Service Principal's role assignment scope").
  - `tests/<group>.js`: each file exports individual async check functions taking client(s), returning `Promise<Array<{resourceId, status, message, evidencePayload}>>`, plus an exported array like `loggingTests = [{key, title, severityDefault, isoReferences, run: (clients) => checkFn(clients.x)}, ...]`. The idiom `if (results.length === 0) results.push({resourceId: "...", status: "not_applicable"/"fail", ...})` is used when the resource being checked doesn't exist at all.
- `api/src/connectors/registry.js` is a trivial key→module map: `import * as azure from "./azure/index.js"; const connectors = {[azure.key]: azure, ...}; export function getConnector(key) { ...throws on unknown key... }`.
- All connectors share **one** routes file, `api/src/routes/integrations.js`, mounted at `/api/integrations` in `routes/index.js`. Generic endpoints already handle everything: `GET /` (connections list), `GET /catalog`, `GET /:id`, `GET /:id/runs`, `POST /` (create pending connection), `POST /:id/credentials` (store secret + call `testConnection`, flips status connected/error), `POST /:id/run` (calls `runCollection`), `DELETE /:id` (soft-revoke via crypto-shred, or hard-delete if never had a successful run). Each connector adds only a `GET /<key>/setup-info` route + a hardcoded permissions constant (e.g. `AZURE_READ_ONLY_ROLE_DEFINITION`) explicitly comment-documented as "kept in lockstep with exactly what the connector's checks call."
- Evidence→ISO linking (`api/src/utils/collectionRunner.js`, `runCollection`) is 100% connector-agnostic: for each check result it inserts `evidence_test_results`; on `pass` it upserts an `evidence_vault` item and links it to every `questions` row (per company) whose `iso_reference` matches via `test_control_mappings`, and upserts `automated_evidence_items`/auto-resolves prior `findings`; on `fail` it upserts a `findings` row. **No connector code touches ISO references directly** — correct `test_key` seeding is the only requirement.
- Frontend: `web/src/pages/IntegrationsSettings.jsx` (catalog + connection list + `AddIntegrationWizard`, hardcoded `PROVIDER_ICON` map at lines 15-19, `AzureServicePrincipalWalkthrough` component at lines ~118-155 fetching `GET /api/integrations/azure/setup-info` and rendering copy-paste setup instructions + `tenantId`/`subscriptionId` inputs) and `web/src/pages/ConnectionDetail.jsx` (detail + run history + Rotate Credentials modal, reusing the same walkthrough). Shared `web/src/components/CredentialFields.jsx` already renders generic `clientId`/`clientSecret` inputs for any `oauth2` provider.

## Plan

### Task 0 — Research/verification gate (no code)

Must be confirmed against Microsoft's current docs (and ideally a live tenant) before writing check code — everything downstream depends on this. Resolve #1 first since it gates the ability to make any real call.

1. **Atlas endpoint URL format.** Confirm `https://{accountName}.purview.azure.com` vs. the newer Unified-Catalog-SKU account's endpoint shape. Don't assume it's derivable purely from `config.purviewAccountName` — the Azure Portal's Purview account Properties page exposes an explicit "Atlas endpoint" value; consider requiring `config.atlasEndpoint` as a distinct field if derivation proves unreliable.
2. **Purview RBAC role.** Which built-in role (Data Reader vs. Data Curator vs. a custom collection-scoped role) is minimally sufficient for read-only checks; whether it must be assigned at the root collection or can be scoped narrower; propagation delay (Azure ARM roles take ~30 min — verify Purview's is comparable, for error-guidance text).
3. **Data Map/Atlas response shapes.** Registered data-source list + scan status/history endpoint; classification fields on entity search results; sensitivity-label fields on an entity (confirm these are actually exposed via the Atlas API, not only the Portal UI); the per-source-type capability matrix (which source types can't be classified/labeled, so those checks must resolve `not_applicable`).
4. **`@azure-rest/purview-datamap` npm package viability.** Current version, preview/stability status, whether it covers the entity/classification/scan-status calls needed. Default assumption going in: prefer hand-rolled plain REST (`fetch`) for both check groups, for consistency with the Audit API (which has no SDK at all) — confirm or override this here.
5. **O365 Management Activity API shapes.** `POST /subscriptions/start`, `GET /subscriptions/list` (status per content type), `GET /subscriptions/content` (available content blobs + URIs for a date range), one content-blob download response (only need enough to extract a timestamp, not full parsing).
6. **Verbatim permission list** for the setup-info constant: exact Purview RBAC role name + scope, and exact Entra "Office 365 Management APIs" **application** permission names — best current guess is `ActivityFeed.Read`, `ActivityFeed.ReadDlp`, `ServiceHealth.Read`, but confirm against current docs since these change.
7. **Unified-audit-logging-off failure signature.** What error/response shape indicates audit logging is off vs. not-yet-propagated vs. genuinely empty, so `purview.audit.unified_logging_enabled` can tell these apart.

### Task 1 — Schema seed (`init.sql`)

Insert immediately after the existing GitHub seed block (currently ends ~line 671, right before `-- ===== Idempotent upgrade guards (existing databases) =====`), following the exact idempotent pattern already used for `aws`/`azure`/`github`:

```sql
-- ===== Purview connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('purview', 'Microsoft Purview', 'data_governance', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('purview', 'purview.datamap.sources_scanned', 'Registered data sources have a recent successful scan', 'Checks every registered Data Map source has completed a successful scan within the last 30 days.', 'high', 'Run or re-schedule a scan for the source in Microsoft Purview > Data Map > Sources.'),
  ('purview', 'purview.datamap.scan_schedule_configured', 'Registered data sources have a recurring scan schedule', 'Checks each registered source has a recurring (not one-off) scan trigger configured.', 'medium', 'Edit the source''s scan and set a recurring trigger instead of "Once".'),
  ('purview', 'purview.datamap.classification_applied', 'Scanned assets have classifications applied', 'Checks scanned assets have at least one data classification applied where the source type supports classification.', 'medium', 'Review scan rule sets to ensure classification rules are enabled for this source type, then re-run the scan.'),
  ('purview', 'purview.datamap.sensitivity_labels_applied', 'Scanned assets have sensitivity labels applied', 'Checks scanned assets carry a sensitivity label where the source type supports labeling.', 'medium', 'Apply sensitivity labels via auto-labeling policies or manually label the asset in the Purview Unified Catalog.'),
  ('purview', 'purview.audit.unified_logging_enabled', 'Unified audit logging is enabled', 'Checks unified audit logging is turned on for the tenant.', 'critical', 'Enable audit logging in Microsoft Purview > Audit > Start recording user and admin activity.'),
  ('purview', 'purview.audit.subscriptions_active', 'Required audit log content-type subscriptions are active', 'Checks Azure AD, Exchange, SharePoint, and General audit content-type subscriptions are enabled.', 'high', 'Start the missing content-type subscription via the Office 365 Management Activity API or re-run Prism''s connection setup.'),
  ('purview', 'purview.audit.dlp_alerts_available', 'DLP audit content is available', 'Checks the DLP.All content-type subscription is active and retrievable, evidencing DLP policy enforcement logging.', 'high', 'Confirm at least one DLP policy is enabled in Purview and that the DLP.All subscription is active.'),
  ('purview', 'purview.audit.content_recently_available', 'Audit content is actively flowing', 'Checks at least one audit content blob was produced within the last 24 hours for each active subscription, proving logs are actually flowing rather than merely subscribed.', 'medium', 'Investigate why no recent audit content is available - this can indicate audit logging was disabled after setup or the subscription lapsed.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('purview.datamap.sources_scanned', 'A.8.1.1'),
  ('purview.datamap.scan_schedule_configured', 'A.8.1.1'),
  ('purview.datamap.classification_applied', 'A.8.2.1'),
  ('purview.datamap.sensitivity_labels_applied', 'A.8.2.3'),
  ('purview.audit.unified_logging_enabled', 'A.12.4.1'),
  ('purview.audit.subscriptions_active', 'A.12.4.1'),
  ('purview.audit.dlp_alerts_available', 'A.13.2.1'),
  ('purview.audit.content_recently_available', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Purview Compliance Manager: catalog-only placeholder (no connector) =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('purview_compliance', 'Microsoft Purview Compliance Manager', 'data_governance', 'oauth2', 'coming_soon')
ON CONFLICT (key) DO NOTHING;
```

Notes:
- `category = 'data_governance'` is a new value — `integrations.category` has no CHECK constraint (only `auth_type`/`status` do), confirmed safe to introduce.
- `A.13.2.1` (information transfer policies) chosen for DLP over `A.18.1.4` as the more defensible ISO 27001:2013 Annex A control, staying consistent with the 2013 numbering the existing `aws`/`azure` mappings already use — flag as an assumption worth a quick sanity check against whatever ISO edition Prism's `modules`/`questions` seed actually targets.
- `purview_compliance` deliberately gets **no** `automated_tests` or `test_control_mappings` rows and **no** registry entry (Task 4) — it exists purely so it renders in the catalog's "coming soon" section.

### Task 2 — Credentials module (`api/src/connectors/purview/credentials.js`)

Depends on Task 0 findings #1, #2, #6. Design:

- Export `resolvePurviewCredentials({ authType, config, secret })`. Validate `authType === 'oauth2'`; `config.tenantId`; `config.purviewAccountName` (or `config.atlasEndpoint`, per Task 0.1); `secret.clientId`/`secret.clientSecret` — throw a descriptive error on any missing field, matching `resolveAzureCredentials`'s fail-fast style.
- Unlike Azure, return **not** a single SDK credential object but a small object exposing two async token-getters, since Data Map and Audit are different token audiences with no unifying `@azure/identity` credential shape here:
  - `getDataMapToken()` → client-credentials token for `resource=https://purview.azure.net` (confirm during Task 0 whether Atlas expects the older ADAL-style `resource=` param or the newer MSAL `scope=`/`.default` form).
  - `getAuditToken()` → client-credentials token for `resource=https://manage.office.com`.
  - Also return the resolved Atlas base URL so `index.js`/`tests/datamap.js` don't re-derive it.
- Can use `@azure/identity`'s `ClientSecretCredential.getToken(...)` twice with different scopes if that satisfies Task 0's audience-shape finding, or a plain `fetch` against `https://login.microsoftonline.com/{tenantId}/oauth2/token` if the v1 `resource=` form is required and MSAL doesn't expose it cleanly. Keep this file's only responsibility "hand back valid bearer tokens + base URLs" — all HTTP calls to the actual APIs happen in `index.js`/`tests/*.js`.

### Task 3 — Check groups (independent, parallelizable once Task 2 lands)

**3a — `api/src/connectors/purview/tests/datamap.js`** (depends on Task 0 #1/#3/#4, Task 2). Each check function takes the Data Map client wrapper, returns `Promise<Array<{resourceId, status, message, evidencePayload}>>`; exported array mirrors `azure/tests/logging.js`'s `loggingTests` shape: `{key, title, severityDefault, isoReferences, run: (clients) => checkFn(clients.dataMap)}`.
- `checkSourcesScanned` — per registered source, `pass` if latest scan run succeeded within the lookback window (30 days), `fail` if latest run failed or is stale; `not_applicable` if zero sources are registered at all.
- `checkScanScheduleConfigured` — per source, `pass`/`fail` on whether the scan trigger is recurring vs. one-off/none.
- `checkClassificationApplied` — per scanned asset/source, `pass` if classifications present, `fail` if the source type supports classification but none is found, `not_applicable` if the source type doesn't support classification (per Task 0.3's capability matrix — implement as a small `sourceTypeSupportsClassification(sourceType)` helper with a comment citing that research finding).
- `checkSensitivityLabelsApplied` — same shape, keyed off label support instead of classification support.

**3b — `api/src/connectors/purview/tests/audit.js`** (depends on Task 0 #5/#6/#7, Task 2). No direct Azure analog (Azure has no subscription/poll-shaped API), but same per-function structure:
- `checkUnifiedLoggingEnabled` — single check, `pass`/`fail` based on tenant audit-logging status (via whatever Task 0.7 determines is the observable signal).
- `checkSubscriptionsActive` — one result per required content type (`Audit.AzureActiveDirectory`, `Audit.Exchange`, `Audit.SharePoint`, `Audit.General`), `pass` if `enabled`, `fail` if not started/paused.
- `checkDlpAlertsAvailable` — checks the `DLP.All` subscription; **judgment call to make explicit in code comments**: `not_applicable` when the tenant has no DLP policies configured at all (not a compliance gap this check should flag), `fail` when DLP is configured but the subscription isn't logging.
- `checkContentRecentlyAvailable` — for each active subscription, checks the content-availability endpoint for the last 24h window; `pass` if ≥1 blob returned, `fail` if zero (subscribed but nothing flowing), `error` (not `fail`) if the API call itself errors — keep this distinction, it maps directly to the DB CHECK constraint's `error` vs. `fail` values.

Both files' arrays concatenate in `index.js`: `export const tests = [...datamapTests, ...auditTests];`.

### Task 4 — Connector assembly + registry

`api/src/connectors/purview/index.js`:
- `buildClients(purviewCreds)` → `{ dataMap: <authenticated-fetch wrapper against the Atlas base URL>, audit: <authenticated-fetch wrapper against manage.office.com> }` — thin fetch wrappers, not SDK client instances (per Task 0.4's likely "plain REST" outcome).
- `testConnection({authType, config, secret})` — resolve credentials, probe **both** audiences independently (e.g. one Data Map "list sources" call, one Audit "list subscriptions" call). This is the key UX difference from Azure's single-probe check: a customer can mis-grant one side and not the other, so on failure the error must say *which* grant (Purview RBAC role vs. Entra API permission) is missing, not just "connection failed." Return `{ ok: true, externalAccountId: config.purviewAccountName }` on success.
- `runTests({authType, config, secret})` — same iterate-and-flatten pattern as Azure's `runTests`, wrapping errors through `describePurviewError`.
- `describePurviewError(err)` — distinguishes Atlas-shaped error bodies from O365-Management-API-shaped error bodies (exact shapes confirmed in Task 0.3/0.5) and names the likely missing grant based on which client the failing call came through, mirroring Azure's `describeAzureError` "if this is AuthorizationFailed, double-check..." guidance pattern.
- `api/src/connectors/registry.js`: add `import * as purview from "./purview/index.js";` and `[purview.key]: purview` to the `connectors` object — a one-line-shape change matching the file's existing trivial form exactly. `purview_compliance` gets no entry (there is no connector module for it — `getConnector('purview_compliance')` should throw, and a test should assert this as a guardrail against accidentally wiring it up later).

### Task 5 — Routes (`api/src/routes/integrations.js`)

Add a `PURVIEW_REQUIRED_PERMISSIONS` constant near `AZURE_READ_ONLY_ROLE_DEFINITION`, comment-documented the same way ("kept in lockstep with exactly what connectors/purview's checks call"):

```js
const PURVIEW_REQUIRED_PERMISSIONS = {
  purviewRbacRole: {
    roleName: "<confirmed in Task 0.2>",
    scope: "Root collection (or account-level)",
    note: "Assigned in the Purview governance portal's Data Map > Collections > Role assignments — NOT an Azure RBAC/IAM role assignment.",
  },
  office365ManagementApiPermissions: {
    type: "Application permissions (not Delegated) — require tenant admin consent",
    permissions: ["ActivityFeed.Read", "ActivityFeed.ReadDlp", "ServiceHealth.Read"],
    note: "Granted under the app registration's API permissions > Office 365 Management APIs, then 'Grant admin consent'.",
  },
  prerequisites: ["Unified audit logging must be turned on in Purview > Audit settings before subscriptions will return data."],
};
```

Add `router.get("/purview/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => { res.json({ permissions: PURVIEW_REQUIRED_PERMISSIONS }); }));` immediately after the existing `/azure/setup-info` route, same middleware chain and response-shape convention (top-level object matching `{roleDefinition}`'s pattern). No other route changes are needed — every other endpoint is already connector-agnostic and will pick up `purview` and `purview_compliance` automatically once Task 1's seed rows exist.

### Task 6 — Frontend

Files: `web/src/pages/IntegrationsSettings.jsx`, `web/src/pages/ConnectionDetail.jsx`. `web/src/components/CredentialFields.jsx` needs no changes (already generic for `oauth2`'s `clientId`/`clientSecret`).

1. **Icon map** (`PROVIDER_ICON`, lines 15-19): add `purview: { Icon: FaMicrosoft, color: "#8661C5" }` (no dedicated Purview glyph in `react-icons/fa`; reuse Microsoft's icon with Purview's brand purple to visually distinguish from Azure's blue row). Optionally add `purview_compliance` too if the coming-soon catalog list renders an icon per row.

2. **New `PurviewWalkthrough` component**, placed after `AzureServicePrincipalWalkthrough` (~line 155), same shape (fetch `GET /api/integrations/purview/setup-info` on mount, render numbered instructions + copyable JSON, then input fields) but must explain **two** grant types clearly:
   - Steps: (1) create/reuse an Entra app registration + client secret (same as Azure's steps 1-3); (2) grant the Purview RBAC role from `setupInfo.permissions.purviewRbacRole` inside the **Purview governance portal** — explicitly flag this is a different portal than Azure IAM, the most likely point of confusion; (3) grant the `office365ManagementApiPermissions` list under the app registration's API permissions blade and click "Grant admin consent" — explicitly flag this requires **Global Administrator or Privileged Role Administrator**, a higher privilege bar than Azure's single step; (4) confirm unified audit logging is on (from `setupInfo.permissions.prerequisites`); (5) paste Tenant ID, Purview account name, Client ID, Client Secret.
   - Config fields collected: `tenantId` + `purviewAccountName` (new, Purview-specific) → `config = { tenantId, purviewAccountName }`.

3. **Wizard wiring — existing-code gotcha to fix, not just extend.** `AddIntegrationWizard`'s `authType === "oauth2"` branch (~line 289-300) currently *unconditionally* renders `<AzureServicePrincipalWalkthrough>` and `handleSubmit`'s `config`/`secret` construction (~line 204-209) is hardcoded to Azure's `{tenantId, subscriptionId}` shape for every `oauth2` provider — GitHub avoids this only via its own separate `provider.key === "github"` special-case earlier in the file. Adding Purview as a second `oauth2` provider requires:
   - Render branch: switch on `provider.key` (`"azure"` → `AzureServicePrincipalWalkthrough`, `"purview"` → `PurviewWalkthrough`).
   - `config`/`secret` construction: switch on `provider.key` within the `oauth2` case (`secret = {clientId, clientSecret}` stays shared; `config` becomes `{tenantId, subscriptionId}` for Azure vs. `{tenantId, purviewAccountName}` for Purview).
   - Apply the same fix in `ConnectionDetail.jsx`'s Rotate Credentials modal (confirm whether it shares this branching logic via a helper or duplicates it, and patch accordingly).

4. **`purview_compliance` row** — no wizard/walkthrough work. Verify (quick check during implementation, not a design decision) that the catalog UI already disables/hides "Connect" for `status === 'coming_soon'` rows; if it doesn't handle that state at all yet, that's a small separate fix.

### Task 7 — Tests

Mirror the Azure suite by analogy (same directory, `api/src/__tests__/`):
- `connectorsPurviewCredentials.test.js` — mirrors `connectorsAzureCredentials.test.js`: missing-field/unsupported-authType errors, both token-getters work against mocks.
- `connectorsPurviewIndex.test.js` — mirrors `connectorsAzureIndex.test.js`: `testConnection` success/failure including the "one grant present, one missing" partial-failure case unique to Purview; `runTests` flattening; `describePurviewError` message shaping for both API error shapes.
- `connectorsPurviewDatamap.test.js` — mirrors `connectorsAzureLogging.test.js`/`connectorsAzureNetwork.test.js`: each check function against mocked Data Map responses, including the `not_applicable` branches (zero sources, unsupported source type).
- `connectorsPurviewAudit.test.js` — new group, unit-tested the same way: subscription-list parsing, content-availability-window logic, the DLP "no policies configured" vs. "configured but not logging" distinction.
- `connectorsPurviewSdkShapes.test.js` — mirrors `connectorsAzureSdkShapes.test.js`: pins the plain-REST response shapes recorded in Task 0.3/0.5 so an API contract drift breaks a test instead of silently producing wrong results.
- Extend `connectorsRegistry.test.js`: assert `getConnector('purview')` resolves and `getConnector('purview_compliance')` throws.
- Extend `api/src/__tests__/integration/integrations.test.js`: `GET /api/integrations/catalog` includes both `purview` (`active`) and `purview_compliance` (`coming_soon`); `GET /api/integrations/purview/setup-info` returns the `PURVIEW_REQUIRED_PERMISSIONS` shape; full create→store-credentials→run flow against a mocked connector confirms `evidence_test_results`/`findings`/`evidence_vault` land correctly through the untouched `collectionRunner.js`.
- Extend `api/src/__tests__/integration/integrationCredentials.test.js`: rotate-credentials and crypto-shred-revoke flow for a `purview` connection (should need only a new fixture, no new logic, since this layer is already fully generic to `authType`).

### Ordering & dependencies

```
Task 0 (research gate)
  └─▶ Task 1 (schema seed)          — independent of Task 0, can start immediately in parallel
  └─▶ Task 2 (credentials module)   — blocked on Task 0 findings #1, #2, #6
        └─▶ Task 3a (datamap checks) — blocked on Task 0 #1/#3/#4 + Task 2
        └─▶ Task 3b (audit checks)   — blocked on Task 0 #5/#6/#7 + Task 2
              └─▶ Task 4 (index.js + registry)   — blocked on both 3a and 3b (needs the full tests array)
                    └─▶ Task 5 (routes/setup-info) — blocked on Task 4 + Task 0 #6
                          └─▶ Task 6 (frontend)     — blocked on Task 5 (walkthrough copy must match setup-info exactly) + Task 1 (catalog row must exist)
Task 7 (tests) — each sub-file blocked only on its corresponding implementation task
```

**Parallelizable if split across subagents:** Task 1 vs. Task 0 (schema doesn't need live-API findings, only the test_key names, which are already fixed above); Task 3a vs. Task 3b (different files, different APIs); Task 7's per-group test files alongside their implementation tasks. **Do not parallelize Task 6 against Task 5** — the walkthrough's copy directly depends on the exact `PURVIEW_REQUIRED_PERMISSIONS` shape, and letting them drift is the most likely source of a confusing setup flow. Within Task 0, resolve #1 before the others — it gates the ability to make any real test call.

## Verification (once implemented)

- `npx vitest run` scoped to each new `connectorsPurview*.test.js` file individually (no DB needed), then full `npm test` in `api/`.
- `npm run test:integration` in `api/` against local Postgres for the extended `integrations.test.js`/`integrationCredentials.test.js` — confirms the seed rows load via `init.sql`, catalog/setup-info endpoints respond correctly, and a full mocked run produces correctly-linked `evidence_vault`/`findings` rows.
- Manually exercise the wizard in the browser (`docker compose up --build`, then `/settings/integrations`): confirm the Purview card appears with the new icon, "Connect" renders `PurviewWalkthrough` (not Azure's), both permission sections render correctly, and `purview_compliance` shows as coming-soon with no connect action.
- **No live Purview tenant/credentials are available in this environment**, so `testConnection` against real Purview APIs cannot be verified end-to-end during implementation — call this out explicitly when reporting completion, and do one real connect-and-run pass (with an actual Purview account + app registration) before shipping to production.

## Critical files

- `init.sql` — schema seed (Task 1)
- `api/src/connectors/azure/credentials.js`, `api/src/connectors/azure/index.js`, `api/src/connectors/azure/tests/logging.js` — the templates Tasks 2-4 mirror
- `api/src/connectors/registry.js` — Task 4 wiring
- `api/src/routes/integrations.js` — Task 5
- `web/src/pages/IntegrationsSettings.jsx`, `web/src/pages/ConnectionDetail.jsx` — Task 6
- `api/src/__tests__/connectorsAzure*.test.js`, `api/src/__tests__/connectorsRegistry.test.js`, `api/src/__tests__/integration/integrations.test.js`, `api/src/__tests__/integration/integrationCredentials.test.js` — Task 7 templates
