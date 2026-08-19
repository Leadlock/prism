# Carbonite (OpenText Core Endpoint Backup) Evidence Collection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Not the product you're looking for?** OpenText also sells a separate, self-hosted **Carbonite Server Backup** product line with its own read-only OData "API – Monitoring" component (Keycloak OIDC auth) — an unrelated API from this plan's SOAP-based Dashboard Service. See the sibling plan `2026-08-18-carbonite-server-backup-evidence-collection-v1.md` if the target customer runs Server Backup instead of Core Endpoint Backup.

**Goal:** Add OpenText Carbonite (Core Endpoint Backup) as a fourth evidence-collection connector alongside AWS, Azure, and Commvault — automated backup-compliance checks (recent successful backup per device, device protection coverage, legal-hold/records-protection state), authenticated via a customer-generated API key (`api_key` auth), proving the connector architecture generalizes to a provider whose only documented read-capable API is **SOAP/XML**, not REST/JSON — a structurally new shape distinct from AWS (`@aws-sdk/*`), Azure (`@azure/arm-*` + `TokenCredential`), and Commvault (JSON REST via built-in `fetch`).

**Architecture:** Mirrors `api/src/connectors/{aws,azure,commvault}/` at the module-contract level exactly — `key`, `tests`, `testConnection`, `runTests`, registered in `connectors/registry.js`, zero changes to `collectionRunner.js` (already proven provider-agnostic across three structurally different connectors in `api/src/__tests__/integration/collectionRunner.test.js`). The genuine structural difference this plan introduces: `carbonite/credentials.js` resolves into a request-helper that builds and posts **SOAP XML envelopes** (not JSON bodies) via Node's built-in `fetch`, and parses XML responses — because the only Carbonite API confirmed to expose device backup-status data is a SOAP web service with no Node SDK, no REST wrapping, and no OpenAPI spec.

**Spec:** No pre-existing plan-mode design doc — decisions below (which of Carbonite's two APIs to use, which checks to build, ISO mappings, SOAP-vs-dependency choice) were made directly during this research pass. Every Carbonite REST/SOAP endpoint path or field name cited below is either **(a) confirmed** — fetched directly from OpenText/Carbonite's own published documentation, cited inline with the source URL — or **(b) unconfirmed** — flagged explicitly and folded into Task 0. Context7 was tried first and found unusable for this vendor (see "Context7 research note" below); all citations are from direct web research instead.

**Context7 research note:** `resolve-library-id` for "OpenText Carbonite" only matched a generic "OpenText Product Documentation Portal" (`/websites/microfocus_doc_397_24_1`) whose query results kept returning docs for **OpenText Operations Orchestration (OO Central)** — an unrelated OpenText product (workflow automation) — regardless of query wording ("Carbonite backup API", "Carbonite Availability Migrate Backup REST API endpoints", etc.). A second resolve for "Carbonite" alone matched `/bitcrowd/carbonite`, an unrelated Elixir Postgres audit-trail library. Neither is usable for this integration; do not re-attempt Context7 for this vendor without a much more specific query, and expect it to fail again.

---

## Critical finding: "Carbonite" is not one API — and the read-capable one is SOAP, not REST

Web research against `support.carbonite.com` and `developer.opentext.com` surfaced **two separate, independently-authenticated APIs** for OpenText Core Endpoint Backup (formerly "Carbonite Endpoint"):

### API 1 — "Endpoint REST API" (JSON, JWT) — confirmed for auth + provisioning only
Source: [Endpoints and authentication](https://support.carbonite.com/guides/Endpoint/RestAPI/Content/EndpointsAuthentication.htm), [Sample code](https://support.carbonite.com/guides/Endpoint/RestAPI/Content/SampleCode.htm)

- Base URL: `https://red-<region>.mysecuredatavault.com` (`<region>` is account-specific).
- Auth flow (confirmed, quoted verbatim from the docs):
  ```
  POST https://red-region.mysecuredatavault.com/api/tokens/apikey
  Content-Type: application/json
  { "ApiKeySecret": "<secret from dashboard Key Management>", "Email": "<account email>" }

  → 200 { "access_token": "<JWT, ~1250 chars>" }
  ```
  Subsequent calls: `Authorization: Bearer <access_token>`.
- Rate limits (confirmed): 50 requests/hour/route, 100 user creations/hour.
- Confirmed capabilities: user creation, company creation. A "Schedule Admin Restore" capability is referenced in OpenText's own marketing/search-index copy, but **the only restore-scheduling call actually found in the docs (`AddAdministrativeRestoreJob`) lives in API 2 below (the SOAP tree), not this JSON tree** — so it's unconfirmed whether this REST API independently exposes restore scheduling, or whether that description was conflating the two APIs.
- **Not confirmed:** whether this API exposes ANY read/reporting endpoint for device list, backup status, or protection state. No such endpoint was found in any fetched page or search result under `/guides/Endpoint/RestAPI/Content/`. This matters a lot — see the decision below.

### API 2 — "Endpoint API" (legacy SOAP "Dashboard Service") — confirmed source of all backup-status data
Source: [How to use the API](https://support.carbonite.com/guides/Endpoint/API/Content/HowToUseTheApi.htm), [General API structure](https://support.carbonite.com/guides/Endpoint/API/Content/GeneralApiStructure.htm), [API calls index](https://support.carbonite.com/guides/Endpoint/API/Content/ApiCalls/ApiCalls.htm)

- **Protocol: SOAP/WSDL, not REST/JSON.** Confirmed quote: *"Add a Service Reference to your project for the Dashboard Service at `https://servername/Dashboard/DashboardService.v.1.0.svc`"* (WSDL at `?WSDL`). Docs only show C#, PowerShell, and VBA-via-proxy-assembly client examples — no Node/JS example exists anywhere in the vendor docs.
- Auth: every call carries a `CallingContext` object **inside the SOAP XML envelope** (not a header): `{ ContextIdentity (username), AuthenticationToken (password/API key), TokenType (enum, values unconfirmed) }`. This is a **different auth model from API 1's JWT** — confirm during Task 0 whether the same API-key secret works as `AuthenticationToken` here, or whether a separate credential is needed.
- Response envelope (confirmed): every call returns `ServiceResponse` with a `Status` enum (`Unknown|Completed|InvalidCredentials|ExpectedVersionNoSupportedAtThisEndpoint|InvalidInput|ServerUnableToProcessRequest`) wrapping a per-call `*Result` extending `BaseServiceResult`, whose `OverallStatus` enum is `Unknown|Success|NotAllowed|InsufficientPermissions|DuplicateEntry|ParentEntityCannotBeResolved|EntityCannotBeResolved|PartialFailure|Failure`.
- All 12 confirmed operations (from the API calls index): `AddAdministrativeRestoreJob`, `CancelDashboardDevice`, `DeleteDataFromDashboardDevice`, `EditDashboardDeviceInfo`, **`GetDashboardDeviceInfo`**, **`GetDeviceList`**, `ProvisionEntities`, `ProvisionUsers`, `ReactivateSuspendedDashboardDevice`, `SendActivationEmail`, `SuspendDashboardDevice`, `UpdateDeviceLegalHoldState`. **No bulk "report"/"export" call exists in this list** — flagged as a scale caveat below.
- `GetDeviceList` (confirmed fields, from [GetDeviceList](https://support.carbonite.com/guides/Endpoint/API/Content/ApiCalls/GetDeviceList.htm)): input `{ Filter?: string, RestrictingEntityId?: Guid }`; output `DeviceList[]` of `{ DeviceId, DeviceName, UserEmail, UserId, CompanyName, CompanyId, PartnerName, PartnerId, State (EntityState), ClientUsageBytes, StorageQuotaGB, LastBackupUtc }`. Docs explicitly caveat: capped at ~100 devices, **"not suitable for report generation."**
- `GetDashboardDeviceInfo` (confirmed fields, from [GetDashboardDeviceInfo](https://support.carbonite.com/guides/Endpoint/API/Content/ApiCalls/GetDashboardDeviceInfo.htm)): input `{ WhichField: EntityIds|EntityName|Custom1|Custom2|Custom3, FieldData: string[] }` (i.e. you must already know device IDs/names — it's a detail lookup, not a listing call); output `DeviceInfo[]` of `{ DeviceId, DeviceName, UserEmail, CompanyName, CompanyId, PolicySetId, PolicySetName, StorageQuotaGB, ClientUsageBytes, LastBackupUtc, LastCompleteBackupUtc, InitialActivationDateUtc, State (DeviceState), CreatedDateUtc, CancelledDateUtc, ... }` plus `ErrorDetails[]` for unresolved lookups. **`LastCompleteBackupUtc` is exactly the field a "recent successful backup" check needs.**
- `UpdateDeviceLegalHoldState` (confirmed fields): input `{ DeviceId, EnableLegalHold: bool, AuditComment?, LegalHoldComment? }`. This is a **write-only** call in the confirmed docs — no confirmed read field (on `GetDeviceList`/`GetDashboardDeviceInfo`) reports current legal-hold state back, so a "records under legal hold are protected" read-only check is **not confirmed to be buildable** from documented fields alone; Task 0 must check for an undocumented `LegalHold`/`IsOnLegalHold` field on the live device-info response.
- **`EntityState`/`DeviceState` enum values (Active/Suspended/Cancelled/etc.) are not published anywhere found** — genuinely unconfirmed. Every check that branches on `State` must be defensively coded (unrecognized value → `status: "error"`, not a guessed pass/fail), exactly like Commvault's plan handled its unconfirmed alert-category taxonomy.
- **No Node.js SDK exists.** Calling this API means either (a) hand-building minimal SOAP 1.1/1.2 XML envelopes with `fetch` + a small XML parser (no new heavy dependency, but real hand-rolled XML/SOAP code — more implementation risk than any existing connector), or (b) adding a SOAP client dependency (e.g. `soap` on npm) to `api/package.json`. **This is the single biggest cost/risk in this plan and the reason Carbonite is structurally harder than AWS/Azure/Commvault.**

### Decision this plan makes: target the SOAP Dashboard Service API for checks, JSON REST API for nothing (for now)
Because every backup-status field (`LastBackupUtc`, `LastCompleteBackupUtc`, `State`, `StorageQuotaGB`) is confirmed only on the SOAP side, and the JSON REST API has no confirmed read endpoint at all, this plan builds the connector against **API 2 (SOAP Dashboard Service)** exclusively. This is a deliberate scope decision, not an oversight — if a future audit of the JSON REST API turns up read endpoints, a second, simpler connector variant could reuse the existing `api_key`/JWT flow instead.

**Also flagged, not resolved by this plan:** OpenText separately documents an entirely different product line — **Carbonite Server Backup (Monitoring API)** — a self-hosted, read-only Swagger/REST API installed by the customer alongside their own on-prem Carbonite Server Backup Director/Portal (confirmed via [Carbonite Server Backup API – Monitoring v1.5 guide](https://download.labgroup.net/files/07%20ServerProtect%20Documentation/Carbonite%20Server%20Backup%20API%20-%20Monitoring%20v1.5%20-%20Installation%20Guide.pdf), which states the API runs on the customer's own server on port 80/443 with an installer-supplied HTTPS cert, and exposes read-only calls for agents/jobs/safesets). If the target customer runs Carbonite **Server Backup** rather than **Core Endpoint Backup**, this entire plan targets the wrong product — confirm which product the customer actually uses before starting Task 0.

---

## Global Constraints

- Every query touching tenant data must filter on `company_id = req.user.companyId` — this plan adds no new tenant-scoped routes beyond the existing generic `POST /:id/credentials`/`POST /:id/run` pattern. The one new route (`GET /carbonite/setup-info`) is static and non-tenant-scoped, matching `GET /azure/setup-info`'s and `GET /commvault/setup-info`'s pattern.
- No BullMQ/queue, no scheduling — backend-only, manual-trigger evidence collection, exactly like AWS/Azure/Commvault.
- `evidence_test_results.status` must be one of `'pass'|'fail'|'warn'|'error'|'not_applicable'` (DB CHECK constraint). Given how much of this connector's field/enum data is unconfirmed (see above), every check function must return `status: "error"` — not a guessed pass/fail — whenever a required field or enum value isn't present in the shape Task 0 confirmed. This discipline is even more load-bearing here than in the Commvault plan, since the entire API surface is undocumented-by-vendor SOAP.
- New dependency decision required at Task 0/Task 2: either hand-roll SOAP XML (no new dependency) or add a SOAP client package. Default recommendation: hand-roll, since the confirmed call surface is small (2 read calls actually needed: `GetDeviceList`, `GetDashboardDeviceInfo`) and a full SOAP client dependency is heavy for 2 calls — but revisit if Task 0's live verification finds the XML more complex than expected (e.g., WS-Security headers, MTOM, etc.).
- Out of scope for this plan (matching the Azure/Commvault backend plans' scope, which had separate frontend plan files): any frontend/UI work — connection wizard copy, catalog icon, category grouping. Backend-connector-only.

---

## File Structure

- Modify: `init.sql` — one `integrations` seed row (`key = 'carbonite'`, `category = 'backup'`, `auth_type = 'api_key'`), automated_tests seed rows, test_control_mappings seed rows
- Create: `api/src/connectors/carbonite/soapClient.js` — minimal SOAP envelope builder/parser (`callDashboardService(operation, callingContext, input)` → parsed JS object), isolated here so it's unit-testable independent of Carbonite-specific field mapping
- Create: `api/src/connectors/carbonite/credentials.js` — `resolveCarbonitCredentials({authType, config, secret}) => Promise<{ soapEndpoint, callingContext }>` (config carries the per-tenant `servername`/WSDL host; secret carries the API key used as `AuthenticationToken`)
- Create: `api/src/connectors/carbonite/tests/backup.js` — recent-successful-backup check (via `GetDashboardDeviceInfo.LastCompleteBackupUtc`)
- Create: `api/src/connectors/carbonite/tests/coverage.js` — device protection-state check (via `GetDeviceList.State`, defensively coded per the unconfirmed enum)
- Create: `api/src/connectors/carbonite/index.js` — `key`, `tests`, `testConnection`, `runTests`
- Modify: `api/src/connectors/registry.js` — register the carbonite connector
- Modify: `api/src/routes/integrations.js` — `CARBONITE_SETUP_INFO` const + `GET /carbonite/setup-info`
- Create: `api/src/__tests__/connectorsCarboniteSoapClient.test.js`
- Create: `api/src/__tests__/connectorsCarboniteCredentials.test.js`
- Create: `api/src/__tests__/connectorsCarboniteBackup.test.js`
- Create: `api/src/__tests__/connectorsCarboniteCoverage.test.js`
- Create: `api/src/__tests__/connectorsCarboniteIndex.test.js`
- Create: `api/src/__tests__/connectorsCarboniteLiveShapes.test.js` — **optional, env-gated, skipped in normal CI** — validates every open item from Task 0 against a real Core Endpoint Backup tenant
- Modify: `api/src/__tests__/connectorsRegistry.test.js` — add carbonite coverage
- Modify: `api/src/__tests__/integration/schema.evidenceCollection.test.js` — Task 1's seed coverage
- Modify: `api/src/__tests__/integration/collectionRunner.test.js` — extend the aws/azure/commvault fixture map with a fourth, SOAP-shaped `carbonite` fixture
- Modify: `api/src/__tests__/integration/integrations.test.js` — `GET /carbonite/setup-info` coverage

---

### Task 0: Verify live Carbonite Dashboard Service (SOAP) shapes — prerequisite, do before trusting Tasks 3–4

**Open items requiring a live tenant + real credentials to resolve (all currently best-effort/defensive placeholders):**

1. **`EntityState`/`DeviceState` enum values** — not published anywhere found. `tests/coverage.js`'s "device is actively protected" check needs the real values (expect something like `Active`, `Suspended`, `Cancelled`, `PendingActivation` — unconfirmed).
2. **Legal-hold read field** — confirm whether `GetDashboardDeviceInfo`'s live response includes an undocumented `LegalHold`/`IsOnLegalHold`-shaped field. If not present, drop the legal-hold read check from this plan entirely (it cannot be built from `UpdateDeviceLegalHoldState` alone, since that's write-only).
3. **Auth compatibility** — confirm the same `ApiKeySecret` used for the JSON REST API's `/api/tokens/apikey` flow also works as `CallingContext.AuthenticationToken` for the SOAP Dashboard Service, or whether a separate SOAP-specific credential must be generated. If separate, `credentials.js`'s secret shape needs two fields, not one.
4. **Real WSDL hostname pattern** — `https://servername/Dashboard/DashboardService.v.1.0.svc` uses a documentation placeholder (`servername`). Confirm the real per-tenant hostname pattern (e.g. is it under `mysecuredatavault.com` too, a `dashboard.carbonite.com` subdomain, or something the customer's admin console displays directly) — this becomes a required `config` field.
5. **SOAP envelope complexity** — fetch the live `?WSDL` document and confirm: SOAP 1.1 vs 1.2, presence of WS-Security headers beyond the documented `CallingContext` object, and the exact XML namespace/action strings needed for `GetDeviceList`/`GetDashboardDeviceInfo`. This determines whether hand-rolled XML (this plan's default) is actually feasible or whether a SOAP client dependency is warranted instead (see Global Constraints).
6. **Pagination/scale** — `GetDeviceList` is capped at ~100 devices and explicitly documented as "not suitable for report generation." Confirm how a company with >100 protected devices should be enumerated (repeated `Filter`-scoped calls? Is there an undocumented paging parameter?) — without this, the connector silently under-reports coverage for larger tenants.

- [ ] **Step 1: Get access to a live or trial Core Endpoint Backup tenant**, with an account able to generate an API key from the dashboard's Key Management page (per [Endpoints and authentication](https://support.carbonite.com/guides/Endpoint/RestAPI/Content/EndpointsAuthentication.htm)).

- [ ] **Step 2: Fetch the live WSDL and inspect it**
  ```bash
  curl -sk "https://<real-dashboard-host>/Dashboard/DashboardService.v.1.0.svc?WSDL" | tee /tmp/carbonite-dashboard.wsdl
  ```
  Resolve open item 4 (real hostname) and open item 5 (envelope complexity) from this document directly.

- [ ] **Step 3: Call `GetDeviceList` and `GetDashboardDeviceInfo` for a few real devices**, using a hand-built SOAP envelope per the WSDL's `soap:binding`/`soap:body` shape, and inspect the raw XML response for:
  - The real `State`/`EntityState` values present (open item 1)
  - Any legal-hold field present in `GetDashboardDeviceInfo`'s response (open item 2)
  - Whether the same API key works as `CallingContext.AuthenticationToken` (open item 3)

- [ ] **Step 4: Record confirmed shapes as code comments** in Tasks 2–4's files (`// CONFIRMED against <tenant> on <date>`), and correct any wrong assumption — the defensive `"error"`-status fallback paths mean a wrong guess degrades to a visible, explained result rather than a silently wrong pass/fail.

- [ ] **Step 5: (Optional) add the env-gated live-shape guard test** `connectorsCarboniteLiveShapes.test.js`, skipped unless `CARBONITE_TEST_HOST`/`CARBONITE_TEST_API_KEY`/`CARBONITE_TEST_EMAIL` are set — mirrors `connectorsCommvaultLiveShapes.test.js`'s pattern.

- [ ] **Step 6: Commit** the optional live-shape test only, with a message noting it's a manual verification tool, not runtime behavior.

---

### Task 1: Schema seed

**Files:** Modify `init.sql`; Test: `api/src/__tests__/integration/schema.evidenceCollection.test.js`

Add, immediately after the existing Commvault seed block:
```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('carbonite', 'OpenText Carbonite', 'backup', 'api_key', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('carbonite', 'carbonite.backup.recent_successful_backup', 'Devices have a recent successful backup', 'Checks each protected device''s LastCompleteBackupUtc is within the configured policy window.', 'critical', 'Investigate devices with stale or missing backups in the Core Endpoint Backup dashboard and remediate failing backup jobs.'),
  ('carbonite', 'carbonite.backup.device_coverage', 'Devices remain actively protected', 'Checks no expected device has silently lapsed into a suspended/cancelled state.', 'high', 'Reactivate or re-enroll any device unexpectedly suspended or cancelled in the Core Endpoint Backup dashboard.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('carbonite.backup.recent_successful_backup', 'A.12.3.1'),
  ('carbonite.backup.device_coverage', 'A.12.3.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```
(Add a third `carbonite.legal_hold.*` test + mapping to `A.18.1.3` only if Task 0 step 3 confirms a readable legal-hold field exists — otherwise this check does not ship.)

Write the failing schema test first (mirror the existing aws/azure/commvault blocks in `schema.evidenceCollection.test.js`), then the seed, then verify it passes; commit.

---

### Task 2: SOAP envelope client + Carbonite credential resolution

**Files:** Create `api/src/connectors/carbonite/soapClient.js`, `api/src/connectors/carbonite/credentials.js`; Tests: `connectorsCarboniteSoapClient.test.js`, `connectorsCarboniteCredentials.test.js`

`soapClient.js` sketch (envelope shape to be finalized once Task 0 confirms the real WSDL — this is illustrative, not final):
```js
export async function callDashboardService({ endpoint, operation, callingContext, input }) {
  const envelope = buildSoapEnvelope(operation, callingContext, input); // XML string
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `.../${operation}` }, // TODO CONFIRM exact SOAPAction format from WSDL
    body: envelope,
  });
  const xml = await res.text();
  return parseSoapResponse(xml, operation); // throws on ServiceResponse.Status !== "Completed"
}
```

`credentials.js`: `resolveCarboniteCredentials({authType, config, secret})` returns `{ endpoint: config.dashboardHost + "/Dashboard/DashboardService.v.1.0.svc", callingContext: { ContextIdentity: secret.email, AuthenticationToken: secret.apiKey, TokenType: "..." } }` (exact `TokenType` value pending Task 0 step 3).

Write failing unit tests first: envelope construction (given known inputs, assert the XML contains expected elements — no live network call, use a mocked `fetch`), response parsing (given a canned XML fixture, assert correct JS object / correct error-throwing on `InvalidCredentials`), then implement, then verify green, then commit.

---

### Task 3: Backup recency check (`carbonite.backup.recent_successful_backup`)

**Files:** Create `api/src/connectors/carbonite/tests/backup.js`; Test: `connectorsCarboniteBackup.test.js`

For each device (from `GetDeviceList`), calls `GetDashboardDeviceInfo` to get `LastCompleteBackupUtc`, compares against a policy window (default candidate: 48 hours — confirm against existing Azure/AWS check conventions for a "recency" default, or make configurable), returns `pass`/`fail` per device with `evidencePayload: { deviceId, deviceName, lastCompleteBackupUtc }`. If `LastCompleteBackupUtc` is absent/null (never backed up), `fail` with a distinct message. TDD: write the test with mocked `soapClient` responses first, including an "unrecognized/missing field" case asserting `status: "error"`.

---

### Task 4: Device coverage check (`carbonite.backup.device_coverage`)

**Files:** Create `api/src/connectors/carbonite/tests/coverage.js`; Test: `connectorsCarboniteCoverage.test.js`

Iterates `GetDeviceList.State`; defensively maps only the enum values confirmed in Task 0 to pass/fail, anything else → `status: "error", message: "Unrecognized device state '<value>' — see Task 0"`. TDD as above.

---

### Task 5: Connector assembly + registry wiring

**Files:** Create `api/src/connectors/carbonite/index.js`; Modify `api/src/connectors/registry.js`; Test: `connectorsCarboniteIndex.test.js`

`index.js` mirrors `azure/index.js`'s/`commvault/index.js`'s shape exactly:
```js
export const key = "carbonite";
export const tests = [...backupTests, ...coverageTests];

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveCarboniteCredentials({ authType, config, secret });
  await callDashboardService({ ...creds, operation: "GetDeviceList", input: {} }); // cheap probe, throws on bad creds
  return { ok: true, externalAccountId: config.dashboardHost };
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveCarboniteCredentials({ authType, config, secret });
  const runResults = [];
  for (const test of tests) {
    const results = await test.run(creds);
    for (const result of results) runResults.push({ testKey: test.key, title: test.title, severity: test.severityDefault, ...result });
  }
  return runResults;
}
```
Register in `registry.js`. Write/extend the registry test to assert `getConnector("carbonite")` resolves and exposes the contract shape.

---

### Task 6: `carbonite/setup-info` route

**Files:** Modify `api/src/routes/integrations.js`; Test: extend `integrations.test.js`

Follows the Azure/Commvault static pattern (no live principal resolution — Carbonite has no AWS-STS-ARN equivalent): `GET /carbonite/setup-info` returns instructions for generating a read-only-scoped API key from the Core Endpoint Backup dashboard's Key Management page, plus the `dashboardHost` config field the admin needs to supply (confirm the exact self-service instructions once Task 0 confirms the real hostname pattern).

---

### Task 7: `collectionRunner` cross-connector regression coverage (fourth, SOAP-shaped connector)

**Files:** Modify `api/src/__tests__/integration/collectionRunner.test.js`

Add a `carbonite` fixture alongside the existing `aws`/`azure`/`commvault` fixtures, proving `runCollection` behaves identically for a connector whose `runTests()` internally does SOAP/XML rather than JSON — since `collectionRunner.js` only depends on the returned `{testKey, title, severity, resourceId, status, message, evidencePayload}` array shape, this should require zero changes to `collectionRunner.js` itself, same as the Commvault addition.

---

### Task 8: Full backend suite verification

Run: `cd api && npm test && npm run test:integration`. Expected: all green, including the new Carbonite unit/integration tests, with the optional live-shape test skipped (no env vars set) unless Task 0 was executed against a real tenant.

---

## Self-Review Notes

- **This plan's biggest risk is Task 0, not the code.** Every field name, enum value, and envelope detail beyond the handful of directly-quoted doc excerpts above is unconfirmed. Do not let an implementer skip straight to Tasks 2–4 without running Task 0 against a real tenant — the defensive `"error"`-status coding throughout is a safety net, not a substitute for verification.
- **SOAP-over-`fetch` is a genuinely new pattern for this codebase** — no other connector or any existing `api/src/` code builds/parses SOAP XML. Budget extra review time for `soapClient.js` specifically; consider whether a minimal SOAP dependency is actually cheaper than hand-rolled XML once Task 0's WSDL inspection reveals real complexity.
- **The "device coverage" scale caveat (Task 0 item 6) could block this connector for any tenant with >100 devices** — this is a real product limitation in Carbonite's own docs, not a Prism implementation gap. If Task 0 can't find a paging mechanism, this needs to be surfaced to the customer as a known limitation, not silently under-reported.
- **Legal-hold read check may not be buildable at all** — flagged as conditional in Task 1's schema seed. Don't seed the test/mapping rows until Task 0 confirms the field exists.
- Whoever picks up this plan should re-confirm which physical Carbonite product the target customer runs (Core Endpoint Backup vs. Server Backup) before starting — see "Critical finding" section above.

### Critical Files for Implementation
- `api/src/connectors/azure/index.js`, `api/src/connectors/azure/credentials.js` — closest existing pattern to mirror for `index.js`/`credentials.js` shape
- `api/src/connectors/commvault/` (if present in this checkout) — closest existing pattern for a non-SDK, `fetch`-based connector and its Task-0-style verification approach
- `api/src/utils/collectionRunner.js` — the generic contract every connector must satisfy; read before writing `runTests()`
- `api/src/connectors/registry.js` — registration point
- `api/src/routes/integrations.js` — `setup-info` route pattern (Azure's static block specifically)
- `api/src/db/integrationCredentials.js` — confirms credential storage is opaque JSON in/out, no schema impact from SOAP-specific secret shape
- `init.sql` — "Automated Evidence Collection" section, existing aws/azure/commvault seed blocks to mirror exactly
