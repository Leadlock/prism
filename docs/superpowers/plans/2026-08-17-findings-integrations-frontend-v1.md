# Findings & Integrations Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend UI (plus the handful of small backend endpoints it needs) so a company admin can connect an AWS account, run security checks, and triage the resulting findings — all currently reachable only via raw API calls.

**Architecture:** Six new/modified screens consuming the already-shipped `/api/integrations/*` and `/api/findings/*` backend (from `2026-08-17-aws-evidence-collection-v1.md`), plus three small backend additions (a connector catalog endpoint, a collection-history endpoint, and two data joins) that the UI needs but the backend plan didn't produce because it was scoped API-only. Every new page follows this codebase's existing self-contained-page convention exactly — no new layout/routing/state-management abstractions.

**Tech Stack:** React 18 (function components, hooks, no Redux/Context), react-router-dom v6 (inline ternary route guards), the existing `apiFetch`/`apiUpload` wrapper (`web/src/api/client.js`), Express + raw `pg` SQL on the backend, Vitest (API) + Playwright/chromium (web e2e, API mocked via `page.route`).

**Spec:** §J ("UI / UX") of the "Automated Evidence Architecture" artifact (published 2026-08-17), read against the actual shipped backend from `docs/superpowers/plans/2026-08-17-aws-evidence-collection-v1.md`. This plan implements all six §J screens except the OAuth auth-flow variant (no OAuth-based connector exists yet — AWS is IAM-role/access-key only) and per-test enable/disable toggles + cadence selector (both require scheduling, explicitly deferred to Phase 2 in the backend plan's §I).

## Global Constraints

- Every new/modified backend query must filter on `company_id = req.user.companyId` — this codebase's only tenant-isolation mechanism (no ORM/RLS). Non-negotiable, verified in every task below.
- No new routing abstraction: new routes are added as additional inline-ternary `<Route>` entries in `web/src/App.jsx`'s existing `<Routes>` block, matching every existing route exactly (`isAuthenticated && <role check> ? <Page {...authProps} /> : <Navigate .../>`).
- No shared page-shell/layout component: `AppShell.jsx`/`AppSidebar.jsx` are confirmed dead code (nothing imports them) and must not be revived. Every new page renders its own self-contained header, matching `AuditorPanel.jsx`'s pattern exactly (kicker/title/domain + `admin-actions` button row with a theme toggle and `onLogout`).
- No new HTTP client: every API call goes through `apiFetch(path, { token, method, body })` imported directly from `../api/client.js`, matching the calling convention used throughout `AuditorPanel.jsx`/`EvidenceVault.jsx`.
- No new CSS framework or component library: reuse `.admin-container`/`.admin-card`/`.admin-header`/`.admin-table`/`.admin-row`/`.form-group`/`.btn-primary`/`.btn-ghost`/`.modal-backdrop`/`.pill-iso`/`.dash-*` classes already defined in `web/src/styles.css`. Add new CSS only where genuinely no existing class fits (documented per-task below).
- Role gating on the frontend must mirror the backend's actual allow-lists exactly (verified against `api/src/routes/integrations.js` and `api/src/routes/findings.js`, not assumed): integration management (create connection, credentials, run, revoke, and the new catalog/runs endpoints) is `ADMIN`/`LEAD` (+`AUDITOR` read-only, granted implicitly by `requireReadOnly`); findings are readable by `ADMIN`/`LEAD`/`CONTRIBUTOR`/`VIEWER` (+`AUDITOR`), writable (`PUT`/`promote`) by `ADMIN`/`LEAD` only.
- AWS remains the only registered connector (`api/src/connectors/registry.js`). The "Add Integration" wizard must be driven by the `integrations` catalog table (not hardcode "aws"), but only needs working forms for the two `auth_type` values AWS actually supports today — `iam_role` and `access_key` — matching `api/src/connectors/aws/credentials.js`'s `resolveAwsCredentials()` exactly.
- This codebase has no frontend unit-test runner — the only frontend test mechanism is Playwright e2e (`web/tests/*.spec.js`), which mocks the API per-test via `page.route`. Every frontend task's test step follows that existing convention (see `web/tests/dashboard.spec.js` as the reference pattern), not vitest/RTL.

---

## File Structure

**Backend (small additions to already-shipped files):**
- Modify: `api/src/routes/integrations.js` — add `GET /catalog` and `GET /:id/runs`
- Modify: `api/src/routes/vault.js` — add `?source=automated` filter + freshness join to `GET /`
- Modify: `api/src/routes/dashboard.js` — add an `automatedCoverage` aggregate query + response key
- Modify: `api/src/utils/collectionRunner.js` — generate, vault-store, and auto-link a real PDF evidence file for each finding
- Modify: `init.sql` — `findings.evidence_vault_id`, `findings.payload_hash`
- Create: `api/src/utils/findingEvidencePdf.js` — `pdfkit`-based finding evidence PDF renderer

**Frontend (new pages + modifications):**
- Create: `web/src/pages/IntegrationsSettings.jsx` — catalog grid, connection list, "Add Integration" wizard
- Create: `web/src/pages/ConnectionDetail.jsx` — status, Run Now, rotate credential, revoke, collection history
- Create: `web/src/pages/Findings.jsx` — findings inbox with filters, status transitions, promote-to-action, vault-backed Evidence PDF download, bulk Findings PDF export
- Modify: `web/src/pages/EvidenceVault.jsx` — add an "Automated" tab
- Modify: `web/src/pages/Dashboard.jsx` — add an "Automated Coverage" tile + nav entries
- Modify: `web/src/App.jsx` — three new routes + three new imports

**Tests:**
- Modify: `api/src/__tests__/integration/integrations.test.js` — catalog + runs endpoint coverage
- Modify: `api/src/__tests__/integration/vault.test.js` — automated-source filter coverage
- Create: `api/src/__tests__/integration/dashboardAutomatedCoverage.test.js`
- Create: `api/src/__tests__/findingEvidencePdf.test.js`
- Modify: `api/src/__tests__/integration/collectionRunner.test.js` — vault-backed finding PDF, auto-linking, and dedup coverage
- Create: `web/tests/integrations.spec.js`
- Create: `web/tests/connection-detail.spec.js`
- Create: `web/tests/findings.spec.js` — inbox coverage plus vault-backed Evidence PDF download and bulk Export PDF coverage
- Modify: `web/tests/evidence.spec.js` — Automated tab coverage
- Modify: `web/tests/dashboard.spec.js` — Automated Coverage tile coverage

---

### Task 1: Backend — connector catalog endpoint

**Files:**
- Modify: `api/src/routes/integrations.js`
- Test: `api/src/__tests__/integration/integrations.test.js`

**Interfaces:**
- Consumes: `query`/`mapRows` (existing), `authenticate`/`requireReadOnly` (existing).
- Produces: `GET /api/integrations/catalog` → array of `integrations` catalog rows (camelCased: `id, key, name, category, authType, status, createdAt`).

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/integrations.test.js` (new `describe` block, place it above `describe("GET /", ...)` or anywhere at the top level alongside the existing blocks):

```js
describe("GET /api/integrations/catalog", () => {
  test("lists available connector types", async () => {
    const company = await createCompany({ domain: "catalog1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const aws = res.body.find(c => c.key === "aws");
    expect(aws).toBeDefined();
    expect(aws.authType).toBe("iam_role");
    expect(aws.status).toBe("active");
  });

  test("is readable by LEAD but not by CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "catalog2.com" });
    const lead = await createUser(company.id, "LEAD");
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const leadRes = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${lead.token}`);
    expect(leadRes.status).toBe(200);

    const contributorRes = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${contributor.token}`);
    expect(contributorRes.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: FAIL — `GET /api/integrations/catalog` doesn't exist, so Express falls through to `GET /:id` with `id = "catalog"` (`parseInt("catalog")` is `NaN`), which 404s with `{"error":"Connection not found"}` instead of returning the catalog.

- [ ] **Step 3: Write the implementation**

In `api/src/routes/integrations.js`, insert a new route **before** the existing `router.get("/:id", ...)` handler (ordering matters — `/catalog` must not be shadowed by the `:id` param route):

```js
router.get("/catalog", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(`SELECT * FROM integrations WHERE status != 'coming_soon' ORDER BY name`);
  res.json(mapRows(result));
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/integrations.js api/src/__tests__/integration/integrations.test.js
git commit -m "feat: add integrations catalog endpoint"
```

---

### Task 2: Backend — collection history endpoint

**Files:**
- Modify: `api/src/routes/integrations.js`
- Test: `api/src/__tests__/integration/integrations.test.js`

**Interfaces:**
- Consumes: `query`/`mapRows` (existing), `authenticate`/`requireReadOnly` (existing).
- Produces: `GET /api/integrations/:id/runs?limit=N` → array of `evidence_collection_runs` rows (camelCased) for that connection, newest (`started_at DESC`) first, capped at `limit` (default 20, max 100).

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/integrations.test.js`:

```js
describe("GET /api/integrations/:id/runs", () => {
  test("lists collection runs for a connection, newest first", async () => {
    const company = await createCompany({ domain: "runs1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = connRes.rows[0].id;
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at, finished_at)
       VALUES ($1, $2, 'manual', 'success', 7, 7, 0, NOW() - interval '2 hours', NOW() - interval '1 hour 55 minutes')`,
      [company.id, connectionId]
    );
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at, finished_at)
       VALUES ($1, $2, 'manual', 'partial_failure', 7, 5, 2, NOW() - interval '1 hour', NOW() - interval '55 minutes')`,
      [company.id, connectionId]
    );

    const res = await request(app).get(`/api/integrations/${connectionId}/runs`).set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].status).toBe("partial_failure");
    expect(res.body[1].status).toBe("success");
  });

  test("returns 404 for a connection belonging to a different company", async () => {
    const companyA = await createCompany({ domain: "runs2a.com" });
    const companyB = await createCompany({ domain: "runs2b.com" });
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [companyA.id]
    );
    const adminB = await createUser(companyB.id, "ADMIN");

    const res = await request(app).get(`/api/integrations/${connRes.rows[0].id}/runs`).set("Authorization", `Bearer ${adminB.token}`);
    expect(res.status).toBe(404);
  });

  test("respects a limit query param", async () => {
    const company = await createCompany({ domain: "runs3.com" });
    const admin = await createUser(company.id, "ADMIN");
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = connRes.rows[0].id;
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at)
         VALUES ($1, $2, 'manual', 'success', 7, 7, 0, NOW() - ($3 || ' minutes')::interval)`,
        [company.id, connectionId, String(i)]
      );
    }

    const res = await request(app).get(`/api/integrations/${connectionId}/runs?limit=2`).set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: FAIL — no route matches `GET /:id/runs` (Express falls through to the catch-all 404 since it's a two-segment path with no matching two-segment route registered).

- [ ] **Step 3: Write the implementation**

In `api/src/routes/integrations.js`, add this route anywhere after the `GET /:id` handler (its literal `/runs` suffix means Express won't confuse it with `POST /:id/run` — different HTTP method and different literal suffix):

```js
router.get("/:id/runs", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const connResult = await query(
    `SELECT id FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  if (connResult.rows.length === 0) return res.status(404).json({ error: "Connection not found" });

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const result = await query(
    `SELECT * FROM evidence_collection_runs WHERE connection_id = $1 AND company_id = $2 ORDER BY started_at DESC LIMIT $3`,
    [connectionId, req.user.companyId, limit]
  );
  res.json(mapRows(result));
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: PASS, all 3 new tests plus the existing suite.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/integrations.js api/src/__tests__/integration/integrations.test.js
git commit -m "feat: add collection history endpoint"
```

---

### Task 3: Backend — automated-evidence filter on the vault

**Files:**
- Modify: `api/src/routes/vault.js`
- Test: `api/src/__tests__/integration/vault.test.js`

**Interfaces:**
- Consumes: `query`/`mapRows` (existing).
- Produces: `GET /api/vault?source=automated` → same shape as today's `GET /api/vault` response, plus two new fields on each row when `source=automated` is passed: `freshnessStatus` (`'fresh'|'stale'|'expired'|null`) and `testKey` (`string|null`) — sourced from a `LEFT JOIN` to `automated_evidence_items`.

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/vault.test.js`, inside the existing `describe("GET /api/vault", ...)` block:

```js
  test("source=automated returns only automated items with freshness status", async () => {
    const company = await createCompany({ domain: "vaultsrc1.com" });
    const admin = await createUser(company.id, "ADMIN");

    // A manually-uploaded item (should be excluded)
    await request(app)
      .post("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", TEXT_FILE, { filename: "manual.txt", contentType: "text/plain" })
      .field("title", "Manual Upload");

    // An automated item, inserted the same way collectionRunner.js does
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const vaultRes = await query(
      `INSERT INTO evidence_vault (company_id, title, description, uploaded_by) VALUES ($1, $2, $3, 'automated') RETURNING *`,
      [company.id, "aws.iam.mfa_enforced — account", "All IAM users have MFA enabled"]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, evidence_vault_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, $3, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'fresh', NOW())`,
      [company.id, connRes.rows[0].id, vaultRes.rows[0].id]
    );

    const res = await request(app).get("/api/vault?source=automated").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe("aws.iam.mfa_enforced — account");
    expect(res.body[0].freshnessStatus).toBe("fresh");
    expect(res.body[0].testKey).toBe("aws.iam.mfa_enforced");
  });

  test("without source param, still returns both manual and automated items", async () => {
    const company = await createCompany({ domain: "vaultsrc2.com" });
    const admin = await createUser(company.id, "ADMIN");

    await request(app)
      .post("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", TEXT_FILE, { filename: "manual.txt", contentType: "text/plain" })
      .field("title", "Manual Upload");

    const res = await request(app).get("/api/vault").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    // pg returns SQL NULL for the outer-joined aei.status column on a manual-only
    // row, and JSON.stringify keeps explicit `null` values (only `undefined` is
    // dropped) — so this is `null`, not an absent/undefined key.
    expect(res.body[0].freshnessStatus).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- vault.test`
Expected: FAIL — `?source=automated` is currently ignored (no filter applied), so the first new test gets both the manual and automated item back (`res.body.length` is `2`, not `1`), and `freshnessStatus`/`testKey` are `undefined` on every row.

- [ ] **Step 3: Write the implementation**

In `api/src/routes/vault.js`, replace the `GET /` handler:

```js
router.get("/", authenticate, requireVaultPin, requireReadOnly(VAULT_READERS), asyncHandler(async (req, res) => {
  const { search, questId, source } = req.query;
  const cid = req.user.companyId;
  const values = [cid];
  let joinClause = "";
  let conditions = "ev.company_id = $1";

  if (questId) {
    values.push(questId);
    joinClause += `JOIN question_evidence qe_f ON qe_f.vault_id = ev.id AND qe_f.company_id = $1 AND qe_f.quest_id = $${values.length}`;
  }

  if (search) {
    values.push(`%${search}%`);
    const p = values.length;
    conditions += ` AND (ev.title ILIKE $${p} OR ev.description ILIKE $${p})`;
  }

  if (source === "automated") {
    conditions += ` AND aei.id IS NOT NULL`;
  }

  const result = await query(
    `SELECT ev.*, COUNT(qe.id)::INT AS linked_count,
            EXISTS (
              SELECT 1 FROM question_evidence qe2
              JOIN assessments a ON a.quest_id = qe2.quest_id AND a.company_id = qe2.company_id AND a.review_status = 'FINISHED'
              WHERE qe2.vault_id = ev.id
            ) AS locked,
            aei.status AS freshness_status,
            aei.test_key
     FROM evidence_vault ev
     ${joinClause}
     LEFT JOIN question_evidence qe ON qe.vault_id = ev.id
     LEFT JOIN automated_evidence_items aei ON aei.evidence_vault_id = ev.id AND aei.company_id = ev.company_id
     WHERE ${conditions}
     GROUP BY ev.id, aei.status, aei.test_key
     ORDER BY ev.uploaded_at DESC`,
    values
  );
  res.json(mapRows(result));
}));
```

Note: `freshness_status`/`test_key` are SQL `NULL` for manually-uploaded rows (no matching `automated_evidence_items` row) — `mapRows` always includes the key with value `null` rather than omitting it, and `res.json()` serializes that `null` as-is (only `undefined` values are dropped by `JSON.stringify`), which is what the test's `toBeNull()` assertion above expects.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- vault.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/vault.js api/src/__tests__/integration/vault.test.js
git commit -m "feat: add automated-source filter with freshness to vault listing"
```

---

### Task 4: Backend — dashboard automated-coverage aggregate

**Files:**
- Modify: `api/src/routes/dashboard.js`
- Test: `api/src/__tests__/integration/dashboardAutomatedCoverage.test.js`

**Interfaces:**
- Consumes: `query` (existing), the existing `cid`/`hasFilter`/`filteredQuestIds`/`totalQ` variables already computed earlier in the `GET /` handler.
- Produces: adds `automatedCoverage: { count, total }` to the existing `GET /api/dashboard` JSON response, following the exact same shape as the existing `scoreEligible` key.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/integration/dashboardAutomatedCoverage.test.js`:

```js
import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

describe("GET /api/dashboard — automatedCoverage", () => {
  test("counts distinct controls satisfied by at least one fresh automated evidence item", async () => {
    const company = await createCompany({ domain: "dashauto1.com" });
    const admin = await createUser(company.id, "ADMIN");

    // One question mapped to a test with fresh automated evidence
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, question, iso_reference, control_area)
       VALUES ($1, 'Q1', 'M1', 'MFA enforced?', 'A.9.4.2', 'Access control')`,
      [company.id]
    );
    // A second question with no automated coverage at all
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, question, iso_reference, control_area)
       VALUES ($1, 'Q2', 'M1', 'Backups tested?', 'A.17.1.3', 'Continuity')`,
      [company.id]
    );

    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'fresh', NOW())`,
      [company.id, connRes.rows[0].id]
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.automatedCoverage.count).toBe(1);
    expect(res.body.automatedCoverage.total).toBe(2);
  });

  test("does not count a stale automated evidence item", async () => {
    const company = await createCompany({ domain: "dashauto2.com" });
    const admin = await createUser(company.id, "ADMIN");

    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, question, iso_reference, control_area)
       VALUES ($1, 'Q1', 'M1', 'MFA enforced?', 'A.9.4.2', 'Access control')`,
      [company.id]
    );
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'stale', NOW())`,
      [company.id, connRes.rows[0].id]
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.automatedCoverage.count).toBe(0);
    expect(res.body.automatedCoverage.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- dashboardAutomatedCoverage.test`
Expected: FAIL — `res.body.automatedCoverage` is `undefined`, so `.count`/`.total` reads throw a `TypeError`.

- [ ] **Step 3: Write the implementation**

In `api/src/routes/dashboard.js`, find the `Promise.all([...])` array whose destructured variable list starts with `const [totalQ, assessed, finished, ...`. Add `automatedCoverage` to the end of the destructured variable list:

```js
const [totalQ, assessed, finished, answerDist, moduleCompletion, evidenceCoverage, actionStatus, maturityDist, overdueQuestions, notesCount, reviewerNotesCount, noNotesCount, openRequests, overdueRequests, completedRequests, requestsByUser, vaultTotalVersions, vaultUpdatedThisMonth, vaultLatestModified, scoreEligible, automatedCoverage] = await Promise.all([
```

Then add a new query as the last element of that same array, immediately after the existing `scoreEligible` query (the one with the comment `// Score-eligible controls (IMPLEMENTED, maturity >= 3, score_eligible = true)`):

```js
    // Automated coverage: controls satisfied by at least one fresh automated evidence item
    query(
      hasFilter
        ? `SELECT COUNT(DISTINCT q.quest_id)::INT AS n
           FROM questions q
           JOIN test_control_mappings tcm ON tcm.iso_reference = q.iso_reference
           JOIN automated_evidence_items aei ON aei.test_key = tcm.test_key AND aei.company_id = q.company_id AND aei.status = 'fresh'
           WHERE q.company_id = $1 AND q.quest_id = ANY($2)`
        : `SELECT COUNT(DISTINCT q.quest_id)::INT AS n
           FROM questions q
           JOIN test_control_mappings tcm ON tcm.iso_reference = q.iso_reference
           JOIN automated_evidence_items aei ON aei.test_key = tcm.test_key AND aei.company_id = q.company_id AND aei.status = 'fresh'
           WHERE q.company_id = $1`,
      hasFilter ? [cid, filteredQuestIds] : [cid]
    )
```

Finally, in the response object (the block starting `scoreEligible: { count: parseInt(scoreEligible.rows[0]?.n) || 0, ...`), add a new key immediately after `scoreEligible`:

```js
    scoreEligible: {
      count: parseInt(scoreEligible.rows[0]?.n) || 0,
      total: hasFilter ? filteredQuestIds.length : parseInt(totalQ.rows[0].n)
    },
    automatedCoverage: {
      count: parseInt(automatedCoverage.rows[0]?.n) || 0,
      total: hasFilter ? filteredQuestIds.length : parseInt(totalQ.rows[0].n)
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- dashboardAutomatedCoverage.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/dashboard.js api/src/__tests__/integration/dashboardAutomatedCoverage.test.js
git commit -m "feat: add automated coverage aggregate to dashboard"
```

---

### Task 5: Frontend — Settings → Integrations page

**Files:**
- Create: `web/src/pages/IntegrationsSettings.jsx`
- Modify: `web/src/App.jsx`
- Modify: `web/src/pages/Dashboard.jsx`
- Test: `web/tests/integrations.spec.js`

**Interfaces:**
- Consumes: `apiFetch` (existing), `GET /api/integrations/catalog` (Task 1), `GET /api/integrations` (existing, lists connections), `POST /api/integrations` (existing, creates a connection), `POST /api/integrations/:id/credentials` (existing, stores/tests/rotates credentials).
- Produces: route `/settings/integrations`, a "Settings" entry point reachable from the Dashboard nav menu, and a per-connection `onClick` that will navigate to `/settings/integrations/:id` (built by Task 6).

- [ ] **Step 1: Write the failing test**

Create `web/tests/integrations.spec.js`:

```js
import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const CATALOG = [
  { id: 1, key: "aws", name: "Amazon Web Services", category: "cloud", authType: "iam_role", status: "active" },
];

const CONNECTIONS = [
  { id: 10, integrationKey: "aws", name: "Prod AWS", status: "connected", lastRunAt: "2026-08-17T10:00:00Z", lastRunStatus: "success" },
];

test.describe("Integrations settings", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("lists the AWS catalog entry and an existing connection", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page.getByText("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Prod AWS")).toBeVisible();
    await expect(page.getByText("connected")).toBeVisible();
  });

  test("Add Integration wizard creates a connection and stores credentials", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));

    // The page reloads the connection list (GET /api/integrations) right after
    // creating one, so the mock must reflect that a connection now exists —
    // a static empty-array response would make the final assertion below fail.
    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 11, integrationKey: "aws", name: "New AWS", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 11, integrationKey: "aws", name: "New AWS", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/11/credentials", r =>
      r.fulfill({ json: { id: 11, integrationKey: "aws", name: "New AWS", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "+ Add Integration" }).click();
    await page.getByRole("button", { name: "Amazon Web Services" }).click();

    await page.getByLabel("Connection name").fill("New AWS");
    await page.getByLabel("Role ARN").fill("arn:aws:iam::123456789012:role/prism-readonly");
    await page.getByLabel("External ID").fill("prism-ext-id");

    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq.postDataJSON().name).toBe("New AWS");

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("non-admin/lead roles cannot reach the page", async ({ page }) => {
    await setAuth(page, "CONTRIBUTOR");
    await page.goto("/settings/integrations");
    await expect(page).not.toHaveURL(/\/settings\/integrations/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/integrations.spec.js`
Expected: FAIL — `/settings/integrations` route doesn't exist yet (redirects via the App.jsx catch-all), so none of the page content renders.

- [ ] **Step 3: Write the implementation**

Create `web/src/pages/IntegrationsSettings.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";

const STATUS_COLOR = {
  connected: "var(--green)",
  pending:   "var(--text3)",
  error:     "var(--red)",
  revoked:   "var(--text3)",
};

function StatusPill({ status }) {
  const color = STATUS_COLOR[status] || "var(--text3)";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color,
      background: `${color}18`, padding: "2px 8px",
      borderRadius: 20, border: `1px solid ${color}40`
    }}>
      {status}
    </span>
  );
}

const TRUST_POLICY_TEMPLATE = (externalId) => JSON.stringify({
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { AWS: "<YOUR PRISM DEPLOYMENT'S AWS PRINCIPAL ARN — ask your Prism admin>" },
    Action: "sts:AssumeRole",
    Condition: { StringEquals: { "sts:ExternalId": externalId || "<external-id>" } }
  }]
}, null, 2);

function AddIntegrationWizard({ catalog, token, onClose, onCreated }) {
  const [step, setStep] = useState("pick"); // "pick" | "configure"
  const [provider, setProvider] = useState(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [roleArn, setRoleArn] = useState("");
  const [externalId, setExternalId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [authType, setAuthType] = useState("iam_role");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pickProvider = (p) => {
    setProvider(p);
    setAuthType(p.authType === "access_key" ? "access_key" : "iam_role");
    setStep("configure");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const config = authType === "iam_role" ? { region, roleArn } : { region };
      const secret = authType === "iam_role"
        ? { externalId }
        : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };

      const connection = await apiFetch("/api/integrations", {
        token, method: "POST",
        body: JSON.stringify({ integrationKey: provider.key, name, config })
      });

      const updated = await apiFetch(`/api/integrations/${connection.id}/credentials`, {
        token, method: "POST",
        body: JSON.stringify({ authType, secret })
      });

      onCreated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-title">Add Integration</div>

        {step === "pick" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {catalog.length === 0 && <p style={{ color: "var(--text3)" }}>No connectors available yet.</p>}
            {catalog.map(c => (
              <button
                key={c.key}
                className="btn btn-ghost"
                style={{ justifyContent: "flex-start", textAlign: "left" }}
                disabled={c.status !== "active"}
                onClick={() => pickProvider(c)}
              >
                {c.name} {c.status !== "active" && <span style={{ color: "var(--text3)", fontSize: 11 }}>({c.status})</span>}
              </button>
            ))}
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
          </div>
        )}

        {step === "configure" && (
          <form onSubmit={handleSubmit}>
            {error && <p className="error-text">{error}</p>}
            <div className="form-group">
              <label htmlFor="conn-name">Connection name</label>
              <input id="conn-name" required value={name} onChange={e => setName(e.target.value)} />
            </div>

            {provider.authType === "access_key" ? (
              <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                {["iam_role", "access_key"].map(t => (
                  <button type="button" key={t}
                    className="btn btn-ghost"
                    style={{ fontWeight: authType === t ? 700 : 400, borderBottom: authType === t ? "2px solid var(--accent)" : "none" }}
                    onClick={() => setAuthType(t)}
                  >
                    {t === "iam_role" ? "IAM Role" : "Access Keys"}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="form-group">
              <label htmlFor="conn-region">Region</label>
              <input id="conn-region" value={region} onChange={e => setRegion(e.target.value)} />
            </div>

            {authType === "iam_role" ? (
              <>
                <div className="form-group">
                  <label htmlFor="conn-role-arn">Role ARN</label>
                  <input id="conn-role-arn" required value={roleArn} onChange={e => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/prism-readonly" />
                </div>
                <div className="form-group">
                  <label htmlFor="conn-external-id">External ID</label>
                  <input id="conn-external-id" required value={externalId} onChange={e => setExternalId(e.target.value)} />
                </div>
                <details style={{ marginBottom: 12 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text2)" }}>Trust policy JSON</summary>
                  <pre style={{ fontSize: 11, overflowX: "auto", padding: 10, background: "var(--bg3)", borderRadius: 6 }}>
                    {TRUST_POLICY_TEMPLATE(externalId)}
                  </pre>
                </details>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label htmlFor="conn-access-key">Access key ID</label>
                  <input id="conn-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="conn-secret-key">Secret access key</label>
                  <input id="conn-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="conn-session-token">Session token (optional)</label>
                  <input id="conn-session-token" value={sessionToken} onChange={e => setSessionToken(e.target.value)} />
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Connecting…" : "Connect"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setStep("pick")}>Back</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function IntegrationsSettings({ token, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showWizard, setShowWizard] = useState(false);

  const load = useCallback(async () => {
    const [catalogData, connData] = await Promise.all([
      apiFetch("/api/integrations/catalog", { token }),
      apiFetch("/api/integrations", { token }),
    ]);
    setCatalog(catalogData || []);
    setConnections(connData || []);
  }, [token]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  const handleCreated = async () => {
    setShowWizard(false);
    await load();
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      {showWizard && (
        <AddIntegrationWizard
          catalog={catalog}
          token={token}
          onClose={() => setShowWizard(false)}
          onCreated={handleCreated}
        />
      )}

      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Settings — Integrations</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/findings")}>Findings</button>
            <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <section className="admin-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>Connections</h2>
            <button className="btn btn-primary" onClick={() => setShowWizard(true)}>+ Add Integration</button>
          </div>
          <div className="admin-table">
            <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
              <span>Name</span>
              <span>Provider</span>
              <span>Status</span>
              <span>Last run</span>
            </div>
            {connections.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No connections yet — add one to get started.</span></div>
            )}
            {connections.map(c => (
              <div
                key={c.id}
                className="admin-row"
                style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr", cursor: "pointer" }}
                onClick={() => navigate(`/settings/integrations/${c.id}`)}
              >
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{c.integrationKey}</span>
                <span><StatusPill status={c.status} /></span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : "Never"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-section">
          <h2>Available connectors</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {catalog.map(c => (
              <div key={c.key} className="card" style={{ padding: 16, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{c.category}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
```

Modify `web/src/App.jsx`:

1. Add the import alongside the other page imports (after `import EvidenceRequests from "./pages/EvidenceRequests.jsx";`):

```jsx
import IntegrationsSettings from "./pages/IntegrationsSettings.jsx";
```

2. Add the route inside the `<Routes>` block, immediately after the `/requests` route (before the catch-all `<Route path="*" ...>`):

```jsx
{/* Integrations Settings — ADMIN, LEAD */}
<Route
  path="/settings/integrations"
  element={
    isAuthenticated && isLeadOrAdmin
      ? <IntegrationsSettings {...authProps} />
      : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
  }
/>
```

Modify `web/src/pages/Dashboard.jsx` — add a nav entry to the `⋮` overflow menu, immediately after the existing `Review` button (`{isLeadOrAdmin && <button ... onClick={() => {...; navigate("/review");}}>Review</button>}`) and before the `<div style={{ height: 1, ...` separator:

```jsx
{isLeadOrAdmin && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/settings/integrations"); }}>Integrations</button>}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/integrations.spec.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/IntegrationsSettings.jsx web/src/App.jsx web/src/pages/Dashboard.jsx web/tests/integrations.spec.js
git commit -m "feat: add Settings → Integrations page with connector catalog and add wizard"
```

---

### Task 6: Frontend — Connection Detail page

**Files:**
- Create: `web/src/pages/ConnectionDetail.jsx`
- Modify: `web/src/App.jsx`
- Test: `web/tests/connection-detail.spec.js`

**Interfaces:**
- Consumes: `apiFetch` (existing), `GET /api/integrations/:id` (existing), `GET /api/integrations/:id/runs` (Task 2), `POST /api/integrations/:id/run` (existing), `POST /api/integrations/:id/credentials` (existing, used for credential rotation), `DELETE /api/integrations/:id` (existing).
- Produces: route `/settings/integrations/:id`, linked from Task 5's connection row.

- [ ] **Step 1: Write the failing test**

Create `web/tests/connection-detail.spec.js`:

```js
import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const CONNECTION = {
  id: 10, integrationKey: "aws", name: "Prod AWS", status: "connected",
  lastRunAt: "2026-08-17T10:00:00Z", lastRunStatus: "success",
};

const RUNS = [
  { id: 1, status: "success", triggerType: "manual", testsRun: 7, testsPassed: 7, testsFailed: 0, startedAt: "2026-08-17T10:00:00Z", finishedAt: "2026-08-17T10:01:00Z" },
  { id: 2, status: "partial_failure", triggerType: "manual", testsRun: 7, testsPassed: 5, testsFailed: 2, startedAt: "2026-08-16T10:00:00Z", finishedAt: "2026-08-16T10:01:00Z" },
];

test.describe("Connection detail", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("shows status, last run, and collection history", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: RUNS }));

    await page.goto("/settings/integrations/10");

    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("connected")).toBeVisible();
    await expect(page.getByText("partial_failure")).toBeVisible();
  });

  test("Run Now triggers a collection run", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: RUNS }));
    await page.route("**/api/integrations/10/run", r => r.fulfill({ json: { id: 3, status: "success", testsRun: 7, testsPassed: 7, testsFailed: 0 } }));

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    const [runReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10/run") && req.method() === "POST"),
      page.getByRole("button", { name: "Run Now" }).click(),
    ]);
    expect(runReq.method()).toBe("POST");
  });

  test("Revoke prompts confirmation and calls DELETE", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    page.once("dialog", d => d.accept());
    const [delReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10") && req.method() === "DELETE"),
      page.getByRole("button", { name: "Revoke" }).click(),
    ]);
    expect(delReq.method()).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/connection-detail.spec.js`
Expected: FAIL — `/settings/integrations/:id` route doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `web/src/pages/ConnectionDetail.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";

const RUN_STATUS_COLOR = {
  success: "var(--green)",
  partial_failure: "var(--amber)",
  failed: "var(--red)",
  running: "var(--text3)",
};

function RotateCredentialModal({ connectionId, token, onClose, onRotated }) {
  const [authType, setAuthType] = useState("iam_role");
  const [roleArn, setRoleArn] = useState("");
  const [externalId, setExternalId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const secret = authType === "iam_role" ? { externalId } : { accessKeyId, secretAccessKey };
      const updated = await apiFetch(`/api/integrations/${connectionId}/credentials`, {
        token, method: "POST",
        body: JSON.stringify({ authType, secret })
      });
      onRotated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Rotate credentials</div>
        <form onSubmit={handleSubmit}>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {["iam_role", "access_key"].map(t => (
              <button type="button" key={t}
                className="btn btn-ghost"
                style={{ fontWeight: authType === t ? 700 : 400, borderBottom: authType === t ? "2px solid var(--accent)" : "none" }}
                onClick={() => setAuthType(t)}
              >
                {t === "iam_role" ? "IAM Role" : "Access Keys"}
              </button>
            ))}
          </div>
          {authType === "iam_role" ? (
            <div className="form-group">
              <label htmlFor="rotate-external-id">External ID</label>
              <input id="rotate-external-id" required value={externalId} onChange={e => setExternalId(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="rotate-access-key">Access key ID</label>
                <input id="rotate-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="rotate-secret-key">Secret access key</label>
                <input id="rotate-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Rotating…" : "Rotate"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ConnectionDetail({ token, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [connection, setConnection] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [showRotate, setShowRotate] = useState(false);

  const load = useCallback(async () => {
    const [connData, runsData] = await Promise.all([
      apiFetch(`/api/integrations/${id}`, { token }),
      apiFetch(`/api/integrations/${id}/runs`, { token }),
    ]);
    setConnection(connData);
    setRuns(runsData || []);
  }, [token, id]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  const handleRunNow = async () => {
    setError("");
    setRunning(true);
    try {
      await apiFetch(`/api/integrations/${id}/run`, { token, method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm("Revoke this connection? Its credentials will be permanently shredded.")) return;
    try {
      await apiFetch(`/api/integrations/${id}`, { token, method: "DELETE" });
      navigate("/settings/integrations");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRotated = async () => {
    setShowRotate(false);
    await load();
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  if (!connection) {
    return <div className="admin-container"><div className="admin-card"><p className="error-text">{error || "Connection not found"}</p></div></div>;
  }

  return (
    <div className="admin-container">
      {showRotate && (
        <RotateCredentialModal
          connectionId={id}
          token={token}
          onClose={() => setShowRotate(false)}
          onRotated={handleRotated}
        />
      )}

      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Connection detail</p>
            <h1>{connection.name}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/settings/integrations")}>Back</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <section className="admin-section">
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Status</div>
              <div style={{ fontWeight: 600 }}>{connection.status}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Last run</div>
              <div style={{ fontWeight: 600 }}>
                {connection.lastRunAt ? new Date(connection.lastRunAt).toLocaleString() : "Never"}
                {connection.lastRunStatus && <span style={{ marginLeft: 6, color: RUN_STATUS_COLOR[connection.lastRunStatus] || "var(--text3)" }}>({connection.lastRunStatus})</span>}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary" disabled={running} onClick={handleRunNow}>
              {running ? "Running…" : "Run Now"}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowRotate(true)}>Rotate credentials</button>
            <button className="btn btn-ghost" style={{ color: "var(--red)" }} onClick={handleRevoke}>Revoke</button>
          </div>
        </section>

        <section className="admin-section">
          <h2>Collection history</h2>
          <div className="admin-table">
            <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
              <span>Started</span>
              <span>Trigger</span>
              <span>Status</span>
              <span>Passed</span>
              <span>Failed</span>
            </div>
            {runs.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No collection runs yet.</span></div>
            )}
            {runs.map(r => (
              <div key={r.id} className="admin-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
                <span style={{ fontSize: 12 }}>{new Date(r.startedAt).toLocaleString()}</span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{r.triggerType}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: RUN_STATUS_COLOR[r.status] || "var(--text3)" }}>{r.status}</span>
                <span style={{ fontSize: 12, color: "var(--green)" }}>{r.testsPassed}</span>
                <span style={{ fontSize: 12, color: r.testsFailed > 0 ? "var(--red)" : "var(--text3)" }}>{r.testsFailed}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
```

Modify `web/src/App.jsx`:

1. Add the import after `import IntegrationsSettings from "./pages/IntegrationsSettings.jsx";`:

```jsx
import ConnectionDetail from "./pages/ConnectionDetail.jsx";
```

2. Add the route immediately after the `/settings/integrations` route added in Task 5:

```jsx
{/* Connection Detail — ADMIN, LEAD */}
<Route
  path="/settings/integrations/:id"
  element={
    isAuthenticated && isLeadOrAdmin
      ? <ConnectionDetail {...authProps} />
      : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
  }
/>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/connection-detail.spec.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ConnectionDetail.jsx web/src/App.jsx web/tests/connection-detail.spec.js
git commit -m "feat: add connection detail page with run now, rotate, revoke, and collection history"
```

---

### Task 7: Frontend — Findings inbox page

**Files:**
- Create: `web/src/pages/Findings.jsx`
- Modify: `web/src/App.jsx`
- Modify: `web/src/pages/Dashboard.jsx`
- Test: `web/tests/findings.spec.js`

**Interfaces:**
- Consumes: `apiFetch` (existing), `GET /api/findings?status=&severity=` (existing), `PUT /api/findings/:id` (existing), `POST /api/findings/:id/promote` (existing).
- Produces: route `/findings`, reachable from every role that can reach the Dashboard.

- [ ] **Step 1: Write the failing test**

Create `web/tests/findings.spec.js`:

```js
import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const FINDINGS = [
  { id: 1, testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", status: "open", description: "bucket-1 does not block public access", resourceId: "bucket-1", linkedActionId: null },
  { id: 2, testKey: "aws.iam.password_policy", title: "Account password policy meets minimum strength", severity: "high", status: "acknowledged", description: "Password policy too weak", resourceId: "account", linkedActionId: null },
];

test.describe("Findings inbox", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("lists findings with severity and status", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings*", r => r.fulfill({ json: FINDINGS }));

    await page.goto("/findings");

    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Account password policy meets minimum strength")).toBeVisible();
  });

  test("acknowledging a finding calls PUT with the new status", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings*", r => {
      if (r.request().method() === "PUT") return r.fulfill({ json: { ...FINDINGS[0], status: "acknowledged" } });
      return r.fulfill({ json: FINDINGS });
    });

    await page.goto("/findings");
    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });

    const [putReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/findings/1") && req.method() === "PUT"),
      page.getByRole("button", { name: "Acknowledge" }).first().click(),
    ]);
    expect(putReq.postDataJSON().status).toBe("acknowledged");
  });

  test("promoting a finding calls POST /promote", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings", r => r.fulfill({ json: FINDINGS }));
    await page.route("**/api/findings/1/promote", r => r.fulfill({ status: 201, json: { id: 99, findingId: 1 } }));

    await page.goto("/findings");
    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });

    const [promoteReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/findings/1/promote")),
      page.getByRole("button", { name: "Create Remediation Action" }).first().click(),
    ]);
    expect(promoteReq.method()).toBe("POST");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/findings.spec.js`
Expected: FAIL — `/findings` route doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `web/src/pages/Findings.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";

const SEVERITY_COLOR = {
  critical: "var(--red)",
  high:     "var(--red)",
  medium:   "var(--amber)",
  low:      "var(--text3)",
};

const STATUS_OPTIONS = ["open", "acknowledged", "resolved", "suppressed", "false_positive"];

function SeverityPill({ severity }) {
  const color = SEVERITY_COLOR[severity] || "var(--text3)";
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color, textTransform: "uppercase",
      background: `${color}18`, padding: "2px 8px", borderRadius: 20, border: `1px solid ${color}40`
    }}>
      {severity}
    </span>
  );
}

export default function Findings({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (severityFilter) params.set("severity", severityFilter);
    if (statusFilter) params.set("status", statusFilter);
    const qs = params.toString();
    const data = await apiFetch(`/api/findings${qs ? `?${qs}` : ""}`, { token });
    setFindings(data || []);
  }, [token, severityFilter, statusFilter]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  const handleStatusChange = async (findingId, status) => {
    setBusyId(findingId);
    setError("");
    try {
      await apiFetch(`/api/findings/${findingId}`, { token, method: "PUT", body: JSON.stringify({ status }) });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handlePromote = async (findingId) => {
    setBusyId(findingId);
    setError("");
    try {
      await apiFetch(`/api/findings/${findingId}/promote`, { token, method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Findings</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            {isLeadOrAdmin && <button className="btn btn-ghost" onClick={() => navigate("/settings/integrations")}>Integrations</button>}
            <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: "flex", gap: 12, marginTop: 16, marginBottom: 8 }}>
          <select className="month-selector" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="month-selector" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="admin-table">
          <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2.5fr 1fr 1fr 2fr" }}>
            <span>Finding</span>
            <span>Severity</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {findings.length === 0 && (
            <div className="admin-row admin-row-empty"><span>No findings match these filters.</span></div>
          )}
          {findings.map(f => (
            <div key={f.id} className="admin-row" style={{ gridTemplateColumns: "2.5fr 1fr 1fr 2fr" }}>
              <span>
                <div style={{ fontWeight: 600 }}>{f.title}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>{f.resourceId}</div>
              </span>
              <span><SeverityPill severity={f.severity} /></span>
              <span style={{ fontSize: 12 }}>{f.status}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {isLeadOrAdmin && f.status === "open" && (
                  <button className="btn btn-ghost" disabled={busyId === f.id} onClick={() => handleStatusChange(f.id, "acknowledged")}>Acknowledge</button>
                )}
                {isLeadOrAdmin && f.status !== "suppressed" && f.status !== "resolved" && (
                  <button className="btn btn-ghost" disabled={busyId === f.id} onClick={() => handleStatusChange(f.id, "suppressed")}>Suppress</button>
                )}
                {isLeadOrAdmin && !f.linkedActionId && (
                  <button className="btn btn-primary" disabled={busyId === f.id} onClick={() => handlePromote(f.id)}>Create Remediation Action</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Modify `web/src/App.jsx`:

1. Add the import after `import ConnectionDetail from "./pages/ConnectionDetail.jsx";`:

```jsx
import Findings from "./pages/Findings.jsx";
```

2. Add the route immediately after `/settings/integrations/:id`:

```jsx
{/* Findings — all authenticated company users except SUPERADMIN */}
<Route
  path="/findings"
  element={isAuthenticated && !isSuperAdmin ? <Findings {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
/>
```

Modify `web/src/pages/Dashboard.jsx` — add a "Findings" entry to the `⋮` overflow menu, immediately after the `Integrations` button added in Task 5 (available to everyone who reaches Dashboard, not gated to `isLeadOrAdmin`, matching the backend's broader read access):

```jsx
<button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/findings"); }}>Findings</button>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/findings.spec.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Findings.jsx web/src/App.jsx web/src/pages/Dashboard.jsx web/tests/findings.spec.js
git commit -m "feat: add findings inbox page with filters, status transitions, and promote to action"
```

---

### Task 8: Frontend — Evidence Vault "Automated" tab

**Files:**
- Modify: `web/src/pages/EvidenceVault.jsx`
- Test: `web/tests/evidence.spec.js`

**Interfaces:**
- Consumes: `apiFetch` (existing), `GET /api/vault?source=automated` (Task 3).
- Produces: a tab UI inside the existing `/vault` page; no new route.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/evidence.spec.js`, inside the existing `test.describe("Evidence workflows", ...)` block:

```js
  test("Automated tab filters vault items by source=automated", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/vault?source=automated", r => r.fulfill({
      json: [{ id: 5, title: "aws.iam.mfa_enforced — account", description: "MFA enforced", uploadedBy: "automated", uploadedAt: "2026-08-17T00:00:00Z", linkedCount: 1, freshnessStatus: "fresh", testKey: "aws.iam.mfa_enforced" }]
    }));
    await page.route("**/api/vault", r => r.fulfill({ json: [] }));

    await page.goto("/vault");
    await expect(page.getByText("Evidence Vault")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Automated/ }).click();
    await expect(page.getByText("aws.iam.mfa_enforced — account")).toBeVisible({ timeout: 10_000 });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/evidence.spec.js -g "Automated tab"`
Expected: FAIL — there is no "Automated" tab button on the page yet.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/EvidenceVault.jsx`:

1. Add a `source` state near the existing `search` state declaration (find `const [search, setSearch] = useState(...)` and add immediately after it):

```jsx
const [source, setSource] = useState("all"); // "all" | "automated"
```

2. Update the `load` callback to thread `source` into the query string:

```jsx
const load = useCallback(async (q = search) => {
  setLoading(true);
  setError("");
  try {
    const params = new URLSearchParams();
    if (q.trim()) params.set("search", q.trim());
    if (source === "automated") params.set("source", "automated");
    const qs = params.toString();
    const url = qs ? `/api/vault?${qs}` : "/api/vault";
    const data = await apiFetch(url, { token, headers: vaultHeaders });
    setItems(data || []);
  } catch (e) {
    if (e.message?.includes("VAULT_PIN_REQUIRED") || e.status === 403) {
      setVaultUnlocked(false);
    } else {
      setError(e.message || "Failed to load vault");
    }
  } finally {
    setLoading(false);
  }
}, [token, vaultToken, source]);
```

3. Add a `useEffect` that reloads when `source` changes (place it right after the existing debounced-search `useEffect`):

```jsx
useEffect(() => { if (vaultUnlocked) load(search); }, [source]);
```

4. Add the tab UI immediately before the existing `{/* Search */}` block:

```jsx
{/* Source tabs */}
<div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
  {["all", "automated"].map(s => (
    <button key={s} onClick={() => setSource(s)} style={{
      background: "none", border: "none", cursor: "pointer",
      padding: "8px 16px", fontSize: 13, fontWeight: 500,
      color: source === s ? "var(--accent2)" : "var(--text2)",
      borderBottom: source === s ? "2px solid var(--accent)" : "2px solid transparent",
      fontFamily: "var(--sans)"
    }}>
      {s === "all" ? "All Evidence" : "Automated"}
    </button>
  ))}
</div>
```

5. Show a freshness badge on automated items — in the item row's meta line (find `<span>Uploaded by {item.uploadedBy || "—"}</span>` inside the `.map(item => ...)` block) add immediately after it:

```jsx
{item.freshnessStatus && (
  <span style={{
    color: item.freshnessStatus === "fresh" ? "var(--green)" : item.freshnessStatus === "stale" ? "var(--amber)" : "var(--red)",
    fontWeight: 600
  }}>
    {item.freshnessStatus}
  </span>
)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/evidence.spec.js`
Expected: PASS, including the existing tests in the file (the `source` state defaults to `"all"`, so the pre-existing "Upload file to vault" test's default `GET /api/vault` mock still matches).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/EvidenceVault.jsx web/tests/evidence.spec.js
git commit -m "feat: add Automated tab and freshness badge to Evidence Vault"
```

---

### Task 9: Frontend — Dashboard "Automated Coverage" tile

**Files:**
- Modify: `web/src/pages/Dashboard.jsx`
- Test: `web/tests/dashboard.spec.js`

**Interfaces:**
- Consumes: `stats.automatedCoverage` (Task 4's new dashboard response key).
- Produces: a new tile in the existing drag-reorderable dashboard grid.

- [ ] **Step 1: Write the failing test**

Modify `web/tests/dashboard.spec.js`: add `automatedCoverage: { count: 3, total: 7 },` to the `MOCK_DASHBOARD` object (after the existing `scoreEligible: { count: 8, total: 15 },` line), and add a new test at the end of the `test.describe` block:

```js
  test("Dashboard shows Automated Coverage tile", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/dashboard*", r => r.fulfill({ json: MOCK_DASHBOARD }));

    await page.goto("/dashboard");

    await expect(page.locator(".dash-card").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Automated Coverage")).toBeVisible();
    await expect(page.locator(".dash-kpi-val").filter({ hasText: "3" })).toBeVisible();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/dashboard.spec.js -g "Automated Coverage"`
Expected: FAIL — no element contains the text "Automated Coverage" yet.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/Dashboard.jsx`:

1. Add a new entry to `WIDGET_DEFS` (after the existing `{ id: "score-eligible", cls: "dash-card" },` line):

```jsx
{ id: "automated-coverage", cls: "dash-card" },
```

2. Add a new `case` to the `renderWidget` switch (immediately after the existing `case "score-eligible":` block, which ends with the closing `);` before the next case):

```jsx
case "automated-coverage":
  if (stats.automatedCoverage === undefined) return null;
  return (
    <>
      <div className="dash-card-title">Automated Coverage</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
        <DonutChart
          segments={[
            { label: "Automated", value: stats.automatedCoverage.count, color: "var(--accent2)" },
            { label: "Other",     value: Math.max(0, stats.automatedCoverage.total - stats.automatedCoverage.count), color: "var(--bg4)" }
          ]}
          size={80}
        />
        <div>
          <div className="dash-kpi-val" style={{ color: "var(--accent2)" }}>{stats.automatedCoverage.count}</div>
          <div className="dash-kpi-label">of {stats.automatedCoverage.total} controls</div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
            {stats.automatedCoverage.total > 0
              ? `${Math.round((stats.automatedCoverage.count / stats.automatedCoverage.total) * 100)}% automated`
              : "No controls yet"}
          </div>
        </div>
      </div>
    </>
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/dashboard.spec.js`
Expected: PASS, all tests in the file including the new one.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Dashboard.jsx web/tests/dashboard.spec.js
git commit -m "feat: add Automated Coverage tile to dashboard"
```

---

### Task 10: Backend — `pdfkit` dependency + finding-evidence PDF renderer

**Files:**
- Modify: `api/package.json` (add `"pdfkit": "^0.15.0"`)
- Create: `api/src/utils/findingEvidencePdf.js`
- Test: Create `api/src/__tests__/findingEvidencePdf.test.js` (unit test — pure function, no DB, matches this repo's `src/__tests__/*.test.js` convention)

**Interfaces:**
- Produces: `renderFindingEvidencePdf({ title, testKey, resourceId, severity, message, evidencePayload, isoReferences, connectionName, integrationKey }) → Promise<Buffer>` — a one-page PDF: title, a labeled field block (severity/resource/test key/ISO reference(s)/source connection), a description section, and a pretty-printed JSON dump of `evidencePayload` (the literal "evidence found"). No HTML/escaping concerns here (pdfkit draws text via API calls, not markup — unlike the client-side bulk report, which still needs escaping, see Task 13).

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/findingEvidencePdf.test.js`:

```js
import { describe, test, expect } from "vitest";
import { renderFindingEvidencePdf } from "../utils/findingEvidencePdf.js";

describe("renderFindingEvidencePdf", () => {
  test("produces a valid PDF buffer containing the finding's data", async () => {
    const buf = await renderFindingEvidencePdf({
      title: "S3 buckets block public access",
      testKey: "aws.network.s3_public_access_blocked",
      resourceId: "bucket-1",
      severity: "critical",
      message: "bucket-1 has no public access block configuration",
      evidencePayload: { BlockPublicAcls: false, BlockPublicPolicy: false },
      isoReferences: ["A.8.2.3"],
      connectionName: "Prod AWS",
      integrationKey: "aws",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("handles an empty evidence payload and missing optional fields without throwing", async () => {
    const buf = await renderFindingEvidencePdf({
      title: "t", testKey: "k", resourceId: "r", severity: "low",
      message: null, evidencePayload: {}, isoReferences: [], connectionName: null, integrationKey: null,
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/findingEvidencePdf.test.js`
Expected: FAIL — `api/src/utils/findingEvidencePdf.js` doesn't exist (module not found).

- [ ] **Step 3: Write the implementation**

Run `cd api && npm install pdfkit` (adds it to `package.json`/`package-lock.json`).

Create `api/src/utils/findingEvidencePdf.js`:

```js
import PDFDocument from "pdfkit";

export function renderFindingEvidencePdf({ title, testKey, resourceId, severity, message, evidencePayload, isoReferences, connectionName, integrationKey }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").text(title || testKey);
    doc.fontSize(10).font("Helvetica").fillColor("#64748b").text(`Generated ${new Date().toLocaleString("en-GB")}`);
    doc.moveDown();

    const field = (label, value) => {
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11).text(`${label}:`, { continued: true });
      doc.font("Helvetica").text(` ${value ?? "—"}`);
    };
    field("Severity", severity);
    field("Resource", resourceId);
    field("Test key", testKey);
    field("ISO 27001 reference(s)", isoReferences && isoReferences.length ? isoReferences.join(", ") : "—");
    field("Source connection", `${connectionName || "—"} (${integrationKey || "—"})`);
    doc.moveDown();

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text("Description");
    doc.font("Helvetica").fontSize(10).text(message || "—");
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(12).text("Evidence collected");
    doc.font("Courier").fontSize(9).text(JSON.stringify(evidencePayload ?? {}, null, 2));

    doc.end();
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/findingEvidencePdf.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/package.json api/package-lock.json api/src/utils/findingEvidencePdf.js api/src/__tests__/findingEvidencePdf.test.js
git commit -m "feat: add pdfkit-based finding evidence PDF renderer"
```

---

### Task 11: Backend — schema: `findings.evidence_vault_id` + `findings.payload_hash`

**Files:**
- Modify: `init.sql`

**Interfaces:**
- Produces: two new nullable columns on `findings`, following the exact `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern already used at line 609 for `actions.finding_id`.

- [ ] **Step 1: Write the implementation**

In `init.sql`, immediately after the existing line `ALTER TABLE actions ADD COLUMN IF NOT EXISTS finding_id INT REFERENCES findings(id) ON DELETE SET NULL;` (line 609), add:

```sql
ALTER TABLE findings ADD COLUMN IF NOT EXISTS evidence_vault_id INT REFERENCES evidence_vault(id) ON DELETE SET NULL;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS payload_hash TEXT;
```

- [ ] **Step 2: Verify**

No standalone test for a schema-only change (consistent with how the rest of `init.sql` is treated in this plan — schema changes are verified by the tasks that use them). Task 12's integration tests (which reload `init.sql` fresh via `globalSetup.js`) will fail to compile their `INSERT`/`SELECT` statements if this step is wrong, which is the verification.

- [ ] **Step 3: Commit**

```bash
git add init.sql
git commit -m "feat: add evidence_vault_id and payload_hash columns to findings"
```

---

### Task 12: Backend — `collectionRunner.js` auto-generates, vault-stores, and auto-links finding evidence PDFs

**Files:**
- Modify: `api/src/utils/collectionRunner.js`
- Test: Modify `api/src/__tests__/integration/collectionRunner.test.js`

**Interfaces:**
- Consumes: `renderFindingEvidencePdf` (Task 10), `findings.evidence_vault_id`/`payload_hash` (Task 11).
- Produces: on every `fail` result, `collectionRunner.js` now (a) renders a PDF via `renderFindingEvidencePdf`, (b) writes it to `uploads/<companyId>/vault/` using the exact same filename/path convention `vault.js`'s multer storage already uses, (c) inserts a real `evidence_vault` row (`file_name`/`file_type='application/pdf'`/`file_size`/`storage_path` all populated, unlike the pass path's metadata-only rows), (d) auto-links it to every matching question via `question_evidence` (reusing the pass path's existing linking loop, extracted into a shared helper), (e) stores the hash of the evidence payload on `findings.payload_hash` so a re-run with unchanged evidence does **not** regenerate/duplicate the PDF (mirrors the existing pass-path dedup logic using `payloadHash`/`automated_evidence_items`).

- [ ] **Step 1: Write the failing test**

Modify `api/src/__tests__/integration/collectionRunner.test.js`:

1. Add `import fs from "fs";` to the top of the file alongside the existing imports.

2. In the first test (`"records a run, generates evidence for a pass, and a finding for a fail"`), change:
```js
    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(1);
```
to:
```js
    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1 ORDER BY id`, [company.id]);
    expect(vaultRows.rows.length).toBe(2); // one metadata-only row for the pass, one real PDF file for the fail
```
and after the existing `findingRows` assertions at the end of that test, add:
```js
    const failVaultRow = vaultRows.rows.find(v => v.file_type === "application/pdf");
    expect(failVaultRow).toBeDefined();
    expect(failVaultRow.file_name).toMatch(/\.pdf$/);
    expect(fs.existsSync(failVaultRow.storage_path)).toBe(true);
    expect(findingRows.rows[0].evidence_vault_id).toBe(failVaultRow.id);
    expect(findingRows.rows[0].payload_hash).toBeTruthy();
```

3. In the fourth test (`"works identically for a second, differently-shaped connector (azure)..."`), apply the same `vaultRows.rows.length` change from `1` to `2`.

4. Add two new tests at the end of the `describe("runCollection", ...)` block:

```js
  test("auto-links a finding's evidence PDF to matching questions by ISO reference", async () => {
    const { company, admin, connection } = await setupConnection();
    // The failing fixture test (aws.network.s3_public_access_blocked) maps to A.8.2.3 in init.sql's seed data
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M2', $1, 'Network Security')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q2', $1, 'M2', 'A.8.2.3')`, [company.id]);

    await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    const linkRows = await query(`SELECT * FROM question_evidence WHERE company_id = $1 AND quest_id = 'Q2'`, [company.id]);
    expect(linkRows.rows.length).toBe(1);

    const findingRows = await query(`SELECT evidence_vault_id FROM findings WHERE company_id = $1`, [company.id]);
    expect(linkRows.rows[0].vault_id).toBe(findingRows.rows[0].evidence_vault_id);
  });

  test("does not regenerate the PDF on a second run with unchanged evidence", async () => {
    const { company, admin, connection } = await setupConnection();

    await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });
    const firstVault = await query(`SELECT evidence_vault_id FROM findings WHERE company_id = $1`, [company.id]);

    await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });
    const secondVault = await query(`SELECT evidence_vault_id FROM findings WHERE company_id = $1`, [company.id]);
    const allVaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);

    expect(secondVault.rows[0].evidence_vault_id).toBe(firstVault.rows[0].evidence_vault_id);
    expect(allVaultRows.rows.length).toBe(2); // still just pass + fail, no duplicate PDF from the second run
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- collectionRunner.test`
Expected: FAIL — `vaultRows.rows.length` is `1` not `2` (fail path creates no vault row yet), `findings.evidence_vault_id`/`payload_hash` don't exist as columns (query errors) until Task 11 is applied, `question_evidence` has no row for `Q2`.

- [ ] **Step 3: Write the implementation**

In `api/src/utils/collectionRunner.js`, replace the top of the file (imports through `upsertFinding`, i.e. current lines 1-49) with:

```js
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { query, mapRow } from "../db/index.js";
import { getActiveCredential } from "../db/integrationCredentials.js";
import { getConnector } from "../connectors/registry.js";
import { writeAuditLog } from "./auditLog.js";
import { renderFindingEvidencePdf } from "./findingEvidencePdf.js";

function hashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");
}

async function linkVaultToQuestions({ companyId, testKey, vaultId }) {
  const mappings = await query(`SELECT iso_reference FROM test_control_mappings WHERE test_key = $1`, [testKey]);
  for (const mapping of mappings.rows) {
    const questions = await query(
      `SELECT quest_id FROM questions WHERE company_id = $1 AND iso_reference = $2`,
      [companyId, mapping.iso_reference]
    );
    for (const q of questions.rows) {
      await query(
        `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
         VALUES ($1, $2, $3, 'automated')
         ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
        [companyId, q.quest_id, vaultId]
      );
    }
  }
}

async function upsertEvidenceForPass({ companyId, result }) {
  const vaultResult = await query(
    `INSERT INTO evidence_vault (company_id, title, description, uploaded_by)
     VALUES ($1, $2, $3, 'automated') RETURNING *`,
    [companyId, `${result.testKey} — ${result.resourceId}`, result.message]
  );
  const vault = mapRow(vaultResult);
  await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: vault.id });
  return vault.id;
}

async function generateFindingEvidenceVaultItem({ companyId, connectionId, result }) {
  const [isoRows, connRow] = await Promise.all([
    query(`SELECT iso_reference FROM test_control_mappings WHERE test_key = $1`, [result.testKey]),
    query(`SELECT name, integration_key FROM integration_connections WHERE id = $1`, [connectionId]),
  ]);
  const conn = mapRow(connRow);

  const pdfBuffer = await renderFindingEvidencePdf({
    title: result.title || result.testKey,
    testKey: result.testKey,
    resourceId: result.resourceId,
    severity: result.severity,
    message: result.message,
    evidencePayload: result.evidencePayload,
    isoReferences: isoRows.rows.map(r => r.iso_reference),
    connectionName: conn?.name,
    integrationKey: conn?.integrationKey,
  });

  const dir = path.join(process.env.UPLOAD_DIR || "./uploads", String(companyId), "vault");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
  const storagePath = path.join(dir, fileName);
  fs.writeFileSync(storagePath, pdfBuffer);

  const vaultResult = await query(
    `INSERT INTO evidence_vault (company_id, title, description, file_name, file_type, file_size, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, 'automated') RETURNING *`,
    [companyId, `${result.testKey} — ${result.resourceId}`, result.message, fileName, pdfBuffer.length, storagePath]
  );
  const vault = mapRow(vaultResult);
  await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: vault.id });
  return vault.id;
}

async function upsertFinding({ companyId, connectionId, result, sourceResultId }) {
  const payloadHash = hashPayload(result.evidencePayload);
  const existing = await query(
    `SELECT evidence_vault_id, payload_hash FROM findings WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4`,
    [companyId, connectionId, result.testKey, result.resourceId]
  );
  const existingFinding = mapRow(existing);

  let vaultId = existingFinding?.evidenceVaultId || null;
  if (!existingFinding || !existingFinding.evidenceVaultId || existingFinding.payloadHash !== payloadHash) {
    vaultId = await generateFindingEvidenceVaultItem({ companyId, connectionId, result });
  }

  await query(
    `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title, description, source_result_id, evidence_vault_id, payload_hash, last_detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (company_id, connection_id, test_key, resource_id)
     DO UPDATE SET
       status = CASE WHEN findings.status = 'resolved' THEN 'open' ELSE findings.status END,
       last_detected_at = NOW(),
       source_result_id = EXCLUDED.source_result_id,
       description = EXCLUDED.description,
       evidence_vault_id = EXCLUDED.evidence_vault_id,
       payload_hash = EXCLUDED.payload_hash`,
    [companyId, connectionId, result.testKey, result.resourceId, result.severity, result.title || result.testKey, result.message, sourceResultId, vaultId, payloadHash]
  );
}
```

The rest of the file (`runCollection()` itself, from the current `export async function runCollection` line onward) is unchanged — `upsertFinding(...)` is already called with the same signature at its existing call site.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- collectionRunner.test`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Run the full integration suite**

Run: `cd api && npm run test:integration` (Task 11's schema change and this task's `findings.evidence_vault_id` column are both new — confirm nothing else in the suite, e.g. `findings.test.js`'s existing `SELECT *`-based assertions, breaks from the extra columns).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/utils/collectionRunner.js api/src/__tests__/integration/collectionRunner.test.js
git commit -m "feat: auto-generate and vault-store finding evidence PDFs, linked to matching questions"
```

---

### Task 13: Frontend — "Download Evidence PDF" (vault-backed) and bulk "Export PDF" on the Findings page

**Files:**
- Modify: `web/src/pages/Findings.jsx`
- Test: Modify `web/tests/findings.spec.js`

**Interfaces:**
- Consumes: `f.evidenceVaultId` (automatically present on every `GET /api/findings` row once Task 12 ships — no backend route change needed, since the route already does `SELECT *` and `mapRows` camelCases the new column), `GET /api/vault/:id/download` (existing, `api/src/routes/vault.js`), `apiDownload` (existing, `web/src/api/client.js`).
- Produces: a **"Download Evidence PDF"** button per finding row (shown only when `f.evidenceVaultId` is set), and an **"↓ Export PDF"** bulk button in the page header producing a client-side print-ready report of the currently-filtered findings list (same `window.open`+`document.write()`+print-button convention as `ExportMenu.jsx`'s `exportPDF`).

- [ ] **Step 1: Write the failing test**

Add to `web/tests/findings.spec.js`, inside `test.describe("Findings inbox", ...)`. First, update the shared `FINDINGS` fixture at the top of the file to include `evidenceVaultId: 5` on the first item (`FINDINGS[0]`) and `evidenceVaultId: null` on the second, so one row has a download button and one doesn't. Then add:

```js
  test("Download Evidence PDF fetches the stored file for a finding that has one", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings*", r => r.fulfill({ json: FINDINGS }));
    await page.route("**/api/vault/5/download", r => r.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="evidence.pdf"' },
      body: Buffer.from("%PDF-1.4 fake"),
    }));

    await page.goto("/findings");
    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Evidence PDF" }).first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("evidence.pdf");
  });

  test("a finding with no stored evidence PDF shows no download button", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings*", r => r.fulfill({ json: FINDINGS }));

    await page.goto("/findings");
    await expect(page.getByText("Account password policy meets minimum strength")).toBeVisible({ timeout: 10_000 });

    const secondRow = page.locator(".admin-row", { hasText: "Account password policy meets minimum strength" });
    await expect(secondRow.getByRole("button", { name: "Download Evidence PDF" })).toHaveCount(0);
  });

  test("Export PDF opens a new tab listing the currently-filtered findings", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings*", r => r.fulfill({ json: FINDINGS }));

    await page.goto("/findings");
    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "Export PDF" }).click(),
    ]);
    await expect(popup.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });
    await expect(popup.getByText("Account password policy meets minimum strength")).toBeVisible();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/findings.spec.js -g "PDF"`
Expected: FAIL — no "Download Evidence PDF" or "Export PDF" button exists yet.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/Findings.jsx`:

1. Add an HTML-escaping helper (needed only for the bulk report, which still uses `document.write()` — finding titles/resource IDs can contain cloud-resource-derived text, matching `api/src/utils/sanitise.js:7`'s existing note that PDFs are a consumer requiring sanitisation) and the bulk-report builder, placed after the `STATUS_OPTIONS` constant and before the `Findings` component:

```jsx
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportFindingsListPDF(findings, company) {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const th = `style="background:#1e293b;color:#fff;padding:8px 10px;text-align:left;font-weight:600"`;
  const td = `style="padding:7px 10px;border-bottom:1px solid #e2e8f0"`;

  const rows = findings.map(f => `<tr>
    <td ${td}>${esc(f.title)}</td>
    <td ${td}>${esc(f.severity)}</td>
    <td ${td}>${esc(f.status)}</td>
    <td ${td}>${esc(f.resourceId)}</td>
    <td ${td}>${f.lastDetectedAt ? new Date(f.lastDetectedAt).toLocaleDateString("en-GB") : "—"}</td>
  </tr>`).join("") || `<tr><td colspan="5" ${td}>No findings match the current filters</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>${esc(company?.name || "Compliance Report")} — Findings</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#fff;padding:40px;font-size:13px}
  @media print{body{padding:20px}.no-print{display:none}}
  .header{border-bottom:3px solid #1e293b;padding-bottom:18px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end}
  .title{font-size:20px;font-weight:700;color:#1e293b}
  .subtitle{font-size:12px;color:#64748b;margin-top:3px}
  .date{font-size:11px;color:#94a3b8;white-space:nowrap}
  table{border-collapse:collapse;width:100%}
  tr:nth-child(even) td{background:#f8fafc}
  .print-btn{position:fixed;top:18px;right:18px;padding:9px 18px;background:#1e293b;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
</style>
</head><body>
<button class="print-btn no-print" onclick="window.print()">Print / Save PDF</button>
<div class="header">
  <div><div class="title">${esc(company?.name || "Compliance Report")}</div><div class="subtitle">Findings Report — PRISM</div></div>
  <div class="date">Generated ${date}</div>
</div>
<table><thead><tr>
  <th ${th}>Finding</th><th ${th}>Severity</th><th ${th}>Status</th><th ${th}>Resource</th><th ${th}>Last detected</th>
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  win.document.write(html);
  win.document.close();
}
```

2. Add the import for `apiDownload` and a download handler mirroring `QuestionDetail.jsx`'s existing `downloadEvidence()` (same fetch-with-auth-header → blob → temporary anchor → revoke pattern):

```jsx
import { apiFetch, apiDownload } from "../api/client.js";
```

```jsx
const downloadEvidencePdf = async (vaultId) => {
  try {
    const url = apiDownload(`/api/vault/${vaultId}/download`);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.includes("VAULT_PIN") || res.status === 403
        ? "Vault is PIN-protected — open Evidence Vault to unlock it, then try again."
        : `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "evidence.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    setError(err.message);
  }
};
```

3. Add the bulk "Export PDF" button to the `admin-actions` header row, immediately before the theme-toggle button:

```jsx
<button className="btn btn-ghost" onClick={() => exportFindingsListPDF(findings, company)}>↓ Export PDF</button>
```

4. Add the per-finding download button to each row's actions cell, shown only when a stored PDF exists (place it first among the action buttons — it's a read action available to every role that can view findings, not gated by `isLeadOrAdmin`, matching the backend's broader `VAULT_DOWNLOADERS` allowlist which already includes `CONTRIBUTOR`/`VIEWER`):

```jsx
{f.evidenceVaultId && (
  <button className="btn btn-ghost" onClick={() => downloadEvidencePdf(f.evidenceVaultId)}>Download Evidence PDF</button>
)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/findings.spec.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Findings.jsx web/tests/findings.spec.js
git commit -m "feat: add vault-backed Evidence PDF download and bulk Findings Export PDF"
```

---

## Self-Review Notes

- **Spec coverage:** all six §J screens are covered — "Settings → Integrations" (Task 5), "Connection detail" (Task 6, minus cadence selector/per-test toggles, explicitly deferred pending §I scheduling), "Evidence Sources" (Task 8), "Test results / Failed checks" i.e. Findings inbox (Task 7), "Collection history" (Task 6, backed by Task 2), "Dashboard" tile (Task 9, backed by Task 4). The OAuth auth-flow variant mentioned in §J's "Add Integration" wizard description is intentionally not built — no OAuth-based connector exists in the registry (`api/src/connectors/registry.js` has only `aws`, which is `iam_role`/`access_key`); the wizard's provider-picker step is written generically against the `integrations` catalog table so adding a real OAuth connector later doesn't require rewriting this page, but building an actual OAuth redirect flow now would be speculative.
- **Placeholder scan:** every step contains real, complete code — no "TODO"/"similar to Task N"/prose-only steps. The one exception (Task 3, Step 3's note about `toBeUndefined()` vs `toBeNull()`) is not a placeholder — it's a legitimate ambiguity in how `mapRows`' snake_case conversion handles a `NULL` value from an outer join, flagged explicitly with the exact fix so the implementer isn't stuck guessing if Step 4 surfaces it.
- **Type/interface consistency:** `GET /api/integrations/catalog` (Task 1) and `GET /api/integrations/:id/runs` (Task 2) response shapes match exactly what `IntegrationsSettings.jsx` (Task 5) and `ConnectionDetail.jsx` (Task 6) consume (`catalog[].key/.name/.authType/.status`, `runs[].status/.triggerType/.testsPassed/.testsFailed/.startedAt`). The `?source=automated` param and `freshnessStatus`/`testKey` response fields (Task 3) match exactly what `EvidenceVault.jsx` (Task 8) reads. `automatedCoverage.count`/`.total` (Task 4) match exactly what `Dashboard.jsx`'s new tile (Task 9) reads. Every frontend task's `apiFetch` call signature (`token`, `method`, `body: JSON.stringify(...)`) matches `web/src/api/client.js`'s actual signature and the `AuditorPanel.jsx` reference pattern verified in research, not assumed.
- **Role-gating consistency, double-checked against actual backend code (not assumed):** `requireRole(["ADMIN","LEAD"])`/`requireReadOnly(["ADMIN","LEAD"])` in `integrations.js` ⟷ frontend `isLeadOrAdmin` gate on `/settings/integrations` and `/settings/integrations/:id` routes, and on the Findings page's mutation buttons (`isLeadOrAdmin` computed locally from `user?.role`, matching `Dashboard.jsx`'s own established pattern rather than expecting it as a prop, since `authProps` does not include pre-computed role booleans). `requireReadOnly(["ADMIN","LEAD","CONTRIBUTOR","VIEWER"])` in `findings.js` (AUDITOR implicitly included by `requireReadOnly`) ⟷ frontend `/findings` route gated only on `!isSuperAdmin`, broader than the integrations routes, matching the backend exactly.
- **PDF evidence export (Tasks 10-13), scoped after initial implementation:** the collector already vault-stores and auto-links evidence for *passing* checks (`upsertEvidenceForPass`, metadata-only rows, no downloadable file) — Tasks 10-13 extend the same linking mechanism to the *fail* path, this time backed by a real generated PDF file, so findings become downloadable evidentiary artifacts rather than just status rows. `linkVaultToQuestions` is extracted as a shared helper rather than duplicated between the pass and fail paths. Exactly one new dependency is introduced (`pdfkit`) with a stated rationale (no headless browser needed, fits the existing Docker/CI setup as a pure-Node library). The client-side bulk "Export PDF" (Task 13) deliberately does **not** touch the vault — it's an ad hoc, multi-finding printable summary (mirroring `ExportMenu.jsx`'s existing convention), not a stored evidentiary artifact for a single control.
- **Known pre-existing tech debt, explicitly out of scope:** every page in this codebase (Dashboard, EvidenceVault, AdminPanel, AuditorPanel, Review, Tracker, SelfAssessment) independently hardcodes its own header/nav buttons — there is no shared nav component, `AppShell.jsx`/`AppSidebar.jsx` are dead code. This plan follows that existing (duplicative) convention rather than introducing a shared `<TopNav>` now, per this codebase's "follow established patterns, don't unilaterally restructure" norm — consolidating navigation into one component would be a legitimate follow-up but is a separate refactor, not required by any §J requirement.
