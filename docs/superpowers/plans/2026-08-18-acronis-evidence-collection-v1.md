# Acronis Cyber Protect Cloud Integration — Implementation Plan

## Context

Prism already ships two evidence-collection connectors (AWS, Azure) built against a generic `collectionRunner` contract: a connector exposes `key`, `tests`, `testConnection()`, and `runTests()`, and the runner handles everything provider-agnostic (persisting runs, evidence, findings, ISO-control mapping). The user wants a third connector for **Acronis Cyber Protect Cloud** — the backup/anti-malware/vulnerability-management platform — so that a company's Acronis tenant can be connected the same way AWS/Azure accounts are, and automated evidence gets collected against ISO 27001 controls for backup (A.8.13), malware protection (A.8.7), vulnerability/patch management (A.8.8), and security monitoring (A.8.16) — confirmed as the v1 scope with the user. The tenant model is single-tenant, matching AWS/Azure: one Prism company connects to one Acronis Cyber Protect Cloud tenant it owns.

This plan is backend- and frontend-complete (Acronis has no live product to build against yet, so this is design-only per the user's request — **do not implement**).

### Acronis API facts gathered (via context7 / developer.acronis.com)

- **Auth**: OAuth2 client-credentials grant. `POST {datacenterUrl}/api/2/idp/token` with `Authorization: Basic base64(client_id:client_secret)` and `grant_type=client_credentials` → `{access_token, expires_on, token_type: "bearer"}`. There is no Prism-side dynamic discovery of `datacenterUrl` — it's tenant-specific (e.g. `https://us5-cloud.acronis.com`) and the customer must supply it, same as Azure's Tenant/Subscription ID.
- **No official Node.js SDK** exists for Acronis Cyber Protect Cloud (context7 only surfaced Python examples and an unrelated Go CTI tool). Unlike AWS (`@aws-sdk/*`) and Azure (`@azure/*`), the Acronis connector must talk to the REST API directly via `fetch`, including manual bearer-token handling and manual pagination — there's no SDK to lean on for retries/paging.
- **Identity check** (Acronis's analog of AWS STS `GetCallerIdentity` / Azure `resourceGroups.list()`): `GET {datacenterUrl}/api/2/clients/{client_id}` (bearer auth) → `{tenant_id, ...}`. Good `testConnection()` candidate — cheap, read-only, confirms the token works and yields an `externalAccountId`.
- **Backup/protection status**: `GET {datacenterUrl}/api/resource_management/v4/resource_statuses?type=resource.machine&include_attributes=true` → array of `{resourceId, protectionPlanName, protectionStatus, lastSuccessfulBackup.dateTime, lastSuccessfulAntimalwareScan.dateTime, cyberfitScore}`. Not documented as cursor-paginated in the surfaced docs, but treat as potentially paginated defensively (see Task 3).
- **Alerts**: `GET {datacenterUrl}/api/alert_manager/v1/alerts?severity=...` → `{items: [{id, type, category, details, severity, createdAt, tenant}], paging: {cursors: {...}}}`. This one **is** cursor-paginated (`paging.cursors`) — needs an explicit page-loop, unlike AWS/Azure SDK calls which auto-paginate.
- **Vulnerability assessment / patch management**: exposed as resource *policies* (`policy.security.vulnerability_assessment`, `policy.security.patch_management`) via the resource-policy API, not a simple status flag — assignment/enablement must be checked per-resource-group via the policy-management endpoints. This is the least-documented corner from the surfaced context7 docs; flagged as a research spike in Task 4 rather than assumed API shapes.
- **API client creation**: done in the Acronis management console (Settings → API clients), or via `POST /api/2/clients` (itself requires an authenticated admin session) — there is no simple, static least-privilege "policy JSON" like AWS/Azure; Acronis's model is coarse built-in roles (e.g. "Read-only administrator"). The `/acronis/setup-info` endpoint should therefore be a **static instructional walkthrough** (console steps + role choice + where to find the datacenter URL), not a dynamically computed policy document.

---

## Backend

### New connector module: `api/src/connectors/acronis/`

Mirrors `api/src/connectors/azure/` exactly in shape (per `collectionRunner`'s contract — verified generic by `collectionRunner.test.js`'s "two differently-shaped connectors" test, so `collectionRunner.js` itself needs **zero changes**):

```
api/src/connectors/acronis/
├── index.js         — key="acronis", tests=[...], testConnection(), runTests()
├── client.js         — thin internal REST client: token fetch/cache, fetch wrapper, cursor-pagination helper
├── credentials.js    — resolveAcronisCredentials({authType, config, secret}) -> {datacenterUrl, clientId, clientSecret}
└── tests/
    ├── backup.js      — A.8.13 checks
    ├── malware.js     — A.8.7 checks
    ├── vulnerability.js — A.8.8 checks
    └── monitoring.js  — A.8.16 checks
```

**`credentials.js`**: only `authType === "oauth2"` supported (matches Azure's `credentials.js` pattern — one authType, throws on anything else). Validates `config.datacenterUrl` and `secret.clientId`/`secret.clientSecret` are present; returns them as-is (no live call here — token exchange happens in `client.js`, since it needs to be fetched fresh per collection run, not per credential-resolve call).

**`client.js`** (new pattern not needed by AWS/Azure since they use SDKs — this is Acronis-specific infrastructure):
- `getToken({datacenterUrl, clientId, clientSecret})` — POSTs `/api/2/idp/token`, returns bearer token, called once per `runTests()`/`testConnection()` invocation (a single collection run is short-lived enough that mid-run expiry isn't a concern — no refresh logic needed, keep this simple).
- `acronisFetch(datacenterUrl, token, path, params)` — wraps `fetch` with the bearer header and JSON parsing; throws with the response status/body on non-2xx (mirrors how AWS/Azure SDK clients throw on API errors, so `runTests`'s per-test try/catch — see below — behaves consistently).
- `fetchAllPages(datacenterUrl, token, path, params)` — loops on `paging.cursors.next` (or equivalent) for the alerts endpoint's cursor pagination; used by `malware.js`/`monitoring.js`'s alert-fetching checks. `resource_statuses` is fetched with a single call unless the research spike in Task 4 finds it's paginated too.
- Basic retry-once-on-429/5xx with a short backoff — since there's no SDK providing this for free the way AWS/Azure's SDKs do, and Acronis's API is subject to standard rate limits.

**`index.js`**: `buildClient(credentials)` returns `{datacenterUrl, token}` (fetched once via `client.js#getToken`) passed to every test's `run()`. `testConnection` calls `GET /api/2/clients/{clientId}`, returns `{ok: true, externalAccountId: tenant_id}`. `runTests` follows the exact AWS/Azure glue-loop pattern already established (see `azure/index.js`): resolve credentials → get token once → for each test in `tests`, call `test.run(client)`, merge in `testKey`/`title`/`severity` from the descriptor.

### Checks (test descriptors), one file per ISO domain

| File | `key` | Title | Severity | ISO ref | Logic |
|---|---|---|---|---|---|
| `backup.js` | `acronis.backup.protection_enabled` | Workload has an assigned protection plan | high | A.8.13 | For each `resource.machine` from `resource_statuses`, fail if `protectionStatus !== "Protected"` (resourceId = Acronis resource id) |
| `backup.js` | `acronis.backup.recent_successful_backup` | Backup completed within the expected window | high | A.8.13 | Fail if `lastSuccessfulBackup.dateTime` is missing or older than a threshold (propose 7 days, configurable constant) |
| `malware.js` | `acronis.malware.scan_up_to_date` | Anti-malware scan completed within the expected window | medium | A.8.7 | Fail if `lastSuccessfulAntimalwareScan.dateTime` missing/stale, from the same `resource_statuses` payload |
| `malware.js` | `acronis.malware.no_open_detections` | No unresolved malware/ransomware alerts | critical | A.8.7 | `fetchAllPages` the alerts endpoint filtered to malware/ransomware `category`/`type`, fail per open (non-dismissed) alert |
| `vulnerability.js` | `acronis.vulnerability.assessment_enabled` | Vulnerability assessment policy is assigned | high | A.8.8 | Per Task 4's research spike — check policy assignment for each protected resource/resource group |
| `vulnerability.js` | `acronis.vulnerability.patch_management_enabled` | Patch management policy is assigned | medium | A.8.8 | Same policy-assignment check, `policy.security.patch_management` |
| `monitoring.js` | `acronis.monitoring.no_open_critical_alerts` | No unresolved critical/error alerts | high | A.8.16 | `fetchAllPages` alerts filtered `severity=critical` (and `error`), fail per open alert not already covered by the malware-specific check above (exclude alert `category === "protection"`/malware types to avoid double-counting with `no_open_detections`) |

This is 7 checks across 4 files — comparable in scope to AWS's 7 checks, broader than Azure's 4, matching the "comprehensive" v1 the user confirmed.

**Task 4 (research spike, explicitly flagged, not assumed)**: the vulnerability/patch checks depend on the resource-policy API's exact shape for reading (not just writing) policy assignment per resource — the context7 docs surfaced policy *configuration* JSON (how to author a policy) but not a clean "list policies assigned to resource X" read endpoint. Before writing `vulnerability.js`, pull `developer.acronis.com`'s resource-policy *read/list* endpoints via context7 or the live API explorer once real Acronis tenant access is available. If no clean read API exists, the fallback is to treat vulnerability/patch evidence via the **alerts API** instead (open "vulnerability found"/"patch missing" alert types), consistent with how `malware.js` and `monitoring.js` already work — this keeps all 4 domains on one consistent data-fetching pattern (resource_statuses + alerts) if the policy-read API proves impractical.

### Registry, routes, seed data

- **`api/src/connectors/registry.js`**: add `import * as acronis from "./acronis/index.js";` and one entry in the `connectors` map, exactly like the existing `{ aws, azure }` object.
- **`api/src/routes/integrations.js`**: add `GET /acronis/setup-info` (ADMIN/LEAD, same role guard as the other two) returning a static instructional payload — console steps to create an API client, the recommended built-in role ("Read-only administrator" or the most restrictive available), and a reminder to copy the tenant's datacenter URL from the browser address bar while logged into the Cyber Protect console. No dynamic computation needed (no Prism-side identity to expose, unlike AWS's STS-derived principal ARN).
- **`init.sql`**: append a seed block after the existing Azure block, following the exact established template —
  ```sql
  INSERT INTO integrations (key, name, category, auth_type, status) VALUES
    ('acronis', 'Acronis Cyber Protect Cloud', 'backup', 'oauth2', 'active')
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO automated_tests (integration_key, test_key, title, severity_default) VALUES
    ('acronis', 'acronis.backup.protection_enabled', 'Workload has an assigned protection plan', 'high'),
    ('acronis', 'acronis.backup.recent_successful_backup', 'Backup completed within the expected window', 'high'),
    ('acronis', 'acronis.malware.scan_up_to_date', 'Anti-malware scan completed within the expected window', 'medium'),
    ('acronis', 'acronis.malware.no_open_detections', 'No unresolved malware/ransomware alerts', 'critical'),
    ('acronis', 'acronis.vulnerability.assessment_enabled', 'Vulnerability assessment policy is assigned', 'high'),
    ('acronis', 'acronis.vulnerability.patch_management_enabled', 'Patch management policy is assigned', 'medium'),
    ('acronis', 'acronis.monitoring.no_open_critical_alerts', 'No unresolved critical/error alerts', 'high')
  ON CONFLICT (test_key) DO NOTHING;

  INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
    ('acronis.backup.protection_enabled', 'A.8.13'),
    ('acronis.backup.recent_successful_backup', 'A.8.13'),
    ('acronis.malware.scan_up_to_date', 'A.8.7'),
    ('acronis.malware.no_open_detections', 'A.8.7'),
    ('acronis.vulnerability.assessment_enabled', 'A.8.8'),
    ('acronis.vulnerability.patch_management_enabled', 'A.8.8'),
    ('acronis.monitoring.no_open_critical_alerts', 'A.8.16')
  ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
  ```
- No migration needed for `integration_credentials`/`integrations.auth_type` — `oauth2` is already in the CHECK constraint (used by Azure).

### Backend tests to add (mirroring the existing per-connector suite)

- `connectorsRegistry.test.js` — extend to assert `getConnector("acronis")` shape.
- `connectorsAcronisCredentials.test.js` — `resolveAcronisCredentials` happy path + unsupported-authType throw.
- `connectorsAcronisClient.test.js` — token fetch, `acronisFetch` error handling, `fetchAllPages` cursor loop (mock `fetch` global).
- `connectorsAcronisIndex.test.js` — `testConnection`/`runTests` glue, mocked HTTP layer.
- `connectorsAcronisBackup.test.js`, `connectorsAcronisMalware.test.js`, `connectorsAcronisVulnerability.test.js`, `connectorsAcronisMonitoring.test.js` — one per check file, pass/fail fixtures per check.
- `integration/collectionRunner.test.js` — extend the "generic across differently-shaped connectors" test to include Acronis as a third shape (proves `runCollection` needed no changes).
- `integration/integrations.test.js` — add `GET /api/integrations/acronis/setup-info` role-gating tests, plus create/credentials/run/revoke flow using `integration_key = 'acronis'`.

---

## Frontend

The explore agent's key finding: the wizard/rotate-modal branching is currently **authType-keyed**, not provider-keyed (`authType === "oauth2"` → always render `AzureServicePrincipalWalkthrough` and build `{tenantId, subscriptionId}` config). Since Acronis will also use `authType: "oauth2"` but needs a *different* config shape (`{datacenterUrl}` instead of `{tenantId, subscriptionId}`), adding Acronis **forces a refactor from authType-keyed to provider-keyed branching** at every one of these call sites — this isn't optional polish, it's required correctness for a second `oauth2` provider to coexist with Azure. Concretely, in both `IntegrationsSettings.jsx` and `ConnectionDetail.jsx`:

- The walkthrough-selection ternary (`authType === "iam_role" ? (...) : authType === "oauth2" ? <AzureServicePrincipalWalkthrough/> : (...)`) becomes a nested check on `provider.key` inside the `oauth2` branch: `authType === "oauth2" ? (provider.key === "azure" ? <AzureServicePrincipalWalkthrough/> : provider.key === "acronis" ? <AcronisWalkthrough/> : <CredentialFields authType="oauth2" .../>) : ...`.
- `handleSubmit`'s `config` construction becomes provider-keyed: `provider.key === "azure" ? {tenantId, subscriptionId} : provider.key === "acronis" ? {datacenterUrl} : authType === "iam_role" ? {region, roleArn} : {region}`. `secret` stays authType-keyed since both Azure and Acronis submit the identical `{clientId, clientSecret}` shape via `CredentialFields`'s existing `oauth2` case — no changes needed there.
- Same provider-keyed split applies to `RotateCredentialModal`'s `secret`/render logic in `ConnectionDetail.jsx` (secret stays `{clientId, clientSecret}`, shared).

**`CredentialFields.jsx` needs no new branch** — Acronis's `oauth2` secret shape (`clientId`/`clientSecret`) is identical to Azure's, so the existing `authType === "oauth2"` case is reused as-is. This is a direct consequence of choosing to model Acronis's auth as `oauth2` rather than introducing a new `api_key` authType (the DB CHECK constraint already allows `api_key` too, but reusing `oauth2` avoids a second, needlessly-different frontend field set for what is functionally the same client-credentials grant).

### New/changed pieces

- **`AcronisWalkthrough` component** (new, in `IntegrationsSettings.jsx`, alongside `AwsRoleWalkthrough`/`AzureServicePrincipalWalkthrough`): fetches `/api/integrations/acronis/setup-info`, renders the static console-steps instructions plus a `Data center URL` config-level input field (analogous to Azure's Tenant ID/Subscription ID inputs embedded in its walkthrough) — no live JSON policy block to render, since Acronis has no equivalent to AWS's trust-policy/Azure's role-definition JSON.
- **Region field gating**: currently `provider.key !== "azure"` (a growing exclusion list — every new non-AWS provider requires editing this line). Recommend flipping to a positive allowlist, `provider.key === "aws"`, while adding Acronis — this is the correct fix regardless of Acronis, and Acronis is what surfaces the smell, so bundle it into this work rather than deferring.
- **`PROVIDER_ICON.acronis`** entry — `react-icons/fa` (`FaAws`/`FaMicrosoft`'s source) doesn't have an Acronis mark; check `react-icons/si` (Simple Icons) for `SiAcronis` once `node_modules` is available to grep (unverifiable from this checkout, same disclosed uncertainty as the Azure plan's icon choice) — fall back to the existing generic-text-label rendering (already handles any provider with no `PROVIDER_ICON` entry, so this is a non-blocking, independently-landable task either way).

### Frontend tests to add

Mirror `web/tests/integrations.spec.js` / `connection-detail.spec.js`'s existing Azure coverage pattern (catalog fixture + `page.route` mocks for `/catalog`, `/acronis/setup-info`, connection create/credentials/rotate):
- Catalog card renders with Acronis branding.
- Wizard shows the `AcronisWalkthrough` (datacenter URL field) + shared `CredentialFields` (Client ID/Client secret) for `authType="oauth2"` + `provider.key="acronis"`, and does **not** show Tenant ID/Subscription ID (proves the provider-keyed split works, not just an authType coincidence — this is the test that would have caught a naive authType-only refactor).
- Submitting sends `config: {datacenterUrl}` / `secret: {clientId, clientSecret}`.
- Rotate-credentials modal for an existing Acronis connection submits `{clientId, clientSecret}` only (no config resubmission), matching Azure's rotate behavior.
- Region field absent for Acronis (and confirm still absent for Azure, still present for AWS — regression coverage for the allowlist flip).

---

## Verification (once implementation actually happens — not part of this planning task)

1. `cd api && npm test` — unit tests for the new connector modules (no DB).
2. `cd api && npm run test:integration` — registry/routes/collectionRunner integration coverage against real Postgres.
3. `cd web && npx playwright test tests/integrations.spec.js tests/connection-detail.spec.js` — new Acronis wizard/rotate coverage, then `npx playwright test` (full suite) for regression on the provider-keyed refactor.
4. Manual smoke test against a real (or sandbox) Acronis Cyber Protect Cloud tenant once credentials are available: create a connection through the UI, verify `testConnection` succeeds and reports the correct tenant ID, run a manual collection, confirm evidence/findings rows appear correctly split across the 4 ISO domains.
5. `git status --short` clean check per the repo's own plan-completion convention.

## Open risks carried into implementation

- Vulnerability/patch-management read-API shape is unconfirmed (Task 4 spike) — may require falling back to alerts-based detection instead of policy-assignment introspection.
- No official Acronis Node SDK — the hand-rolled `client.js` (token handling, pagination, retry) is new surface area AWS/Azure's connectors didn't need; keep it minimal and test it directly (`connectorsAcronisClient.test.js`) since nothing upstream will catch its bugs.
- Acronis icon availability in `react-icons` is unverified from this checkout.
