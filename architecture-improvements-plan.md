# Architecture Improvements Plan

## Overview

Six targeted improvements to the connector/integration architecture. Sub-Tasks 1–4 are
correctness/quality fixes that must be complete before Sub-Task 5. Sub-Task 6 is an
independent observability improvement scoped to the scheduler.

Implementation order: 1 → 2 → 3 → 4 → 5 → 6 (6 can be done in parallel with 5).

---

## Sub-Task 1 — registry.js: validate severityDefault parity between JS and connector.json

**Status:** [x] done

### Intent
`registry.js` already validates that every `test.key` in the JS array has a matching
`testKey` in `connector.json` (and vice versa). It does NOT check that each JS test's
`severityDefault` matches the manifest's `severityDefault`. If they drift the manifest
becomes misleading — and since the Zoho connector will have 42 tests, this is the
most likely source of future drift.

Extend `validateManifests()` to also compare `severityDefault` per matched test pair
and throw on mismatch, same "fails fast at startup" pattern as the existing key check.

### Expected Outcomes
- Server startup throws with a clear error naming the connector, test key, and both
  conflicting severity values if any JS `severityDefault` differs from its manifest
  counterpart.
- All four existing connectors (aws, azure, github, purview) pass — they are already
  aligned; confirm before merging.

### Todo List
1. In `validateManifests()`, after the existing key-set check, build a Map from the
   manifest's `tests` array keyed by `testKey → severityDefault`.
2. For each JS test, look up the matching manifest entry and compare
   `jsTest.severityDefault` to `manifestEntry.severityDefault`.
3. Collect all mismatches into an array; if any exist, throw one combined error in the
   same style as the existing drift error, naming the connector, test key, and both
   values.
4. Boot the server locally; confirm all four existing connectors pass without error.

### Relevant Context
- `api/src/connectors/registry.js` — `validateManifests()` lines 25–49.
- `api/src/connectors/aws/connector.json` — `tests[].severityDefault`.
- `api/src/connectors/aws/tests/iam.js` — `iamTests[].severityDefault` (JS side).
- Same structure for azure, github, purview connectors.

---

## Sub-Task 2 — Fix payload_hash deduplication: stable JSON serialisation

**Status:** [x] done

### Intent
`collectionRunner.js` deduplicates evidence and avoids redundant PDF regeneration by
hashing `JSON.stringify(evidencePayload)`. `JSON.stringify` is not key-order stable —
two objects with identical content but different insertion order produce different
hashes. A connector's API returning keys in a different order between runs causes
spurious PDF regeneration every run even when nothing changed.

Fix: replace both `JSON.stringify` calls in `hashPayload()` with a deterministic
`stableStringify` that recursively sorts object keys before serialising.

### Expected Outcomes
- `hashPayload({ b: 2, a: 1 })` and `hashPayload({ a: 1, b: 2 })` produce identical
  hashes.
- No spurious PDF regeneration on re-runs where only key order changed.
- No schema change — the `payload_hash` column is a cache hint; a one-time hash
  mismatch on first deploy triggers at most one extra PDF generation per finding, then
  stabilises.

### Todo List
1. Add a `stableStringify(value)` helper in `collectionRunner.js`:
   recursively sort object keys alphabetically before stringifying; leave arrays
   and primitives unchanged.
2. Replace `JSON.stringify(payload || {})` in `hashPayload()` with
   `stableStringify(payload || {})`.
3. Confirm the two call sites at lines 82 and 162 both use the helper.

### Relevant Context
- `api/src/utils/collectionRunner.js` — `hashPayload()` at line 10; call sites at
  lines 82 and 162.

---

## Sub-Task 3 — Scheduler: classify 409 as info, add per-connection outcome logging

**Status:** [x] done

### Intent
`runScheduledCollections()` currently catches all errors per connection and routes them
to `console.error`. A 409 "already running" (thrown by `collectionRunner.js` as an
`Error` with `.status = 409`) is benign — it means another process beat this one to
the run — but it logs as an error, polluting monitoring dashboards.

Additionally, the scheduler only emits one aggregate line per tick (`processed N
scheduled collection(s)`). There is no per-connection start/end log, making it
impossible to trace which connections ran, when, and with what outcome.

Fix both: classify 409 as info; add structured per-connection log lines.

### Expected Outcomes
- A 409 during a scheduled run appears as `[scheduler] skipped connection=X
  (run already in progress)` at `console.log`, not `console.error`.
- Each triggered collection emits a start log before `runCollection` is called.
- After `runCollection` resolves, a completion log names the connection ID and the
  run's final `status`, `testsPassed`, `testsFailed`.
- Genuine non-409 errors continue to appear as `console.error` with `connection=X`.

### Todo List
1. Add `console.log` before each `runCollection()` call:
   `[scheduler] starting scheduled collection for connection=${row.id} company=${row.company_id}`.
2. Capture the return value of `runCollection()` (it returns the finalised run object
   with `status`, `testsPassed`, `testsFailed`).
3. After a successful call, log:
   `[scheduler] completed connection=${row.id} status=${run.status} passed=${run.testsPassed} failed=${run.testsFailed}`.
4. In the per-connection catch block, check `e.status === 409`:
   - If so: `console.log(\`[scheduler] skipped connection=${row.id} (run already in progress)\`)`.
   - Otherwise: `console.error(\`[scheduler] error connection=${row.id}: ${e.message}\`)`.

### Relevant Context
- `api/src/utils/scheduler.js` — `runScheduledCollections()` lines 317–339.
- `api/src/utils/collectionRunner.js` — the 23505 → 409 throw at lines 130–133;
  return shape at line 222 includes `status`, `testsPassed`, `testsFailed`.

---

## Sub-Task 4 — Per-test try/catch: resilient multi-product runs across all connectors

**Status:** [x] done

### Intent
All existing connectors run their `tests` array in a single `for` loop inside one
`try/catch`. One uncaught throw from any individual test (e.g. a 403 on one IAM call)
aborts all subsequent tests and marks the whole run `failed`. For single-product
connectors this is tolerable. For the Zoho connector — which fans out across 14
independent products each with their own scope/rate-limit — one product failing
should not abort the other 13.

Decision (from Q&A): put the per-test error boundary inside each connector's own
`runTests()` loop, so the error context (which connector, which test) is always
in the same place as the test itself. The error is easiest to find and mitigate when
it surfaces with the test's key and the connector's product context, not as a generic
collectionRunner exception.

On a per-test error, push a synthetic result with `status: "error"` (already a valid
DB value per `init.sql:565` CHECK constraint) rather than throwing, so the run
continues.

### Expected Outcomes
- Any single test throwing during a collection run records that test as
  `status: "error"` with `message: err.message` and proceeds to the next test.
- The run's final status is `partial_failure` if some tests errored/failed and some
  passed; `failed` only if the entire `runTests()` call threw before returning
  anything (e.g. auth failure before any test ran).
- Existing connectors (aws, azure, github, purview) are unaffected in normal
  operation but gain the resilience benefit.

### Todo List
1. In `aws/index.js` `runTests()`: wrap each `test.run(clients)` in its own
   try/catch. On catch, push:
   `{ testKey: test.key, title: test.title, severity: test.severityDefault, resourceId: "error", status: "error", message: err.message, evidencePayload: {} }`.
2. Same change in `azure/index.js`, `github/index.js`, and `purview/index.js`.
3. For Zoho (Sub-Task 5), apply the same pattern per-product: wrap each product's
   tests array in its own try/catch block so a scope-gap error for Books doesn't
   abort CRM, etc.
4. Confirm `status: "error"` is accepted by the `evidence_test_results` CHECK
   constraint (`init.sql:565` — already includes `'error'` as a valid value).
5. Confirm the `collectionRunner.js` result-processing loop doesn't break on
   `status: "error"` — currently only `pass` and `fail` branches are handled;
   `error` (like `not_applicable`) will fall through to the `processedResults++`
   increment, which is the correct no-op behaviour.

### Relevant Context
- `api/src/connectors/aws/index.js` — `runTests()` loop lines 48–56.
- `api/src/connectors/azure/index.js` — `runTests()` loop lines 63–78 (has its own
  outer try/catch wrapping the loop — keep that for whole-connector auth failures,
  add per-test inner try/catch inside it).
- `api/src/connectors/github/index.js` — `runTests()` loop lines 43–58.
- `api/src/connectors/purview/index.js` — `runTests()` loop lines 103–118.
- `api/src/utils/collectionRunner.js` — result processing loop lines 152–190.
- `init.sql:565` — `status CHECK` includes `'error'`.

---

## Sub-Task 5 — Implement the Zoho connector

**Status:** [x] done

### Intent
Build the full Zoho connector as specified in `docs/connectors/zoho.md`. This is the
first multi-product connector (14 Tier 1 products, 42 checks) and the primary feature
delivery of this plan. All architectural groundwork (Sub-Tasks 1–4) must be complete
first.

The Zoho connector follows the Purview pattern: no typed SDK, authenticated fetch
helper, per-product client map in `buildClients()`, `describeZohoError()` for
surfacing provider-specific rate-limit and scope-gap errors.

Key decisions confirmed:
- `resourceId` for org-wide singleton checks = `config.orgId` (avoids `"account"`
  collisions across connectors and is stable across runs).
- Per-product isolation: each product's tests run in their own try/catch inside
  `runTests()` (per Sub-Task 4 pattern).
- UI: `ZohoWalkthrough` component includes a per-product scope checklist that builds
  the comma-separated scope string for the customer to paste into Zoho's API Console.

### Expected Outcomes
- `api/src/connectors/zoho/` exists with credentials.js, index.js, connector.json,
  and `tests/` containing 14 product files.
- `registry.js` imports zoho and validates it (including Sub-Task 1's severity check).
- `init.sql` includes the zoho seed SQL block (integrations row, 42 automated_tests
  rows, 42 test_control_mappings rows).
- `GET /api/integrations/zoho/setup-info` returns the data-center domain table and
  per-product scope lists for the UI.
- The wizard in `IntegrationsSettings.jsx` renders `ZohoWalkthrough` for `provider.key === "zoho"`, with data-center dropdown, org ID field, per-product scope checklist
  (checkboxes → generated scope string to copy), then client ID / client secret /
  refresh token fields.
- `CredentialFields` needs a new `refreshToken` / `setRefreshToken` prop path, OR
  Zoho uses its own inline credential fields (preferred — avoids changing a shared
  component for a Zoho-specific field).

### Todo List

#### Backend

1. Create `api/src/connectors/zoho/credentials.js`:
   - Validate `config.dataCenter` (must be one of the 7 valid values), `config.orgId`,
     `secret.clientId`, `secret.clientSecret`, `secret.refreshToken`.
   - Build domain helpers: `accountsDomain(dc)` → `accounts.zoho.{dc}` (with Canada
     special-cased to `accounts.zohocloud.ca`), `apiDomain(dc)` →
     `www.zohoapis.{dc}` (Canada → `www.zohoapis.ca`), per the table in
     `docs/connectors/zoho.md` Section 3.1.
   - Exchange `refreshToken` for an `access_token` via
     `POST https://accounts.zoho.{dc}/oauth/v2/token` with `grant_type=refresh_token`.
     Cache the access token in-closure (same `createCachedTokenGetter` pattern as
     `purview/credentials.js`) — valid ~1 hour, well within one collection run.
   - Return `{ getToken, apiDomain: apiDomain(config.dataCenter), orgId: config.orgId }`.
     The per-product test files use `getToken` to set
     `Authorization: Zoho-oauthtoken {token}` (NOT `Bearer`).

2. Create `api/src/connectors/zoho/tests/directory.js`:
   - 3 checks: `zoho.directory.mfa_enforced`, `zoho.directory.sso_enforced`,
     `zoho.directory.inactive_user_review`.
   - Calls Zoho Directory API. Use `config.orgId` as `resourceId` for the org-wide
     MFA/SSO checks; for inactive users, use user ID/email as `resourceId`.
   - Export `directoryTests` array of check objects.

3. Create the remaining 13 test files following the same pattern:
   `crm.js`, `books.js`, `people.js`, `workdrive.js`, `desk.js`, `mail.js`,
   `vault.js`, `projects.js`, `analytics.js`, `creator.js`, `sign.js`,
   `expense.js`, `recruit.js`.
   - Each file exports a `<product>Tests` array.
   - Use `buildEvidencePayload()` from `shared/evidencePayload.js` for consistent
     payload shape.
   - For org-wide singleton checks (one result per org), use `config.orgId` as
     `resourceId`. For per-resource checks (per-user, per-workspace, etc.), use the
     Zoho resource's own ID field.
   - Follow severity, ISO reference, description, and remediation guidance exactly
     as specified in `docs/connectors/zoho.md` Sections 4.1–4.14.

4. Create `api/src/connectors/zoho/index.js`:
   - `export const key = "zoho"`.
   - `export const tests = [...directoryTests, ...crmTests, ...]` (14 products).
   - `testConnection()`: call the cheapest available endpoint (e.g.
     `GET https://www.zohoapis.{dc}/crm/v6/org`) and return
     `{ ok: true, externalAccountId: config.orgId }`.
   - `runTests()`: group tests by product; wrap each product's group in its own
     try/catch (per Sub-Task 4). On catch, push a per-product error result and
     continue. After all products, return the full `runResults` array.
   - `describeZohoError(err)`: distinguish 429 rate-limit (check for
     `Retry-After` header or `error.code === "RATE_LIMIT"`) from scope/auth
     failures (`error.code === "INVALID_OAUTH_TOKEN"` or HTTP 401) from genuine
     errors. Mirror the `describeGithubError` / `describeAzureError` pattern.

5. Create `api/src/connectors/zoho/connector.json`:
   - All 42 test keys with `testKey`, `title`, `severityDefault`, `isoReferences`
     matching the JS objects exactly (Sub-Task 1 will validate this at startup).

6. In `api/src/connectors/registry.js`:
   - Add `import * as zoho from "./zoho/index.js";`
   - Add `[zoho.key]: zoho` to the `connectors` map.

7. Append the seed SQL from `docs/connectors/zoho.md` Section 6 to `init.sql`:
   - `INSERT INTO integrations` row for zoho.
   - 42 `INSERT INTO automated_tests` rows.
   - 42 `INSERT INTO test_control_mappings` rows.

8. Add `GET /api/integrations/zoho/setup-info` to `api/src/routes/integrations.js`:
   - Returns `{ dataCenters, products }` where `products` is the per-product list
     with each product's required OAuth2 scopes, used by the UI checklist.
   - `dataCenters` is the 7-entry domain table array (label + value) for the
     dropdown.
   - No auth required beyond the existing `authenticate + requireReadOnly` pattern.

#### Frontend

9. Add `ZohoWalkthrough` component (inline in `IntegrationsSettings.jsx` alongside
   the other walkthrough functions, or in a separate
   `web/src/components/ZohoWalkthrough.jsx`):
   - Fetches `GET /api/integrations/zoho/setup-info` on mount.
   - **Data center dropdown**: 7 options from `setupInfo.dataCenters`; selection is
     stored in `config.dataCenter` and also controls the displayed API Console URL.
   - **Org ID field**: plain text input for `config.orgId`.
   - **Per-product scope checklist**: one checkbox per product in
     `setupInfo.products`, all checked by default. As the user toggles products,
     a read-only text area below shows the generated comma-separated scope string
     (computed from the selected products' scope arrays). A `CopyButton` sits next
     to it. Instructions tell the customer to paste this into the Zoho API Console's
     "Generate Code" → scope field.
   - **Numbered steps** matching `docs/connectors/zoho.md` Section 2.1 (determine
     DC, create Self Client, generate code, exchange for refresh token, paste fields
     below). Follow the HTML/style pattern of `AzureServicePrincipalWalkthrough`
     (lines 151–188).
   - Accepts props: `token`, `dataCenter`, `setDataCenter`, `orgId`, `setOrgId`.
   - Does NOT own the credential fields (client ID, client secret, refresh token) —
     those are separate state in the wizard (step 10).

10. In `AddIntegrationWizard` (lines 244–429 of `IntegrationsSettings.jsx`):
    - Add state for Zoho: `dataCenter` (default `"com"`), `orgId`, `refreshToken`.
    - In the `config` assembly (line 292), add the Zoho branch:
      `provider.key === "zoho" ? { dataCenter, orgId } : ...`.
    - In the `secret` assembly (line 295), add the Zoho branch:
      `provider.key === "zoho" ? { clientId, clientSecret, refreshToken } : ...`.
    - In the walkthrough rendering block (lines 377–406), add a `zoho` branch before
      the default `AzureServicePrincipalWalkthrough` fallback that renders
      `<ZohoWalkthrough ... />`.
    - Add inline credential fields for `refreshToken` after `CredentialFields` when
      `provider.key === "zoho"` (since `CredentialFields`'s `oauth2` branch only
      renders clientId + clientSecret — Zoho additionally needs a refresh token).

11. In `PROVIDER_ICON` (line 15), add:
    `zoho: { Icon: SiZoho, color: "#E61E25" }` — import `SiZoho` from
    `react-icons/si` (Zoho's brand icon is in the Simple Icons set).

12. In `CATEGORY_ORDER` (line 25), add `"business_apps"` after `"data_governance"`.
    In `CATEGORY_LABEL`, add `business_apps: "Business Apps"`.

### Relevant Context
- `docs/connectors/zoho.md` — full spec: auth flow (Section 2), domain table
  (Section 3.1), token refresh flow (Section 3.2), rate limits (Section 3.3),
  per-product check tables (Sections 4.1–4.14), seed SQL (Section 6), and
  implementation notes (Section 7).
- `api/src/connectors/purview/credentials.js` — `createCachedTokenGetter` pattern.
- `api/src/connectors/purview/index.js` — closest structural match: fetch-based,
  per-domain client map, `describePurviewError`.
- `api/src/connectors/shared/evidencePayload.js` — `buildEvidencePayload()`.
- `web/src/pages/IntegrationsSettings.jsx`:
  - `AzureServicePrincipalWalkthrough` lines 151–188 — UI template.
  - `AddIntegrationWizard` lines 244–429 — wizard state machine to extend.
  - `PROVIDER_ICON` line 15, `CATEGORY_ORDER` line 25.
- `web/src/components/CredentialFields.jsx` — `oauth2` branch renders clientId +
  clientSecret; Zoho adds refreshToken as a third field inline in the wizard.

---

## Sub-Task 6 — Improve scheduled collection logging

**Status:** [x] done

### Intent
This is independent of Sub-Tasks 1–5 and can be implemented in parallel.

`runScheduledCollections()` currently logs only an aggregate count and silently eats
per-connection errors as generic `console.error` lines with no connection context.
Sub-Task 3 fixes the 409 classification. This sub-task adds structured per-connection
start/outcome log lines so every scheduled run is fully traceable in the log stream.

No new DB tables, no schema changes, no API changes.

### Expected Outcomes
- Every scheduled collection attempt produces at least two log lines: triggered and
  completed/skipped/errored.
- All log lines use the `[scheduler]` prefix with `connection=N` for greppability.
- Genuine errors continue as `console.error`; 409 skips and successful completions
  use `console.log`.

### Todo List
1. Before each `runCollection()` call, log:
   `[scheduler] starting scheduled collection for connection=${row.id} company=${row.company_id}`.
2. Capture the return value; on success log:
   `[scheduler] completed connection=${row.id} status=${run.status} passed=${run.testsPassed} failed=${run.testsFailed}`.
3. In the per-connection catch: check `e.status === 409` first (info log); otherwise
   `console.error(\`[scheduler] error connection=${row.id}: ${e.message}\`)`.
4. Note: Sub-Task 3 and Sub-Task 6 both touch `runScheduledCollections()` — implement
   them together in one edit to avoid a merge conflict.

### Relevant Context
- `api/src/utils/scheduler.js` — `runScheduledCollections()` lines 317–339.
- `api/src/utils/collectionRunner.js` — return shape at line 222.
