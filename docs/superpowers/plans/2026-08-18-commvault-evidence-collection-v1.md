# Commvault Evidence Collection (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Commvault as a third evidence-collection connector alongside AWS and Azure — 4 Tier-1 read-only checks (backup SLA compliance, storage-policy-copy WORM/compliance lock, storage-policy-copy encryption, backup-failure alert configured), authenticated via a customer-generated Custom-scope Access Token (`api_key` auth), proving the connector architecture generalizes to a provider with **no vendor Node.js SDK** — a genuinely different structural shape from both AWS (`@aws-sdk/*` clients) and Azure (`@azure/arm-*` clients + `TokenCredential`).

**Architecture:** Mirrors `api/src/connectors/aws/` and `api/src/connectors/azure/` at the module-contract level exactly — `key`, `tests`, `testConnection`, `runTests`, registered in `connectors/registry.js`, zero changes to `collectionRunner.js` (already proven provider-agnostic across two structurally different connectors — see `api/src/__tests__/integration/collectionRunner.test.js`, which already fixture-tests both `aws` and `azure` shapes side by side). The genuine structural difference this plan introduces: `commvault/credentials.js` resolves into a plain **request-helper object** (`{ apiRoot, request(path, opts) }` wrapping Node's built-in `fetch` with the `Authtoken` header pre-attached) rather than an SDK client instance or class — because Commvault has no official Node SDK (`cvpysdk` is Python-only). `buildClients` in `commvault/index.js` is therefore trivial (`{ commvault: requestHelper }`), unlike AWS/Azure's multi-client `buildClients`.

**Tech Stack:** No new npm dependencies. Uses Node's built-in global `fetch` (confirmed available in this repo's runtime — Node v26 — and already used elsewhere in the codebase, e.g. `api/src/utils/azureOpenAI.js`, albeit inconsistently declared there; this plan does not add a `node-fetch`/`axios`/`undici` dependency since none is required).

**Spec:** This plan's requirements come directly from fixed design decisions made in plan-mode discussion (auth strategy, the exact 4 Tier-1 checks, ISO mappings, and the "thin REST client, not an SDK" structural requirement) — there is no separate approved plan-mode design doc to cite, unlike the Azure plan's reference to its own design doc. Anywhere this plan states a Commvault REST endpoint path or JSON field name, it is one of two things: (a) **confirmed** — verified against Commvault's own `cvpysdk` SDK source/docs during planning research (via Context7, `/commvault/cvpysdk`), cited inline; or (b) **best-effort/unconfirmed** — flagged explicitly with a `// TODO CONFIRM` comment and folded into Task 0 below. Nothing in this plan hides that uncertainty.

## Global Constraints

- Every query touching tenant data must filter on `company_id = req.user.companyId` — this plan adds no new tenant-scoped routes beyond the existing `POST /:id/credentials`/`POST /:id/run` pattern already enforcing this; the one new route (`GET /commvault/setup-info`) returns a static, non-tenant-scoped access-token setup payload, matching `GET /azure/setup-info`'s exact pattern (no live call, no "assumable role"/trust-policy concept applies to Commvault either — the customer generates the token entirely on their own CommCell).
- No BullMQ/queue, no scheduling — this plan is backend-only, manual-trigger evidence collection, exactly like AWS and Azure.
- Credentials never appear in API responses, every credential touch is audit-logged — already enforced generically by `routes/integrations.js`'s existing `POST /:id/credentials` handler; this plan adds no new credential-touching route. The credential itself (`secret.accessToken`) is a single opaque string, simpler than AWS's 2-3-field secret or Azure's Service-Principal secret — still stored the same way, through `storeCredential`, never touched directly by connector code.
- `status` on every `evidence_test_results` row must be one of `'pass'|'fail'|'warn'|'error'|'not_applicable'` (DB CHECK constraint, `init.sql`) — every Commvault check's `run()` function is bound by this exactly like AWS/Azure's. **Deviation this plan makes deliberately, and explains why:** because 3 of the 4 checks' underlying field names are unconfirmed (see Task 0), each check function is written defensively — if a required field is genuinely absent from a live response, the check returns `status: "error"` (a value the schema already supports) with a message pointing back at Task 0, rather than either (a) crashing the whole `runTests` call, or (b) silently defaulting to `pass`/`fail` on a guess. This is new discipline specific to Commvault's uncertainty, not a change to AWS/Azure's existing behavior.
- Real Commvault REST API surface only where confirmed; every unconfirmed endpoint/field is marked `// TODO CONFIRM` in the code sketches below and listed again in Task 0's checklist — this plan does not present inferred field names as verified fact.
- No new npm dependency for HTTP: Node's built-in global `fetch` is used, not a new SDK/HTTP-client package — see Tech Stack.
- Out of scope for this plan (matching the Azure backend plan's scope, which had a *separate* frontend plan file): any frontend/UI work — connection wizard copy, catalog icon, category grouping. This is backend-connector-only.

---

## File Structure

- Modify: `init.sql` — one `integrations` seed row (`key = 'commvault'`, `auth_type = 'api_key'`), four `automated_tests` seed rows, four `test_control_mappings` seed rows
- Modify: `api/package.json` — no new runtime dependency; optionally add `"engines": { "node": ">=18" }` if not already present, since this connector's only new technical requirement is a `fetch` global (see Task 1)
- Create: `api/src/connectors/commvault/credentials.js` — `resolveCommvaultCredentials({authType, config, secret}) => Promise<{apiRoot, request}>`
- Create: `api/src/connectors/commvault/tests/backup.js` — SLA compliance check
- Create: `api/src/connectors/commvault/tests/storage.js` — WORM lock + encryption checks
- Create: `api/src/connectors/commvault/tests/monitoring.js` — alerts-configured check
- Create: `api/src/connectors/commvault/index.js` — `key`, `tests`, `testConnection`, `runTests`
- Modify: `api/src/connectors/registry.js` — register the commvault connector
- Modify: `api/src/routes/integrations.js` — `COMMVAULT_ACCESS_TOKEN_SETUP` const + `GET /commvault/setup-info`
- Create: `api/src/__tests__/connectorsCommvaultCredentials.test.js`
- Create: `api/src/__tests__/connectorsCommvaultBackup.test.js`
- Create: `api/src/__tests__/connectorsCommvaultStorage.test.js`
- Create: `api/src/__tests__/connectorsCommvaultMonitoring.test.js`
- Create: `api/src/__tests__/connectorsCommvaultIndex.test.js`
- Create: `api/src/__tests__/connectorsCommvaultLiveShapes.test.js` — **optional, env-gated, skipped in normal CI** — a live-CommCell smoke test an implementer runs once against a real/trial CommCell to validate every `// TODO CONFIRM` assumption in this plan (see Task 0)
- Modify: `api/src/__tests__/connectorsRegistry.test.js` — add commvault coverage (mirrors the azure addition already present)
- Modify: `api/src/__tests__/integration/schema.evidenceCollection.test.js` — Task 1's seed coverage
- Modify: `api/src/__tests__/integration/collectionRunner.test.js` — extend the existing `aws`/`azure` fixture map with a third, non-SDK-shaped `commvault` fixture, proving genericity holds for this structurally different connector too
- Modify: `api/src/__tests__/integration/integrations.test.js` — `GET /commvault/setup-info` coverage

---

### Task 0: Verify live Commvault REST API shapes (prerequisite — do this before Tasks 3–5's code is trusted)

**Files:**
- Create (optional, env-gated): `api/src/__tests__/connectorsCommvaultLiveShapes.test.js`
- No production code in this task — this is a research/verification gate, not a feature.

**Why this task exists:** Unlike AWS and Azure (versioned, typed SDKs), Commvault has **no stable public OpenAPI spec** and no Node SDK at all. Every endpoint path and field name below was researched via Commvault's own `cvpysdk` project (Python SDK source + generated docs, queried through Context7's `/commvault/cvpysdk`), which is the best available proxy for the REST surface — but `cvpysdk` documents *its own* call sites, not a general reference, so several gaps remain. Do not skip this task.

**Confirmed during planning research (cite these, do not re-verify):**
- `POST /accessTokens` with `{ tokenName, tokenType: 3, apiEndpoints: [...] }` creates a Custom-scope token; response is `{ tokenInfo: { accessToken, accessTokenId, tokenName, userId, ... } }`. (`cvpysdk/security/user.html`)
- Every subsequent REST call authenticates via an `Authtoken: <token>` request header (confirmed pattern across `cvpysdk`'s `make_request`/`commcell.html` — this is the same header used for QSDK/SAML login tokens and pre-generated access tokens alike).
- `GET /Alerts` returns `{ alertList: [{ alert: { name, id }, alertCategory: { name }, description, organizationId, ... }] }`. (`cvpysdk/alert.html` — `all_alerts` reads exactly this shape.)
- Storage policy copy WORM/compliance-lock field is `copyFlags.wormCopy` (`1` = enabled, `0`/absent = disabled) — confirmed by `StoragePoolCopy.is_compliance_lock_enabled`'s own implementation, which reads `storagePoolDetails.copyInfo.copyFlags.wormCopy == 1`. Note this exact envelope path is for **storage pools**, not storage policies — the field name (`copyFlags.wormCopy`) is confirmed, but this connector's checks target *storage policy copies* (per the fixed requirements), whose enclosing envelope is one of Task 0's open items below.
- `GET /ADDASHBOARD?slaNumberOfDays=1` (a confirmed, but Active-Directory-*specific*, dashboard endpoint) returns `{ agentSummary: [...], solutionSummary: { slaSummary: { totalEntities, ... } } }` — confirming the **field-name shape** `solutionSummary.slaSummary.{totalEntities, ...}` is real and used elsewhere in Commvault's dashboard family, even though this exact endpoint is the wrong one for a CommCell-wide (not AD-specific) SLA summary.

**Open items — MUST be confirmed against a live CommCell's Swagger UI (`https://<webconsole>/webconsole/api/swagger/index.html`) before Tasks 3–5's code ships to production, even though this plan provides best-effort, defensively-coded placeholders for all of them:**

1. **SLA dashboard endpoint** (`commvault/tests/backup.js`) — the CommCell-wide "Backup Health" SLA summary (as opposed to the AD-specific one above) is served by an unconfirmed path. Placeholder used in this plan: `GET /dashboard?slaNumberOfDays=1`. Confirm the real path and confirm the response envelope really is `solutionSummary.slaSummary.{totalEntities, slaNotMetEntities, neverBackedupEntities}` for the all-entities case (not just the AD case).
2. **Storage policy list endpoint** (`commvault/tests/storage.js`) — placeholder used: `GET /StoragePolicy`, expected response `{ policies: [{ storagePolicyName, storagePolicyId }] }`. Note: research surfaced a *related but distinct* confirmed endpoint, `GET /API/v1/StoragePools`, returning a `{ poolName: poolId }` dictionary, not an array — this is strong evidence Commvault's REST path casing/envelope conventions are inconsistent across resource types, so do not assume `/StoragePolicy`'s shape mirrors `/API/v1/StoragePools`'s. Confirm both the path and the envelope shape independently.
3. **Storage policy detail (advanced) endpoint** — placeholder used: `GET /v2/StoragePolicy/{storagePolicyId}?propertyLevel=10`. Confirm the response envelope key holding the array of copies — this plan guesses `storagePolicyCopy` but this was not directly confirmed for this specific endpoint.
4. **Encryption-enabled field** — no confirmed field for "is encryption enabled on this copy" was found anywhere in indexed `cvpysdk` docs. The only encryption-adjacent field found, `copyFlags.preserveEncryptionModeAsInSource`, is a *mode-preservation* flag for aux copies (irrelevant to "is encryption on"), not the field this check needs. `commvault/tests/storage.js`'s `checkEncryptionEnabled` therefore checks a list of *candidate* field names and returns `status: "error"` (not a guessed pass/fail) if none is present.
5. **Alert job-failure taxonomy** — `GET /Alerts`'s shape is confirmed, but Commvault's out-of-the-box `alertCategory.name` values were not confirmed. `commvault/tests/monitoring.js`'s heuristic (category-name keyword match OR description-text keyword match) is a defensible best guess, not a documented taxonomy.

- [ ] **Step 1: Get access to a live or trial CommCell**

Commvault offers a free trial CommCell (commvault.com/free-trial) or use an existing customer's non-production CommCell with permission. You need: the WebConsole base URL, and a user account able to generate a Custom-scope access token (or an existing All-Scope admin token for this verification pass only — do not use an All-Scope token for the actual Prism connection, only for this one-time verification).

- [ ] **Step 2: Generate a temporary broad-scope token for verification only**

```bash
curl -sk -X POST "https://<webconsole>/webconsole/api/Login" \
  -H "Content-Type: application/json" \
  -d '{"username":"<user>","password":"<base64-password>"}' | tee /tmp/cv-login.json
```
Extract `token` from the response — use it as `Authtoken` for the verification calls below. (This `/Login` call is only for this one-time manual verification pass; the actual Prism connector never calls `/Login` — see Task 2.)

- [ ] **Step 3: Verify each open item from the list above**

```bash
TOKEN="<token from step 2>"
BASE="https://<webconsole>/webconsole/api"

# Item 1: SLA dashboard shape
curl -sk -H "Authtoken: $TOKEN" "$BASE/dashboard?slaNumberOfDays=1" | tee /tmp/cv-dashboard.json
# Also try the Swagger UI's search for "dashboard" or "SLA" to find the real
# all-entities endpoint if the above 404s or returns an unrelated shape.

# Item 2 + 3: storage policy list + detail
curl -sk -H "Authtoken: $TOKEN" "$BASE/StoragePolicy" | tee /tmp/cv-storagepolicy-list.json
# Take a storagePolicyId from the above and:
curl -sk -H "Authtoken: $TOKEN" "$BASE/v2/StoragePolicy/<id>?propertyLevel=10" | tee /tmp/cv-storagepolicy-detail.json

# Item 5: real alert category names on this CommCell
curl -sk -H "Authtoken: $TOKEN" "$BASE/Alerts" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sorted({a['alertCategory']['name'] for a in d.get('alertList',[])}))"
```

- [ ] **Step 4: Record confirmed shapes as code comments**

For each of the 5 open items, once confirmed, update the corresponding `// TODO CONFIRM` comment in Tasks 3–5's files to a `// CONFIRMED against <CommCell hostname> on <date>` comment citing the real endpoint/field. If an assumption in this plan was wrong, correct the constant/field-candidate list — the defensive `"error"` fallback paths mean a wrong guess degrades to a visible, explained "error" test result rather than a silently wrong pass/fail, so correcting it later is safe and won't have shipped false compliance evidence in the meantime.

- [ ] **Step 5: (Optional) add the live-shape guard test, env-gated**

Create `api/src/__tests__/connectorsCommvaultLiveShapes.test.js` — a live smoke test, skipped unless real credentials are provided via env vars, so it never blocks normal `npm test`/CI runs but gives a future implementer a one-command way to re-validate all 5 open items at once:

```js
import { describe, test, expect } from "vitest";

const LIVE = Boolean(process.env.COMMVAULT_TEST_WEBCONSOLE_URL && process.env.COMMVAULT_TEST_TOKEN);

describe.skipIf(!LIVE)("Commvault REST API shapes (live CommCell — only runs when COMMVAULT_TEST_WEBCONSOLE_URL/COMMVAULT_TEST_TOKEN are set)", () => {
  const apiRoot = `${process.env.COMMVAULT_TEST_WEBCONSOLE_URL}/webconsole/api`;
  const headers = { Authtoken: process.env.COMMVAULT_TEST_TOKEN, Accept: "application/json" };

  test("GET /Alerts returns the confirmed alertList shape", async () => {
    const res = await fetch(`${apiRoot}/Alerts`, { headers });
    const body = await res.json();
    expect(res.ok).toBe(true);
    expect(Array.isArray(body.alertList)).toBe(true);
  });

  test("GET /StoragePolicy returns a policies array with storagePolicyId", async () => {
    const res = await fetch(`${apiRoot}/StoragePolicy`, { headers });
    const body = await res.json();
    expect(res.ok).toBe(true);
    expect(Array.isArray(body.policies)).toBe(true);
    if (body.policies.length > 0) {
      expect(body.policies[0]).toHaveProperty("storagePolicyId");
    }
  });

  test("GET /v2/StoragePolicy/{id}?propertyLevel=10 exposes copyFlags.wormCopy somewhere in its response", async () => {
    const listRes = await fetch(`${apiRoot}/StoragePolicy`, { headers });
    const { policies } = await listRes.json();
    if (policies.length === 0) return; // nothing to check on this CommCell
    const detailRes = await fetch(`${apiRoot}/v2/StoragePolicy/${policies[0].storagePolicyId}?propertyLevel=10`, { headers });
    const detail = await detailRes.json();
    expect(detailRes.ok).toBe(true);
    const serialized = JSON.stringify(detail);
    expect(serialized).toContain("wormCopy"); // fails loudly if the field name moved
  });
});
```

This task is not a "commit code" step in the usual TDD sense — commit the optional live-shape test file only, with a message noting it is a manual verification tool, not part of the connector's runtime behavior.

- [ ] **Step 6: Commit**

```bash
git add api/src/__tests__/connectorsCommvaultLiveShapes.test.js
git commit -m "test: add optional live-CommCell shape verification for the Commvault connector"
```

---

### Task 1: Schema seed + dependencies

**Files:**
- Modify: `init.sql`
- Modify: `api/package.json` (optional `engines` hygiene only — no new dependency)
- Test: `api/src/__tests__/integration/schema.evidenceCollection.test.js`

**Interfaces:**
- Produces: an `integrations` row with `key = 'commvault'`, `auth_type = 'api_key'`; four `automated_tests` rows keyed `commvault.*`; four `test_control_mappings` rows mapping each to an ISO 27001 reference. These test keys are consumed verbatim by Tasks 3/4/5's `tests` arrays — they must match exactly.

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/schema.evidenceCollection.test.js` (inside its existing top-level `describe` block, alongside the existing aws/azure blocks):

```js
  test("seeds the commvault integration with api_key auth and its 4 Tier-1 automated tests", async () => {
    const integrationResult = await query(`SELECT * FROM integrations WHERE key = 'commvault'`);
    expect(integrationResult.rows.length).toBe(1);
    expect(integrationResult.rows[0].auth_type).toBe("api_key");
    expect(integrationResult.rows[0].status).toBe("active");

    const testsResult = await query(`SELECT test_key, severity_default FROM automated_tests WHERE integration_key = 'commvault' ORDER BY test_key`);
    expect(testsResult.rows).toEqual([
      { test_key: "commvault.backup.sla_compliance", severity_default: "critical" },
      { test_key: "commvault.monitoring.alerts_configured", severity_default: "medium" },
      { test_key: "commvault.storage.encryption_enabled", severity_default: "high" },
      { test_key: "commvault.storage.worm_lock_enabled", severity_default: "high" },
    ]);

    const mappingsResult = await query(`SELECT test_key, iso_reference FROM test_control_mappings WHERE test_key LIKE 'commvault.%' ORDER BY test_key`);
    expect(mappingsResult.rows).toEqual([
      { test_key: "commvault.backup.sla_compliance", iso_reference: "A.12.3.1" },
      { test_key: "commvault.monitoring.alerts_configured", iso_reference: "A.12.4.1" },
      { test_key: "commvault.storage.encryption_enabled", iso_reference: "A.10.1.1" },
      { test_key: "commvault.storage.worm_lock_enabled", iso_reference: "A.18.1.3" },
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- schema.evidenceCollection.test`
Expected: FAIL — no `commvault` row exists in `integrations` yet.

- [ ] **Step 3: Write the implementation**

In `init.sql`, immediately after the existing Azure seed block (the last `INSERT INTO test_control_mappings ... VALUES ('azure.network.nsg_no_open_ingress', 'A.13.1.1') ON CONFLICT ...;` line), append:

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('commvault', 'Commvault', 'backup', 'api_key', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('commvault', 'commvault.backup.sla_compliance', 'Monitored entities meet their backup SLA', 'Checks the CommCell-wide Backup Health SLA summary reports zero entities missing or never backed up.', 'critical', 'Investigate entities missing their backup SLA in Command Center > Reports > Backup Health and remediate failing backup jobs or schedules.'),
  ('commvault', 'commvault.storage.worm_lock_enabled', 'Storage policy copies have WORM/compliance lock enabled', 'Checks every storage policy copy has WORM (Write-Once-Read-Many) / compliance lock enabled, protecting backups from tampering or premature deletion.', 'high', 'Enable compliance lock on each storage policy copy under Storage > Storage Policies > [policy] > Copy Properties.'),
  ('commvault', 'commvault.storage.encryption_enabled', 'Storage policy copies have encryption enabled', 'Checks every storage policy copy has encryption enabled at rest.', 'high', 'Enable encryption on each storage policy copy under Storage > Storage Policies > [policy] > Copy Properties > Advanced.'),
  ('commvault', 'commvault.monitoring.alerts_configured', 'An alert is configured for backup job failures', 'Checks at least one alert is configured to notify on backup job failure.', 'medium', 'Configure a Job Management alert for backup job failures under Alerts > Add Alert in Command Center.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('commvault.backup.sla_compliance', 'A.12.3.1'),
  ('commvault.storage.worm_lock_enabled', 'A.18.1.3'),
  ('commvault.storage.encryption_enabled', 'A.10.1.1'),
  ('commvault.monitoring.alerts_configured', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

Note on the `A.18.1.3` mapping for the WORM check: `A.18.1.3` ("Protection of records") is the chosen control because WORM/compliance-lock protects the *backup records themselves* from tampering, deletion, or loss for their retention period — the same rationale class already used for AWS's S3-public-access and Azure's storage-public-access checks (both mapped to storage-hardening controls), just applied to immutability rather than public exposure.

No new npm dependency is required (see Tech Stack), so there is nothing to `npm install` for this connector. If `api/package.json` has no `engines` field, optionally add:

```json
  "engines": { "node": ">=18" }
```
as a one-line hygiene improvement, since this connector is the first to rely on the built-in global `fetch` rather than a bundled HTTP client — not blocking, just documentation.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- schema.evidenceCollection.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add init.sql api/package.json api/src/__tests__/integration/schema.evidenceCollection.test.js
git commit -m "feat: seed Commvault connector catalog and Tier-1 automated tests"
```

---

### Task 2: Commvault credential resolution (request-helper, not an SDK client)

**Files:**
- Create: `api/src/connectors/commvault/credentials.js`
- Test: `api/src/__tests__/connectorsCommvaultCredentials.test.js`

**Interfaces:**
- Produces: `resolveCommvaultCredentials({authType, config, secret}) => Promise<{apiRoot, request}>`. Unlike `resolveAwsCredentials` (plain credentials bag) and `resolveAzureCredentials` (a `ClientSecretCredential` *instance*), this returns a **request-helper object**: `apiRoot` (the resolved WebConsole API base URL) and `request(path, {method, body})` (a thin `fetch` wrapper that attaches the `Authtoken` header on every call and throws a descriptive error on non-2xx responses). Task 6's `runTests`/`testConnection` pass this object straight through as `clients.commvault`.
- `config.webconsoleUrl` is required (the customer's CommCell WebConsole base URL, e.g. `https://commvault.example.com`); `secret.accessToken` is required (the Custom-scope access token string).

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsCommvaultCredentials.test.js`:

```js
import { describe, test, expect, vi, afterEach } from "vitest";
import { resolveCommvaultCredentials } from "../connectors/commvault/credentials.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveCommvaultCredentials", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveCommvaultCredentials({ authType: "oauth2", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported Commvault auth type: oauth2");
  });

  test("throws when config.webconsoleUrl is missing", async () => {
    await expect(
      resolveCommvaultCredentials({ authType: "api_key", config: {}, secret: { accessToken: "tok" } })
    ).rejects.toThrow("Commvault config.webconsoleUrl is required");
  });

  test("throws when secret.accessToken is missing", async () => {
    await expect(
      resolveCommvaultCredentials({ authType: "api_key", config: { webconsoleUrl: "https://cv.example.com" }, secret: {} })
    ).rejects.toThrow("Commvault secret.accessToken is required");
  });

  test("resolves a request helper that sends the Authtoken header against the webconsole API root, stripping a trailing slash", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ hello: "world" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const commvault = await resolveCommvaultCredentials({
      authType: "api_key",
      config: { webconsoleUrl: "https://cv.example.com/" },
      secret: { accessToken: "tok-123" },
    });

    expect(commvault.apiRoot).toBe("https://cv.example.com/webconsole/api");

    const result = await commvault.request("/Alerts");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cv.example.com/webconsole/api/Alerts",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authtoken: "tok-123" }),
      })
    );
  });

  test("throws a descriptive error, including the path and status, when the API responds with a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "Access denied" })));

    const commvault = await resolveCommvaultCredentials({
      authType: "api_key",
      config: { webconsoleUrl: "https://cv.example.com" },
      secret: { accessToken: "bad-token" },
    });

    await expect(commvault.request("/Alerts")).rejects.toThrow("Commvault API GET /Alerts returned 401");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultCredentials.test.js`
Expected: FAIL — `Cannot find module '../connectors/commvault/credentials.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/commvault/credentials.js`:

```js
export async function resolveCommvaultCredentials({ authType, config, secret }) {
  if (authType !== "api_key") {
    throw new Error(`Unsupported Commvault auth type: ${authType}`);
  }
  if (!config?.webconsoleUrl) {
    throw new Error("Commvault config.webconsoleUrl is required");
  }
  if (!secret?.accessToken) {
    throw new Error("Commvault secret.accessToken is required");
  }

  const apiRoot = `${config.webconsoleUrl.replace(/\/+$/, "")}/webconsole/api`;

  // Commvault's REST API authenticates every request via a flat `Authtoken`
  // header carrying the pre-generated Custom-scope access token — no
  // /Login call, no token exchange, no expiry handling needed here (the
  // token's own scope/expiry, set when the customer generated it, governs
  // access). This is structurally closer to AWS's static access-key
  // credential than Azure's Service-Principal-then-token-exchange flow.
  async function request(path, { method = "GET", body } = {}) {
    const res = await fetch(`${apiRoot}${path}`, {
      method,
      headers: {
        Authtoken: secret.accessToken,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Commvault API ${method} ${path} returned ${res.status}: ${bodyText.slice(0, 500)}`);
    }
    return res.json();
  }

  return { apiRoot, request };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultCredentials.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/commvault/credentials.js api/src/__tests__/connectorsCommvaultCredentials.test.js
git commit -m "feat: add Commvault access-token credential resolution (thin REST client, no SDK)"
```

---

### Task 3: Backup SLA compliance check

**Files:**
- Create: `api/src/connectors/commvault/tests/backup.js`
- Test: `api/src/__tests__/connectorsCommvaultBackup.test.js`

**Interfaces:**
- Produces: `backupTests` (array of `{key, title, severityDefault, isoReferences, run}`), `checkBackupSlaCompliance(commvault)` where `commvault` is `{request}`. `run(clients)` returns `Promise<Array<{resourceId, status, message, evidencePayload}>>`.
- **Uses an unconfirmed endpoint — see Task 0, item 1.** Coded defensively: if the response doesn't match the expected `solutionSummary.slaSummary` shape, returns `status: "error"`, never a guessed pass/fail.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsCommvaultBackup.test.js`:

```js
import { describe, test, expect, vi } from "vitest";
import { checkBackupSlaCompliance } from "../connectors/commvault/tests/backup.js";

function fakeClient(response) {
  return { request: vi.fn(async () => response) };
}

describe("checkBackupSlaCompliance", () => {
  test("passes when no entities are missing or never backed up", async () => {
    const commvault = fakeClient({ solutionSummary: { slaSummary: { totalEntities: 42, slaNotMetEntities: 0, neverBackedupEntities: 0 } } });
    const results = await checkBackupSlaCompliance(commvault);
    expect(results).toEqual([{
      resourceId: "commcell",
      status: "pass",
      message: "All 42 monitored entities meet their backup SLA",
      evidencePayload: { totalEntities: 42, slaNotMetEntities: 0, neverBackedupEntities: 0 },
    }]);
  });

  test("fails when entities are missing SLA or never backed up, and sums both counts in the message", async () => {
    const commvault = fakeClient({ solutionSummary: { slaSummary: { totalEntities: 42, slaNotMetEntities: 3, neverBackedupEntities: 1 } } });
    const results = await checkBackupSlaCompliance(commvault);
    expect(results[0].status).toBe("fail");
    expect(results[0].message).toBe("4 of 42 monitored entities are missing their backup SLA");
  });

  test("returns an 'error' result — not a silently-wrong pass/fail — when the response shape doesn't match what this check expects", async () => {
    const commvault = fakeClient({ someUnexpectedShape: true });
    const results = await checkBackupSlaCompliance(commvault);
    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/reconfirmed/);
    expect(results[0].evidencePayload.rawResponseKeys).toEqual(["someUnexpectedShape"]);
  });

  test("requests the SLA dashboard endpoint currently assumed by this connector", async () => {
    const commvault = fakeClient({ solutionSummary: { slaSummary: { totalEntities: 1, slaNotMetEntities: 0, neverBackedupEntities: 0 } } });
    await checkBackupSlaCompliance(commvault);
    expect(commvault.request).toHaveBeenCalledWith("/dashboard?slaNumberOfDays=1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultBackup.test.js`
Expected: FAIL — `Cannot find module '../connectors/commvault/tests/backup.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/commvault/tests/backup.js`:

```js
// UNCONFIRMED (see plan Task 0, item 1): the CommCell-wide "Backup Health"
// SLA summary's real REST path was not confirmed during planning — only the
// Active-Directory-specific ADDASHBOARD endpoint's shape
// (solutionSummary.slaSummary.{totalEntities,...}) was confirmed via
// cvpysdk's dashboard/ad_dashboard.html, which is the basis for this guess.
// Confirm against a live CommCell's Swagger UI before treating this
// connector as production-ready; update this constant if wrong.
const SLA_DASHBOARD_ENDPOINT = "/dashboard?slaNumberOfDays=1"; // TODO CONFIRM

export async function checkBackupSlaCompliance(commvault) {
  const response = await commvault.request(SLA_DASHBOARD_ENDPOINT);
  const slaSummary = response?.solutionSummary?.slaSummary;

  if (!slaSummary || typeof slaSummary.totalEntities !== "number") {
    return [{
      resourceId: "commcell",
      status: "error",
      message: "Commvault SLA dashboard response did not match the expected solutionSummary.slaSummary shape — this endpoint/field mapping needs to be reconfirmed against this CommCell's live Swagger UI (see the connector plan's Task 0 notes) before this check can be trusted.",
      evidencePayload: { rawResponseKeys: Object.keys(response || {}) },
    }];
  }

  const notMeetingSla = (slaSummary.slaNotMetEntities || 0) + (slaSummary.neverBackedupEntities || 0);
  const compliant = notMeetingSla === 0;

  return [{
    resourceId: "commcell",
    status: compliant ? "pass" : "fail",
    message: compliant
      ? `All ${slaSummary.totalEntities} monitored entities meet their backup SLA`
      : `${notMeetingSla} of ${slaSummary.totalEntities} monitored entities are missing their backup SLA`,
    evidencePayload: {
      totalEntities: slaSummary.totalEntities,
      slaNotMetEntities: slaSummary.slaNotMetEntities || 0,
      neverBackedupEntities: slaSummary.neverBackedupEntities || 0,
    },
  }];
}

export const backupTests = [
  { key: "commvault.backup.sla_compliance", title: "Monitored entities meet their backup SLA", severityDefault: "critical", isoReferences: ["A.12.3.1"], run: (clients) => checkBackupSlaCompliance(clients.commvault) },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultBackup.test.js`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/commvault/tests/backup.js api/src/__tests__/connectorsCommvaultBackup.test.js
git commit -m "feat: add Commvault backup SLA compliance check"
```

---

### Task 4: Storage policy checks (WORM/compliance lock, encryption)

**Files:**
- Create: `api/src/connectors/commvault/tests/storage.js`
- Test: `api/src/__tests__/connectorsCommvaultStorage.test.js`

**Interfaces:**
- Produces: `storageTests`, `checkWormLockEnabled(commvault)`, `checkEncryptionEnabled(commvault)`, plus a shared internal `getStoragePolicyCopies(commvault)` helper both checks call.
- **Uses two unconfirmed endpoints and one unconfirmed field name — see Task 0, items 2–4.** The WORM field name (`copyFlags.wormCopy`) is confirmed; the encryption field is not, so `checkEncryptionEnabled` checks a candidate list and falls back to `status: "error"`.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsCommvaultStorage.test.js`:

```js
import { describe, test, expect, vi } from "vitest";
import { checkWormLockEnabled, checkEncryptionEnabled } from "../connectors/commvault/tests/storage.js";

function fakeClient({ list, detailByPolicyId }) {
  return {
    request: vi.fn(async (path) => {
      if (path === "/StoragePolicy") return list;
      const match = path.match(/^\/v2\/StoragePolicy\/(\d+)\?propertyLevel=10$/);
      if (match) return detailByPolicyId[match[1]];
      throw new Error(`Unexpected path requested in test double: ${path}`);
    }),
  };
}

describe("checkWormLockEnabled", () => {
  test("passes a copy with WORM/compliance lock enabled", async () => {
    const commvault = fakeClient({
      list: { policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }] },
      detailByPolicyId: { 1: { storagePolicyCopy: [{ copyName: "Primary Copy", copyFlags: { wormCopy: 1 } }] } },
    });
    const results = await checkWormLockEnabled(commvault);
    expect(results).toEqual([{
      resourceId: "Primary/Primary Copy",
      status: "pass",
      message: "Primary/Primary Copy has WORM/compliance lock enabled",
      evidencePayload: { policyName: "Primary", copyName: "Primary Copy", wormCopy: 1 },
    }]);
  });

  test("fails a copy with WORM/compliance lock disabled", async () => {
    const commvault = fakeClient({
      list: { policies: [{ storagePolicyName: "Secondary", storagePolicyId: 2 }] },
      detailByPolicyId: { 2: { storagePolicyCopy: [{ copyName: "Secondary Copy", copyFlags: { wormCopy: 0 } }] } },
    });
    const results = await checkWormLockEnabled(commvault);
    expect(results[0].status).toBe("fail");
  });

  test("evaluates every copy of every policy independently", async () => {
    const commvault = fakeClient({
      list: { policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }] },
      detailByPolicyId: { 1: { storagePolicyCopy: [
        { copyName: "Primary Copy", copyFlags: { wormCopy: 1 } },
        { copyName: "Secondary Copy", copyFlags: { wormCopy: 0 } },
      ] } },
    });
    const results = await checkWormLockEnabled(commvault);
    expect(results.length).toBe(2);
    expect(results.find((r) => r.resourceId === "Primary/Primary Copy").status).toBe("pass");
    expect(results.find((r) => r.resourceId === "Primary/Secondary Copy").status).toBe("fail");
  });

  test("returns not_applicable when there are no storage policies", async () => {
    const commvault = fakeClient({ list: { policies: [] }, detailByPolicyId: {} });
    const results = await checkWormLockEnabled(commvault);
    expect(results).toEqual([{ resourceId: "commcell", status: "not_applicable", message: "No storage policy copies found", evidencePayload: {} }]);
  });
});

describe("checkEncryptionEnabled", () => {
  test("passes a copy with encryption enabled via copyFlags.encryptData", async () => {
    const commvault = fakeClient({
      list: { policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }] },
      detailByPolicyId: { 1: { storagePolicyCopy: [{ copyName: "Primary Copy", copyFlags: { encryptData: 1 } }] } },
    });
    const results = await checkEncryptionEnabled(commvault);
    expect(results[0].status).toBe("pass");
  });

  test("fails a copy with encryption explicitly disabled", async () => {
    const commvault = fakeClient({
      list: { policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }] },
      detailByPolicyId: { 1: { storagePolicyCopy: [{ copyName: "Primary Copy", copyFlags: { encryptData: 0 } }] } },
    });
    const results = await checkEncryptionEnabled(commvault);
    expect(results[0].status).toBe("fail");
  });

  test("returns 'error' (not a silently-guessed pass) when no known encryption field is present on the copy", async () => {
    const commvault = fakeClient({
      list: { policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }] },
      detailByPolicyId: { 1: { storagePolicyCopy: [{ copyName: "Primary Copy", copyFlags: {} }] } },
    });
    const results = await checkEncryptionEnabled(commvault);
    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/live confirmation/);
  });

  test("returns not_applicable when there are no storage policies", async () => {
    const commvault = fakeClient({ list: { policies: [] }, detailByPolicyId: {} });
    const results = await checkEncryptionEnabled(commvault);
    expect(results[0].status).toBe("not_applicable");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultStorage.test.js`
Expected: FAIL — `Cannot find module '../connectors/commvault/tests/storage.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/commvault/tests/storage.js`:

```js
// UNCONFIRMED (see plan Task 0, items 2–3): the storage-*policy* list
// endpoint's exact path/envelope was not confirmed. Research did confirm a
// related-but-distinct endpoint, GET /API/v1/StoragePools, returns a
// { poolName: poolId } *dictionary*, not an array — strong evidence
// Commvault's REST conventions are inconsistent across resource types, so
// this endpoint's shape (assumed here as { policies: [...] }) must be
// verified independently, not inferred from the pools endpoint.
const STORAGE_POLICY_LIST_ENDPOINT = "/StoragePolicy"; // TODO CONFIRM

// UNCONFIRMED response envelope key for the array of copies — "storagePolicyCopy" below is a plausible guess.
const storagePolicyDetailEndpoint = (id) => `/v2/StoragePolicy/${id}?propertyLevel=10`; // TODO CONFIRM envelope key

// CONFIRMED: copyFlags.wormCopy (1/0), per cvpysdk's
// StoragePoolCopy.is_compliance_lock_enabled, which reads exactly this
// field (envelope path differs for storage *pools* vs storage *policies* —
// the field name itself is what's confirmed, and is the same concept).
function isWormLockEnabled(copy) {
  return copy?.copyFlags?.wormCopy === 1;
}

// UNCONFIRMED (see plan Task 0, item 4): no field for "is encryption
// enabled on this copy" was found in indexed cvpysdk docs — only an
// unrelated mode-preservation flag (copyFlags.preserveEncryptionModeAsInSource).
// These are the most plausible candidate field names pending live
// confirmation; narrow this list to the one real field once confirmed.
function findEncryptionFlag(copy) {
  const candidates = [
    copy?.copyFlags?.encryptData,
    copy?.copyFlags?.encryptionFlag,
    copy?.encryptionFlag,
    copy?.encryptData,
  ];
  return candidates.find((value) => value !== undefined);
}

async function getStoragePolicyCopies(commvault) {
  const list = await commvault.request(STORAGE_POLICY_LIST_ENDPOINT);
  const policies = list?.policies || [];
  const allCopies = [];
  for (const policy of policies) {
    const detail = await commvault.request(storagePolicyDetailEndpoint(policy.storagePolicyId));
    const copies = detail?.storagePolicyCopy || detail?.copy || [];
    for (const copy of copies) {
      allCopies.push({ policyName: policy.storagePolicyName, copy });
    }
  }
  return allCopies;
}

export async function checkWormLockEnabled(commvault) {
  const copies = await getStoragePolicyCopies(commvault);
  if (copies.length === 0) {
    return [{ resourceId: "commcell", status: "not_applicable", message: "No storage policy copies found", evidencePayload: {} }];
  }
  return copies.map(({ policyName, copy }) => {
    const enabled = isWormLockEnabled(copy);
    const resourceId = `${policyName}/${copy.copyName || copy.copyId}`;
    return {
      resourceId,
      status: enabled ? "pass" : "fail",
      message: enabled ? `${resourceId} has WORM/compliance lock enabled` : `${resourceId} does not have WORM/compliance lock enabled`,
      evidencePayload: { policyName, copyName: copy.copyName, wormCopy: copy?.copyFlags?.wormCopy ?? null },
    };
  });
}

export async function checkEncryptionEnabled(commvault) {
  const copies = await getStoragePolicyCopies(commvault);
  if (copies.length === 0) {
    return [{ resourceId: "commcell", status: "not_applicable", message: "No storage policy copies found", evidencePayload: {} }];
  }
  return copies.map(({ policyName, copy }) => {
    const resourceId = `${policyName}/${copy.copyName || copy.copyId}`;
    const flag = findEncryptionFlag(copy);
    if (flag === undefined) {
      return {
        resourceId,
        status: "error",
        message: `Could not determine encryption status for ${resourceId} — no known encryption field was present on this CommCell's storage policy copy response; the field mapping needs live confirmation (see connector plan Task 0).`,
        evidencePayload: { policyName, copyName: copy.copyName, copyFlags: copy?.copyFlags || {} },
      };
    }
    const enabled = flag === 1 || flag === true;
    return {
      resourceId,
      status: enabled ? "pass" : "fail",
      message: enabled ? `${resourceId} has encryption enabled` : `${resourceId} does not have encryption enabled`,
      evidencePayload: { policyName, copyName: copy.copyName, encryptionFlag: flag },
    };
  });
}

export const storageTests = [
  { key: "commvault.storage.worm_lock_enabled", title: "Storage policy copies have WORM/compliance lock enabled", severityDefault: "high", isoReferences: ["A.18.1.3"], run: (clients) => checkWormLockEnabled(clients.commvault) },
  { key: "commvault.storage.encryption_enabled", title: "Storage policy copies have encryption enabled", severityDefault: "high", isoReferences: ["A.10.1.1"], run: (clients) => checkEncryptionEnabled(clients.commvault) },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultStorage.test.js`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/commvault/tests/storage.js api/src/__tests__/connectorsCommvaultStorage.test.js
git commit -m "feat: add Commvault storage policy WORM lock and encryption checks"
```

---

### Task 5: Monitoring alerts check

**Files:**
- Create: `api/src/connectors/commvault/tests/monitoring.js`
- Test: `api/src/__tests__/connectorsCommvaultMonitoring.test.js`

**Interfaces:**
- Produces: `monitoringTests`, `checkAlertsConfigured(commvault)`.
- `GET /Alerts`'s response shape is **confirmed**. The *filtering heuristic* (which alerts "count" as job-failure monitoring) is a best-effort, documented-caveat heuristic — see Task 0, item 5.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsCommvaultMonitoring.test.js`:

```js
import { describe, test, expect, vi } from "vitest";
import { checkAlertsConfigured } from "../connectors/commvault/tests/monitoring.js";

function fakeClient(response) {
  return { request: vi.fn(async () => response) };
}

describe("checkAlertsConfigured", () => {
  test("passes when an alert's category matches the job-failure-monitoring heuristic", async () => {
    const commvault = fakeClient({ alertList: [{ alert: { name: "Backup Job Failed" }, alertCategory: { name: "Job Management" }, description: "Notifies on job failure" }] });
    const results = await checkAlertsConfigured(commvault);
    expect(results[0].status).toBe("pass");
    expect(results[0].evidencePayload.matchingAlertNames).toEqual(["Backup Job Failed"]);
  });

  test("passes when an alert's description mentions job failure even if its category doesn't match", async () => {
    const commvault = fakeClient({ alertList: [{ alert: { name: "Custom Alert" }, alertCategory: { name: "Custom" }, description: "Triggers when a backup job fails unexpectedly" }] });
    const results = await checkAlertsConfigured(commvault);
    expect(results[0].status).toBe("pass");
  });

  test("fails when no configured alert looks like job-failure monitoring", async () => {
    const commvault = fakeClient({ alertList: [{ alert: { name: "Disk Space Low" }, alertCategory: { name: "Media Management" }, description: "Notifies when disk space is low" }] });
    const results = await checkAlertsConfigured(commvault);
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.matchingAlertNames).toEqual([]);
  });

  test("fails when there are no alerts at all, and reports zero total alerts in evidence", async () => {
    const commvault = fakeClient({ alertList: [] });
    const results = await checkAlertsConfigured(commvault);
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.totalAlerts).toBe(0);
  });

  test("requests the confirmed /Alerts endpoint", async () => {
    const commvault = fakeClient({ alertList: [] });
    await checkAlertsConfigured(commvault);
    expect(commvault.request).toHaveBeenCalledWith("/Alerts");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultMonitoring.test.js`
Expected: FAIL — `Cannot find module '../connectors/commvault/tests/monitoring.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/commvault/tests/monitoring.js`:

```js
// CONFIRMED shape: GET /Alerts returns
// { alertList: [{ alert: { name }, alertCategory: { name }, description, organizationId, ... }] }
// per cvpysdk's alert.html (commcell.alerts.all_alerts reads exactly this list).
//
// UNCONFIRMED (see plan Task 0, item 5): the filtering heuristic below —
// which alerts "count" as job-failure monitoring — is a best-effort guess,
// not a documented, stable Commvault taxonomy. Confirm real out-of-the-box
// alertCategory.name values on a live CommCell and tighten this list.
const JOB_FAILURE_CATEGORY_KEYWORDS = ["job management", "data protection"];
const JOB_FAILURE_TEXT_KEYWORDS = ["job fail", "backup fail", "job failed"];

function looksLikeJobFailureAlert(alertEntry) {
  const category = (alertEntry?.alertCategory?.name || "").toLowerCase();
  const name = (alertEntry?.alert?.name || "").toLowerCase();
  const description = (alertEntry?.description || "").toLowerCase();
  const categoryMatch = JOB_FAILURE_CATEGORY_KEYWORDS.some((kw) => category.includes(kw));
  const textMatch = JOB_FAILURE_TEXT_KEYWORDS.some((kw) => name.includes(kw) || description.includes(kw));
  return categoryMatch || textMatch;
}

export async function checkAlertsConfigured(commvault) {
  const response = await commvault.request("/Alerts");
  const alertList = response?.alertList || [];
  const matches = alertList.filter(looksLikeJobFailureAlert);
  const configured = matches.length > 0;
  return [{
    resourceId: "commcell",
    status: configured ? "pass" : "fail",
    message: configured
      ? `${matches.length} alert(s) configured for backup job failure monitoring`
      : "No alert is configured for backup job failure monitoring",
    evidencePayload: { totalAlerts: alertList.length, matchingAlertNames: matches.map((m) => m.alert?.name).filter(Boolean) },
  }];
}

export const monitoringTests = [
  { key: "commvault.monitoring.alerts_configured", title: "An alert is configured for backup job failures", severityDefault: "medium", isoReferences: ["A.12.4.1"], run: (clients) => checkAlertsConfigured(clients.commvault) },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultMonitoring.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/commvault/tests/monitoring.js api/src/__tests__/connectorsCommvaultMonitoring.test.js
git commit -m "feat: add Commvault backup-failure alert monitoring check"
```

---

### Task 6: Commvault connector assembly + registry wiring

**Files:**
- Create: `api/src/connectors/commvault/index.js`
- Modify: `api/src/connectors/registry.js`
- Test: `api/src/__tests__/connectorsCommvaultIndex.test.js`
- Test: `api/src/__tests__/connectorsRegistry.test.js`

**Interfaces:**
- Consumes: `resolveCommvaultCredentials` (Task 2), `backupTests` (Task 3), `storageTests` (Task 4), `monitoringTests` (Task 5).
- Produces: `key = "commvault"`, `tests` (array of 4), `testConnection({authType, config, secret}) => {ok, externalAccountId}`, `runTests({authType, config, secret}) => Array<{testKey, title, severity, resourceId, status, message, evidencePayload}>`.
- `testConnection` deliberately reuses `GET /Alerts` as its connectivity/auth probe rather than calling a dedicated "who am I" endpoint — `/Alerts` is already required in the token's `apiEndpoints` allowlist for check 4, so validating the connection needs no extra allowlist entry and no extra live call, mirroring AWS's single-purpose `GetCallerIdentity` probe.
- `externalAccountId`: Commvault's REST API has no confirmed lightweight "CommCell identity" endpoint reachable within a Custom-scope token's typical allowlist. This connector uses the WebConsole hostname from `config.webconsoleUrl` instead — a defensible, always-available identifier requiring no extra API call, though not a true CommCell GUID/name. Revisit if a live-verified lightweight identity endpoint is found during Task 0.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsCommvaultIndex.test.js`:

```js
import { describe, test, expect, vi, afterEach } from "vitest";
import { runTests, testConnection, tests } from "../connectors/commvault/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchByPath(handlers) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = new URL(url).pathname.replace(/^\/webconsole\/api/, "");
    const search = new URL(url).search;
    const handler = handlers[path + search] || handlers[path];
    if (!handler) throw new Error(`Unhandled test-double request: ${path}${search}`);
    return { ok: true, json: async () => handler };
  }));
}

describe("commvault connector", () => {
  test("runTests propagates each test's human-readable title alongside its key and returns all 4 Tier-1 results", async () => {
    stubFetchByPath({
      "/Alerts": { alertList: [] },
      "/dashboard?slaNumberOfDays=1": { solutionSummary: { slaSummary: { totalEntities: 5, slaNotMetEntities: 0, neverBackedupEntities: 0 } } },
      "/StoragePolicy": { policies: [] },
    });

    const results = await runTests({
      authType: "api_key",
      config: { webconsoleUrl: "https://cv.example.com" },
      secret: { accessToken: "tok-123" },
    });

    expect(results.length).toBe(4);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
    }

    const slaResult = results.find((r) => r.testKey === "commvault.backup.sla_compliance");
    expect(slaResult.status).toBe("pass");

    const wormResult = results.find((r) => r.testKey === "commvault.storage.worm_lock_enabled");
    expect(wormResult.status).toBe("not_applicable"); // no storage policies in this fixture

    const alertsResult = results.find((r) => r.testKey === "commvault.monitoring.alerts_configured");
    expect(alertsResult.status).toBe("fail");
  });

  test("testConnection probes GET /Alerts and returns the webconsole hostname as externalAccountId", async () => {
    stubFetchByPath({ "/Alerts": { alertList: [] } });

    const result = await testConnection({
      authType: "api_key",
      config: { webconsoleUrl: "https://cv.example.com" },
      secret: { accessToken: "tok-123" },
    });

    expect(result).toEqual({ ok: true, externalAccountId: "cv.example.com" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultIndex.test.js`
Expected: FAIL — `Cannot find module '../connectors/commvault/index.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/commvault/index.js`:

```js
import { resolveCommvaultCredentials } from "./credentials.js";
import { backupTests } from "./tests/backup.js";
import { storageTests } from "./tests/storage.js";
import { monitoringTests } from "./tests/monitoring.js";

export const key = "commvault";

export const tests = [...backupTests, ...storageTests, ...monitoringTests];

export async function testConnection({ authType, config, secret }) {
  const commvault = await resolveCommvaultCredentials({ authType, config, secret });

  // GET /Alerts doubles as Commvault's connectivity/auth probe — it's
  // already required in the token's apiEndpoints allowlist for check 4
  // (see routes/integrations.js's COMMVAULT_ACCESS_TOKEN_SETUP), so no
  // extra allowlist entry or extra live call is needed just to validate
  // the connection, mirroring AWS's single-purpose STS probe.
  await commvault.request("/Alerts");

  // Commvault has no confirmed lightweight "who am I"/CommCell-identity
  // endpoint reachable within a typical Custom-scope allowlist (unlike
  // AWS's STS account ID or Azure's config-supplied subscription ID), so
  // the WebConsole hostname is used as a stable, always-available
  // identifier instead — not a true CommCell GUID, but sufficient to
  // distinguish connections in the UI without an extra API call.
  return { ok: true, externalAccountId: new URL(config.webconsoleUrl).hostname };
}

export async function runTests({ authType, config, secret }) {
  const commvault = await resolveCommvaultCredentials({ authType, config, secret });
  const clients = { commvault };
  const runResults = [];
  for (const test of tests) {
    const results = await test.run(clients);
    for (const result of results) {
      runResults.push({ testKey: test.key, title: test.title, severity: test.severityDefault, ...result });
    }
  }
  return runResults;
}
```

Modify `api/src/connectors/registry.js`:

```js
import * as aws from "./aws/index.js";
import * as azure from "./azure/index.js";
import * as commvault from "./commvault/index.js";

const connectors = { [aws.key]: aws, [azure.key]: azure, [commvault.key]: commvault };
```

(the rest of the file — `getConnector`/`listConnectorTests` — is unchanged).

Modify `api/src/__tests__/connectorsRegistry.test.js` — add commvault coverage alongside the existing aws/azure blocks:

```js
  test("resolves the commvault connector", () => {
    const connector = getConnector("commvault");
    expect(connector.key).toBe("commvault");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("commvault connector exposes exactly the 4 Tier-1 tests", () => {
    const tests = listConnectorTests("commvault");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "commvault.backup.sla_compliance",
      "commvault.monitoring.alerts_configured",
      "commvault.storage.encryption_enabled",
      "commvault.storage.worm_lock_enabled",
    ]);
  });
```

(the existing `"throws for an unknown integration"` test using `"gcp"` as an unregistered example needs no change — `gcp` remains genuinely unregistered.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/connectorsCommvaultIndex.test.js src/__tests__/connectorsRegistry.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/commvault/index.js api/src/connectors/registry.js api/src/__tests__/connectorsCommvaultIndex.test.js api/src/__tests__/connectorsRegistry.test.js
git commit -m "feat: assemble the Commvault connector and register it"
```

---

### Task 7: `commvault/setup-info` route

**Files:**
- Modify: `api/src/routes/integrations.js`
- Test: `api/src/__tests__/integration/integrations.test.js`

**Interfaces:**
- Produces: `GET /api/integrations/commvault/setup-info` → `{ accessTokenSetup: {...} }`.

Unlike AWS's `setup-info` (live STS call) and like Azure's `setup-info` (a static JSON payload, no live call), this endpoint returns a static description of exactly how the customer should generate their Custom-scope access token, including the precise `apiEndpoints` allowlist — kept in lockstep with every endpoint `commvault/tests/{backup,storage,monitoring}.js` and `commvault/index.js`'s `testConnection` actually call.

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/integrations.test.js` (alongside the existing `describe("GET /api/integrations/azure/setup-info", ...)` block):

```js
describe("GET /api/integrations/commvault/setup-info", () => {
  test("returns the Custom-scope access token setup instructions with a minimal apiEndpoints allowlist, no live Commvault call needed", async () => {
    const company = await createCompany({ domain: "commvaultsetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/commvault/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.accessTokenSetup.tokenType).toBe(3);
    expect(res.body.accessTokenSetup.apiEndpoints).toEqual(
      expect.arrayContaining(["/Alerts", "/dashboard", "/StoragePolicy", "/v2/StoragePolicy"])
    );
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "commvaultsetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/commvault/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: FAIL — `res.body.accessTokenSetup` is `undefined` (404, no matching route).

- [ ] **Step 3: Write the implementation**

In `api/src/routes/integrations.js`, add this constant near the existing `AZURE_READ_ONLY_ROLE_DEFINITION` constant, and the route immediately after the existing `router.get("/azure/setup-info", ...)` handler:

```js
// The exact REST API paths Prism's Commvault checks call — kept in lockstep
// with connectors/commvault/tests/{backup,storage,monitoring}.js and
// connectors/commvault/index.js's testConnection so the Custom-scope
// access token a customer generates never grants more (or less) than the
// code uses. Passed verbatim into Commvault's own POST /accessTokens
// `apiEndpoints` field (tokenType 3 = "Custom").
const COMMVAULT_ACCESS_TOKEN_SETUP = {
  tokenType: 3,
  apiEndpoints: ["/Alerts", "/dashboard", "/StoragePolicy", "/v2/StoragePolicy"],
  instructions:
    "In your CommCell, go to Command Center > your username > Access Tokens > Add. " +
    "Set Scope to \"Custom\", paste the exact API endpoint list Prism provides here, " +
    "and copy the generated token into Prism's connection form along with your " +
    "WebConsole base URL.",
};

router.get("/commvault/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ accessTokenSetup: COMMVAULT_ACCESS_TOKEN_SETUP });
}));
```

Note `/v2/StoragePolicy` is listed separately from `/StoragePolicy` because Commvault's Custom-scope `apiEndpoints` allowlist matches on literal path prefixes — the list endpoint and the versioned detail endpoint are different path prefixes even though they address the same resource family, so both must be explicitly allowlisted. **Re-verify this exact allowlist once Task 0's endpoint paths are confirmed** — if the real SLA-dashboard or storage-policy paths differ from this plan's placeholders, this list must be updated to match, or customers' tokens will be scoped too narrowly and every run will fail with 403s.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/integrations.js api/src/__tests__/integration/integrations.test.js
git commit -m "feat: add Commvault setup-info endpoint with Custom-scope access token instructions"
```

---

### Task 8: `collectionRunner` cross-connector regression coverage (third, non-SDK-shaped connector)

**Files:**
- Modify: `api/src/__tests__/integration/collectionRunner.test.js`

**Interfaces:**
- Test coverage only, no production code changes — `collectionRunner.js` remains untouched.

- [ ] **Step 1: Write the failing test**

Modify `api/src/__tests__/integration/collectionRunner.test.js` — add a third entry to the existing `CONNECTOR_FIXTURES` object (no change to the `vi.mock` call itself, which is already argument-aware):

```js
  commvault: {
    key: "commvault",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "cv.example.com" })),
    runTests: vi.fn(async () => ([
      { testKey: "commvault.backup.sla_compliance", title: "Monitored entities meet their backup SLA", severity: "critical", resourceId: "commcell", status: "pass", message: "All 10 monitored entities meet their backup SLA", evidencePayload: { totalEntities: 10 } },
      { testKey: "commvault.storage.worm_lock_enabled", title: "Storage policy copies have WORM/compliance lock enabled", severity: "high", resourceId: "Primary/Primary Copy", status: "fail", message: "Primary/Primary Copy does not have WORM/compliance lock enabled", evidencePayload: { policyName: "Primary" } },
    ])),
  },
```

Then add a new test to the `describe("runCollection", ...)` block:

```js
  test("works identically for a third, non-SDK-shaped connector (commvault), proving genericity holds beyond SDK-wrapped clients", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Backup Management') `, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.12.3.1')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'commvault', 'Prod Commvault') RETURNING *`,
      [company.id]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "api_key", secret: { accessToken: "tok-123" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(1);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].test_key).toBe("commvault.storage.worm_lock_enabled");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- collectionRunner.test`
Expected: FAIL until Task 1's seed data + this fixture change both land; once they do, this locks in genuine behavior rather than a hardcoded fixture.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd api && npm run test:integration -- collectionRunner.test`
Expected: PASS — all pre-existing tests (aws, azure) plus this new commvault one.

- [ ] **Step 4: Commit**

```bash
git add api/src/__tests__/integration/collectionRunner.test.js
git commit -m "test: prove collectionRunner is generic across a third, non-SDK-shaped connector"
```

---

### Task 9: Full backend suite verification

**Files:** None (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `cd api && npm test`
Expected: PASS — all pre-existing unit tests plus the new files from Tasks 2–6, plus the updated `connectorsRegistry.test.js`. The optional `connectorsCommvaultLiveShapes.test.js` from Task 0 is skipped (no `COMMVAULT_TEST_*` env vars set) and does not affect pass/fail.

- [ ] **Step 2: Run the full integration suite**

Run: `cd api && npm run test:integration`
Expected: PASS — all pre-existing integration tests plus Task 1's schema coverage, Task 7's `commvault/setup-info` coverage, and Task 8's third-connector `collectionRunner` coverage. Requires a local Postgres reachable at `postgresql://postgres:postgres@localhost:5432/prism_test`.

- [ ] **Step 3: (If access to a live/trial CommCell exists) run the live shape guard once**

Run: `COMMVAULT_TEST_WEBCONSOLE_URL=<url> COMMVAULT_TEST_TOKEN=<token> npx vitest run src/__tests__/connectorsCommvaultLiveShapes.test.js`
Expected: PASS if all of Task 0's assumptions held; a failure means one of the `// TODO CONFIRM` placeholders in Tasks 3–5 needs correcting before this connector is trusted with real customer data.

- [ ] **Step 4: Confirm no stray changes**

Run: `git status --short`
Expected: clean except any genuinely pre-existing, out-of-scope changes already present before this plan started.

---

## Self-Review Notes

- **Spec coverage:** the fixed requirements name `auth_type = 'api_key'` with a Custom-scope access token, exactly 4 Tier-1 checks with specified ISO mappings, a "thin REST client, not an SDK" structural requirement, and an explicit request to flag every unconfirmed field/endpoint plus a "Task 0: verify live API shapes" step. Task 0 → the verification gate and every flagged unknown. Task 1 → seed rows + auth type. Task 2 → the request-helper credential shape. Tasks 3–5 → the 4 checks, each citing what's confirmed vs. guessed. Task 6 → connector assembly + registry + `testConnection`'s design rationale. Task 7 → `setup-info` with the exact `apiEndpoints` allowlist. Task 8 → the "prove genericity a third time, for a non-SDK shape" verification. Task 9 → full-suite gate, including an optional live re-verification step.
- **Placeholder scan:** every step has real, complete code. Every *confirmed* Commvault behavior is cited to its `cvpysdk` source. Every *unconfirmed* endpoint or field is marked `// TODO CONFIRM` inline, cross-referenced to a numbered item in Task 0, and coded so a wrong guess degrades to an explained `status: "error"` result rather than a silently wrong `pass`/`fail`.
- **Type consistency:** `resolveCommvaultCredentials`'s return type (`{apiRoot, request}`) is used consistently throughout Task 6. Every test key referenced in Task 1's seed data matches verbatim the `key` field in Tasks 3–5's test-definition arrays. The `apiEndpoints` allowlist in Task 7 is derived directly from the literal path strings called in Tasks 3–6's code — if Task 0 changes any of those paths, Task 7's allowlist must be updated in the same pass.

### Critical Files for Implementation

- `/Users/aum/Desktop/Prism/api/src/connectors/commvault/credentials.js`
- `/Users/aum/Desktop/Prism/api/src/connectors/commvault/tests/backup.js`
- `/Users/aum/Desktop/Prism/api/src/connectors/commvault/tests/storage.js`
- `/Users/aum/Desktop/Prism/api/src/connectors/commvault/index.js`
- `/Users/aum/Desktop/Prism/api/src/routes/integrations.js`
- `/Users/aum/Desktop/Prism/init.sql`
