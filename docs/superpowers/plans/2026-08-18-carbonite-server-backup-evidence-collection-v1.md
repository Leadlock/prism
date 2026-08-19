# Carbonite Server Backup (API – Monitoring) Evidence Collection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenText **Carbonite Server Backup** (the self-hosted product line — distinct from Carbonite *Core Endpoint Backup*, covered in a separate sibling plan, `2026-08-18-carbonite-core-endpoint-evidence-collection-v1.md`) as an evidence-collection connector, using its **API – Monitoring** component: a read-only OData/REST API, authenticated via Keycloak OIDC, covering Agents/Companies/Jobs/Safesets/Vaults. This is a fifth connector alongside AWS, Azure, Commvault, and Carbonite Core Endpoint, and a structurally new auth shape for this codebase: **Keycloak-issued OAuth2 tokens against a self-hosted, customer-operated authorization server**, distinct from Azure's Microsoft-hosted Service Principal flow.

**Architecture:** Mirrors `api/src/connectors/{aws,azure,commvault}/` at the module-contract level exactly — `key`, `tests`, `testConnection`, `runTests`, registered in `connectors/registry.js`, zero changes required to `collectionRunner.js` (already proven provider-agnostic across multiple structurally different connectors in `api/src/__tests__/integration/collectionRunner.test.js`). `carbonite-server/credentials.js` resolves into a request-helper (`{apiRoot, request}`, same shape as Commvault's) that first exchanges the stored client credentials for a short-lived Keycloak access token, caches it for the run, and attaches it as a `Bearer` header on every subsequent OData call — genuinely new infrastructure this codebase hasn't needed before (Commvault's token is pre-generated and static; this one is minted per collection run via a real OAuth2 token endpoint).

**Spec:** No pre-existing plan-mode design doc — target product, checks, and ISO mappings were decided directly during this research pass, confirmed with the user (both Carbonite product lines are being pursued, this plan covers the Server Backup one). Every API fact below is either **(a) confirmed** — from vendor (`carbonite.com`/OpenText) documentation surfaced via web search during this session, cited inline — or **(b) unconfirmed** — flagged and folded into Task 0. Context7 has no usable coverage for either Carbonite product (confirmed again this session — searches for "Carbonite" and "OpenText Carbonite" only match unrelated libraries/products); do not re-attempt it for this vendor.

**Context7 research note (repeated from the sibling Core Endpoint plan, still true):** `resolve-library-id` for "OpenText Carbonite" matches only an unrelated OpenText Operations Orchestration doc portal; a bare "Carbonite" resolve matches an unrelated Elixir Postgres audit-trail library. Both are useless here — this plan's research came entirely from direct web search against vendor documentation instead.

---

## Confirmed API facts

- **Type**: a public, read-only **OData Web API** (not SOAP, unlike the sibling Core Endpoint plan) — a genuinely different integration shape from every other connector in this codebase, including Carbonite Core Endpoint.
- **Entities exposed** (read-only): Agents, Companies (sites), Company users, Jobs, Safesets, Vaults.
- **Documentation discovery mechanism**: a Swagger UI is shipped with every install, at `https://<APIdomainNameOrIPaddress>/monitoring/swaggerui/index` — this is the authoritative, per-install source of truth for exact paths/fields (not a shared public doc site, since this is self-hosted per customer).
- **Auth**: Keycloak (third-party OIDC authorization server, installed alongside the API). A client must be registered in Keycloak via a setup script shipped with the API before any calls can succeed. Default/expected **Client ID: `Carbonite-Registration-Client`**.
- **Access levels** (confirmed, three tiers): **Admin** (unrestricted, all data + vault info), **Partner** (Portal-instance data, no vault info), **Reseller** (scoped to specific companies and their safesets). Reseller, scoped only to the customer's own company, is the correct least-privilege recommendation for `setup-info` — directly analogous to AWS's least-privilege IAM policy and Azure's custom role definition.
- **Installation model**: self-hosted, per-customer — the API runs on the customer's own server (confirmed for the sibling Core Endpoint/Server Backup family generally: "runs on the customer's own server on port 80/443 with an installer-supplied HTTPS cert"), so `config` must carry a customer-specific `apiDomain`/host, the same pattern as Carbonite Core Endpoint's `dashboardHost` and Commvault's `webconsoleUrl`.

## Unconfirmed — Task 0 verification gate (do this before Tasks 2–4's code is trusted)

Unlike Commvault (proxy docs via `cvpysdk`) or Carbonite Core Endpoint (detailed vendor SOAP docs with quoted field lists), this product's most authoritative reference — its Swagger UI — is **per-installation and was not reachable during this research pass** (no public mirror found; the vendor's PDF install guides are scanned/non-extractable). This plan is therefore the least field-confirmed of the five connectors, and Task 0 carries more weight than usual:

1. **Keycloak token endpoint URL pattern** — standard Keycloak OIDC would put it at `https://<keycloak-host>/auth/realms/<realm>/protocol/openid-connect/token` (or `/realms/<realm>/protocol/openid-connect/token` on newer Keycloak major versions, which dropped the `/auth` prefix) — confirm which Keycloak major version ships with this product, the real `<keycloak-host>` (same host as the API, or separate), and the realm name (candidate: something Carbonite-specific, not `master`).
2. **Grant type** — confirm whether client-credentials grant (`grant_type=client_credentials`) is enabled for the `Carbonite-Registration-Client`-derived client, or whether a different flow (e.g. resource-owner-password) is required — this determines whether `secret` needs just a client secret, or also a username/password.
3. **OData base path and exact entity endpoint paths** — e.g. is it `/monitoring/odata/Agents`, `/monitoring/api/v1/Agents`, or something else? Fetch the live Swagger UI's underlying OpenAPI/Swagger JSON (usually at a `/swagger.json` or `/swagger/v1/swagger.json` sibling path) to get every path programmatically rather than screen-reading the UI.
4. **Field names for the checks below** — `Jobs`/`Safesets` entities' exact status/timestamp field names (e.g. is a job's completion state called `Status`, `JobStatus`, `LastRunResult`? Is the last-run timestamp `LastRunTime`, `CompletedUtc`, `EndTime`?) and `Agents`' online/connectivity field name (`IsOnline`, `Status`, `LastCheckIn`?) — all unconfirmed, all needed before Tasks 2–3's checks can be trusted.
5. **OData query capabilities** — confirm whether standard OData query params (`$filter`, `$select`, `$expand`) are supported for narrowing Jobs/Safesets by date range and company, to avoid pulling a full unfiltered entity set on every collection run.
6. **Pagination** — OData APIs commonly use `$skip`/`$top` or an `@odata.nextLink` continuation — confirm which, since Carbonite Core Endpoint's sibling API is explicitly documented as *not* paginating its device-list call (capped, "not suitable for report generation") — do not assume this Monitoring API behaves the same way without checking.

- [ ] **Step 1: Get access to a live or trial Carbonite Server Backup install** (Director/Portal + the API – Monitoring component) with an account able to register a Keycloak client per the vendor's setup script.
- [ ] **Step 2: Open the live Swagger UI** at `https://<host>/monitoring/swaggerui/index`, and fetch its underlying OpenAPI JSON document directly (check the page's network requests or a conventional `/swagger.json`/`/swagger/v1/swagger.json` path) to get every confirmed path/field programmatically rather than by hand.
- [ ] **Step 3: Register a Keycloak client** using the vendor's setup script, at **Reseller** access level scoped to one company, and confirm the real token-endpoint URL, realm name, and grant type by inspecting the Keycloak realm's `.well-known/openid-configuration` document (`https://<keycloak-host>/realms/<realm>/.well-known/openid-configuration` or the `/auth/realms/...` legacy path) — this single document resolves open items 1 and 2 authoritatively.
- [ ] **Step 4: Call the Jobs, Safesets, and Agents endpoints** for real data and record the actual field names, resolving open items 4–6.
- [ ] **Step 5: Record confirmed shapes as code comments** in Tasks 2–3's files (`// CONFIRMED against <install host> on <date>`), correcting any wrong placeholder — same defensive-fallback discipline as every other connector plan in this repo: a wrong guess degrades to an explained `status: "error"` result, never a silently wrong `pass`/`fail`.
- [ ] **Step 6: (Optional) add an env-gated live-shape guard test**, `connectorsCarboniteServerLiveShapes.test.js`, mirroring `connectorsCommvaultLiveShapes.test.js`'s pattern (skipped unless real credentials are supplied via env vars).
- [ ] **Step 7: Commit** the optional live-shape test only.

---

## Global Constraints

- Every query touching tenant data must filter on `company_id = req.user.companyId` — this plan adds no new tenant-scoped routes beyond the existing generic `POST /:id/credentials`/`POST /:id/run` pattern. The one new route (`GET /carbonite-server/setup-info`) is static and non-tenant-scoped, matching every sibling connector's `setup-info` pattern.
- No BullMQ/queue, no scheduling — backend-only, manual-trigger evidence collection, matching every existing connector.
- `evidence_test_results.status` must be one of `'pass'|'fail'|'warn'|'error'|'not_applicable'` — given how much of this connector's field/path data is unconfirmed (more than any prior connector plan), every check function must return `status: "error"` whenever a required field or response shape isn't present in the form Task 0 confirmed. This is the most load-bearing instance of that discipline yet, since Task 0's Swagger UI is per-install and genuinely inaccessible from this planning session.
- The Keycloak token exchange is new infrastructure — `credentials.js` must fetch and cache a token for the duration of one `runTests()`/`testConnection()` call (a single collection run is short-lived; no refresh-mid-run logic needed, matching Commvault's "keep it simple" precedent for the same reason).
- Out of scope for this plan (matching every sibling backend plan's scope): any frontend/UI work — connection wizard copy, catalog icon, category grouping, and the same `authType`-vs-`provider.key` branching consideration the Acronis plan already had to resolve for `oauth2`. If this connector ships, revisit that same provider-keyed branching work (config shape here is `{apiDomain, keycloakRealm}`, not Azure's `{tenantId, subscriptionId}` or Acronis's `{datacenterUrl}` — a third distinct `oauth2` config shape).

---

## File Structure

- Modify: `init.sql` — one `integrations` seed row (`key = 'carbonite-server'`, `category = 'backup'`, `auth_type = 'oauth2'`), automated_tests + test_control_mappings seed rows
- Create: `api/src/connectors/carbonite-server/credentials.js` — `resolveCarboniteServerCredentials({authType, config, secret}) => Promise<{apiRoot, request}>`, internally exchanges `secret.clientId`/`secret.clientSecret` for a Keycloak bearer token before returning the request helper
- Create: `api/src/connectors/carbonite-server/tests/backup.js` — safeset/job recency check(s)
- Create: `api/src/connectors/carbonite-server/tests/monitoring.js` — agent-online check
- Create: `api/src/connectors/carbonite-server/index.js` — `key`, `tests`, `testConnection`, `runTests`
- Modify: `api/src/connectors/registry.js` — register the connector
- Modify: `api/src/routes/integrations.js` — `CARBONITE_SERVER_SETUP_INFO` const + `GET /carbonite-server/setup-info` (Reseller access level, scoped to one company, per the confirmed least-privilege access tier)
- Create: `api/src/__tests__/connectorsCarboniteServerCredentials.test.js`, `connectorsCarboniteServerBackup.test.js`, `connectorsCarboniteServerMonitoring.test.js`, `connectorsCarboniteServerIndex.test.js`
- Create: `api/src/__tests__/connectorsCarboniteServerLiveShapes.test.js` — optional, env-gated (Task 0, Step 6)
- Modify: `api/src/__tests__/connectorsRegistry.test.js`, `api/src/__tests__/integration/schema.evidenceCollection.test.js`, `api/src/__tests__/integration/collectionRunner.test.js` (fifth fixture), `api/src/__tests__/integration/integrations.test.js`

---

### Task 1: Schema seed

**Files:** Modify `init.sql`; Test: `api/src/__tests__/integration/schema.evidenceCollection.test.js`

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('carbonite-server', 'Carbonite Server Backup', 'backup', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('carbonite-server', 'carbonite-server.backup.recent_successful_safeset', 'Safesets have a recent successful backup run', 'Checks each monitored safeset''s most recent run completed successfully within the configured policy window.', 'critical', 'Investigate safesets with stale or failed runs in Carbonite Server Backup Director/Portal and remediate the underlying backup job.'),
  ('carbonite-server', 'carbonite-server.monitoring.agent_online', 'Backup agents are online and checking in', 'Checks every monitored agent has reported in recently, so silent agent failures don''t go unnoticed.', 'high', 'Investigate any agent shown as offline/not-checking-in in Carbonite Server Backup Director/Portal.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('carbonite-server.backup.recent_successful_safeset', 'A.12.3.1'),
  ('carbonite-server.monitoring.agent_online', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

Write the failing schema test first (mirror the existing aws/azure/commvault blocks), then the seed, then verify it passes; commit.

---

### Task 2: Keycloak token exchange + credential resolution

**Files:** Create `api/src/connectors/carbonite-server/credentials.js`; Test: `connectorsCarboniteServerCredentials.test.js`

```js
// UNCONFIRMED (Task 0, items 1-2): the exact Keycloak token endpoint URL
// and grant type for this product's shipped Keycloak version. Placeholder
// below assumes a client-credentials grant against a modern (no /auth
// prefix) Keycloak realm token endpoint — confirm both before trusting
// this in production.
export async function resolveCarboniteServerCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported Carbonite Server Backup auth type: ${authType}`);
  if (!config?.apiDomain) throw new Error("Carbonite Server Backup config.apiDomain is required");
  if (!config?.keycloakRealm) throw new Error("Carbonite Server Backup config.keycloakRealm is required");
  if (!secret?.clientId || !secret?.clientSecret) throw new Error("Carbonite Server Backup secret.clientId/clientSecret are required");

  const tokenEndpoint = `https://${config.apiDomain}/realms/${config.keycloakRealm}/protocol/openid-connect/token`; // TODO CONFIRM (Task 0, item 1)
  const tokenRes = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials", // TODO CONFIRM (Task 0, item 2)
      client_id: secret.clientId,
      client_secret: secret.clientSecret,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Carbonite Server Backup Keycloak token request failed: ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();

  const apiRoot = `https://${config.apiDomain}/monitoring`; // TODO CONFIRM base path (Task 0, item 3)

  async function request(path, { method = "GET" } = {}) {
    const res = await fetch(`${apiRoot}${path}`, { method, headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Carbonite Server Backup API ${method} ${path} returned ${res.status}`);
    return res.json();
  }

  return { apiRoot, request };
}
```

TDD as with every other connector: write the failing test first (mock `fetch`, assert the token POST body/headers and the subsequent `request()` bearer header), implement, verify green, commit.

---

### Task 3: Safeset/job recency check

**Files:** Create `api/src/connectors/carbonite-server/tests/backup.js`; Test: `connectorsCarboniteServerBackup.test.js`

```js
// UNCONFIRMED (Task 0, items 3-4): endpoint path and field names.
const SAFESETS_ENDPOINT = "/odata/Safesets"; // TODO CONFIRM

export async function checkRecentSuccessfulSafeset(carbonite) {
  const response = await carbonite.request(SAFESETS_ENDPOINT);
  const safesets = response?.value; // OData collections conventionally wrap results in `value`
  if (!Array.isArray(safesets)) {
    return [{ resourceId: "install", status: "error", message: "Safesets response did not match the expected OData { value: [...] } shape — reconfirm against this install's live Swagger UI (see connector plan Task 0).", evidencePayload: { rawResponseKeys: Object.keys(response || {}) } }];
  }
  if (safesets.length === 0) {
    return [{ resourceId: "install", status: "not_applicable", message: "No safesets found", evidencePayload: {} }];
  }
  return safesets.map((safeset) => {
    // TODO CONFIRM real field names — LastRunStatus/LastRunTime are placeholders.
    const succeeded = safeset.LastRunStatus === "Success";
    const resourceId = String(safeset.Id ?? safeset.Name ?? "unknown");
    return {
      resourceId,
      status: succeeded ? "pass" : "fail",
      message: succeeded ? `${resourceId} completed its most recent run successfully` : `${resourceId}'s most recent run did not succeed (status: ${safeset.LastRunStatus ?? "unknown"})`,
      evidencePayload: { lastRunStatus: safeset.LastRunStatus ?? null, lastRunTime: safeset.LastRunTime ?? null },
    };
  });
}

export const backupTests = [
  { key: "carbonite-server.backup.recent_successful_safeset", title: "Safesets have a recent successful backup run", severityDefault: "critical", isoReferences: ["A.12.3.1"], run: (clients) => checkRecentSuccessfulSafeset(clients.carboniteServer) },
];
```

TDD as above: failing test with mocked `carbonite.request` fixtures (pass, fail, malformed-shape → `"error"`, empty → `"not_applicable"`), implement, verify, commit.

---

### Task 4: Agent-online check

**Files:** Create `api/src/connectors/carbonite-server/tests/monitoring.js`; Test: `connectorsCarboniteServerMonitoring.test.js`

Same structure as Task 3, against `/odata/Agents` (path unconfirmed), checking a placeholder `IsOnline`/`Status` field (unconfirmed — Task 0 item 4), same `not_applicable`/`error` defensive fallbacks. TDD as above.

---

### Task 5: Connector assembly + registry wiring

**Files:** Create `api/src/connectors/carbonite-server/index.js`; Modify `api/src/connectors/registry.js`; Test: `connectorsCarboniteServerIndex.test.js`

```js
export const key = "carbonite-server";
export const tests = [...backupTests, ...monitoringTests];

export async function testConnection({ authType, config, secret }) {
  const carboniteServer = await resolveCarboniteServerCredentials({ authType, config, secret });
  await carboniteServer.request("/odata/Companies"); // cheap read probe, confirms token + access level work
  return { ok: true, externalAccountId: config.apiDomain };
}

export async function runTests({ authType, config, secret }) {
  const carboniteServer = await resolveCarboniteServerCredentials({ authType, config, secret });
  const clients = { carboniteServer };
  const runResults = [];
  for (const test of tests) {
    for (const result of await test.run(clients)) {
      runResults.push({ testKey: test.key, title: test.title, severity: test.severityDefault, ...result });
    }
  }
  return runResults;
}
```

Register in `registry.js` alongside `aws`/`azure`/`commvault`. Extend `connectorsRegistry.test.js`.

---

### Task 6: `carbonite-server/setup-info` route

**Files:** Modify `api/src/routes/integrations.js`; Test: extend `integrations.test.js`

Static payload (no live call, matching every sibling `setup-info`): instructions to run the vendor's Keycloak client-registration script, create a client at **Reseller** access level scoped to the one company being monitored (the confirmed least-privilege tier), and supply the resulting `clientId`/`clientSecret` plus the install's `apiDomain`/`keycloakRealm` into Prism's connection form.

---

### Task 7: `collectionRunner` cross-connector regression coverage (fifth connector)

**Files:** Modify `api/src/__tests__/integration/collectionRunner.test.js`

Add a `carbonite-server` fixture alongside the existing `aws`/`azure`/`commvault` (and, once that sibling plan ships, `carbonite`) fixtures — proving `runCollection` needs zero changes for a connector whose credential resolution internally performs a live OAuth2 token exchange before returning its request helper, not just a static-secret pass-through.

---

### Task 8: Full backend suite verification

Run: `cd api && npm test && npm run test:integration`. Expected: all green, optional live-shape test skipped without env vars.

---

## Self-Review Notes

- **This is the least field-confirmed of the five connector plans in this repo** — Task 0 is doing more work here than in any sibling plan, because the authoritative reference (a per-install Swagger UI) was genuinely unreachable during planning, not merely under-documented like Commvault's REST API. Every endpoint path and field name in Tasks 2–4 is a labeled placeholder, not a researched guess with partial confirmation.
- **Keycloak token exchange is new infrastructure for this codebase** — no other connector performs a live OAuth2 token-endpoint POST as part of credential resolution (Azure's `ClientSecretCredential` defers the actual token exchange into the SDK; Commvault and Carbonite Core Endpoint use static pre-generated secrets). Budget extra review time for `credentials.js` specifically, and confirm Task 0's `.well-known/openid-configuration` step before trusting the hardcoded token-endpoint URL shape.
- **Three distinct `oauth2` connectors now imply three distinct frontend config shapes** (Azure's `{tenantId, subscriptionId}`, Acronis's `{datacenterUrl}`, this plan's `{apiDomain, keycloakRealm}`) — if this connector ships alongside Acronis, the provider-keyed branching refactor the Acronis plan already identified as required becomes even more clearly the right call, not a coincidence of one extra provider.
- **Do not confuse this plan with the sibling Carbonite Core Endpoint plan** — same vendor, unrelated products, unrelated APIs (OData/REST + Keycloak here vs. SOAP + JWT there), unrelated connector `key` (`carbonite-server` vs `carbonite`). A customer must be confirmed as running Server Backup, not Core Endpoint Backup, before this plan is the right one to execute.

### Critical Files for Implementation
- `api/src/connectors/commvault/` — closest existing pattern for a non-SDK, `fetch`-based, Task-0-gated connector
- `api/src/connectors/azure/credentials.js` — closest existing pattern for `oauth2`-typed credential resolution, despite the different token-acquisition mechanics
- `api/src/utils/collectionRunner.js` — the generic contract every connector must satisfy
- `api/src/connectors/registry.js` — registration point
- `api/src/routes/integrations.js` — `setup-info` route pattern
- `init.sql` — "Automated Evidence Collection" section, existing seed blocks to mirror exactly

