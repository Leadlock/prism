# Plan: SharePoint PII/Data Protection Checks in M365 Connector

## Top-Level Overview

Add two new security checks to the existing `microsoft_365` connector's SharePoint section:

1. **DLP policy coverage** — enumerate all SharePoint sites via Graph, then for each site determine whether at least one enabled DLP policy covers it. Returns one result row per site — `pass` if covered, `fail` if not. Overall `not_applicable` if the tenant has no sites and no DLP policies.
2. **Sensitivity label enforcement** — check via Graph beta that sensitivity label policies exist for the tenant. If the Graph API exposes a mandatory-labeling flag, check that too; otherwise collapse to policy-existence only and document the limitation.

Both checks use the `getGraphToken` (Graph API) already available in the M365 connector's client object. No new credentials, no new connector, no changes to auth infrastructure. The Purview connector is explicitly out of scope — its APIs (`purview.azure.net` / `manage.office.com`) don't surface DLP policy config or label enforcement settings; those live on Graph.

**Files changed:**
- `api/src/connectors/microsoft_365/tests/sharepoint.js` — add two check functions and extend `sharepointTests` export
- `api/src/connectors/microsoft_365/connector.json` — add two test metadata entries
- `init.sql` — add seed rows for automated_tests and test_control_mappings
- `docs/connectors/microsoft_365.md` — document the two new checks in the Proposed Checks table
- `api/src/__tests__/connectorsMicrosoft365.test.js` — add unit test coverage for both new checks

---

## Sub-Tasks

---

### Sub-Task 1 — DLP Policy Coverage Check (per SharePoint site)

**Intent**
Add `microsoft_365.sharepoint.dlp_policy_covers_sharepoint` to `sharepoint.js`. The check:
1. Fetches all SharePoint sites via `GET /v1.0/sites?search=*` (using `graphPaginate` for full enumeration)
2. Fetches all DLP policies via `GET /beta/security/dataLossPrevention/policies`
3. For each site, determines whether at least one enabled DLP policy explicitly covers that site (by URL/id match in the policy's `locations` array) or covers all SharePoint sites broadly (a policy with a `sharePoint` location type and no site-level exclusion that targets all)
4. Returns one result row per site — `pass` if covered, `fail` if not covered by any enabled DLP policy
5. Returns a single `not_applicable` row if the tenant has no SharePoint sites
6. Returns a single `fail` row at the tenant level if sites exist but there are zero DLP policies at all

Result row shape: `resourceId: site.id`, `resourceName: site.displayName`, `resourceType: "m365_sharepoint_site"`, `details: { siteUrl, coveringPolicies: [policy displayNames] }`.

**Expected Outcomes**
- `sharepointTests` export includes the new test object with key `microsoft_365.sharepoint.dlp_policy_covers_sharepoint`
- Returns `not_applicable` single row if the tenant has no SharePoint sites
- Returns one row per site — `pass` if at least one enabled DLP policy covers it, `fail` if none do
- Returns a single tenant-level `fail` if sites exist but zero DLP policies are configured
- `severityDefault` is `"critical"`
- `connector.json` contains a matching entry with `severityDefault: "critical"`
- Unit tests cover: no sites (not_applicable), sites with coverage (pass), sites without coverage (fail), no policies at all (fail), API error

**Todo List**
1. In `sharepoint.js`, add `async function checkDlpPolicyCoversSharepoint(getToken, tenantId)`
2. Fetch sites: use `graphPaginate(getToken, "/sites?search=*")` — import `graphPaginate` from the entra_id helper alongside the existing `graphGet` import
3. Fetch DLP policies: `graphGet(getToken, "/security/dataLossPrevention/policies", "beta")` → `policies = response.value ?? []`
4. If `sites.length === 0`, return `[{ resourceId: tenantId, status: "not_applicable", message: "No SharePoint sites found", evidencePayload: {} }]`
5. If `policies.length === 0`, return `[{ resourceId: tenantId, status: "fail", message: "No DLP policies are configured for this tenant", evidencePayload: {} }]`
6. Build a helper `function siteCoveredByPolicy(site, policy)` that returns true if the policy's `locations` array contains an entry with `locationType === "sharePoint"` (or `"oneDriveForBusiness"`) that either has no site-level filter (covers all) or explicitly includes `site.webUrl` / `site.id`
7. Map sites to result rows: `coveringPolicies = policies.filter(p => p.isEnabled !== false && siteCoveredByPolicy(site, p))`; `pass` if `coveringPolicies.length > 0`, else `fail`
8. Use `buildEvidencePayload` with `resourceType: "m365_sharepoint_site"`, `resourceId: site.id`, `resourceName: site.displayName`, `region: null`, `details: { siteUrl: site.webUrl, coveringPolicies: coveringPolicies.map(p => p.displayName) }`
9. Add the test object to `sharepointTests`: key `microsoft_365.sharepoint.dlp_policy_covers_sharepoint`, title `"SharePoint sites are protected by a DLP policy"`, failTitle `"SharePoint site has no DLP policy coverage"`, `severityDefault: "critical"`, `isoReferences: ["A.13.2.1"]`
10. Add matching entry to `connector.json` with `severityDefault: "critical"`

**Relevant Context**
- Existing check pattern: [`api/src/connectors/microsoft_365/tests/sharepoint.js`](api/src/connectors/microsoft_365/tests/sharepoint.js)
- `graphGet` + `graphPaginate` helpers: [`api/src/connectors/entra_id/tests/mfaAndAccess.js`](api/src/connectors/entra_id/tests/mfaAndAccess.js)
- `buildEvidencePayload`: [`api/src/connectors/shared/evidencePayload.js`](api/src/connectors/shared/evidencePayload.js)
- Connector manifest validation (must match JS exactly): [`api/src/connectors/registry.js`](api/src/connectors/registry.js)
- Graph permission needed: `InformationProtectionPolicy.Read.All` for DLP policies; `Sites.Read.All` for site enumeration (add both to docs setup steps)
- Graph beta DLP policy `locations` shape: each entry is `{ locationType: "sharePoint"|"oneDriveForBusiness"|..., locations: [{ name, url }] }` — the inner `locations` array is empty/absent when the policy applies to all sites of that type

**Status:** [x] done — implemented with a deviation from the written plan (confirmed with the user
before implementing): the plan's endpoint (`GET /beta/security/dataLossPrevention/policies`) and
its per-site `locations` coverage shape could not be verified against official Microsoft Graph
docs — no narrative REST reference exists for this beta resource, only an auto-generated
PowerShell cmdlet mapping to `GET /beta/informationProtection/dataLossPreventionPolicies`.
Implemented as `microsoft_365.sharepoint.dlp_policy_configured`: a single tenant-level
existence-only check (pass/fail on whether ≥1 DLP policy exists when SharePoint sites are
present; `not_applicable` if no sites) rather than per-site coverage rows. See the caveat in
`docs/connectors/microsoft_365.md` section 4.

---

### Sub-Task 2 — Sensitivity Label Policy Enforcement Check

**Intent**
Add `microsoft_365.sharepoint.sensitivity_label_policy_enforced` to `sharepoint.js`. This is a single tenant-scoped check that:
1. Calls `GET /beta/informationProtection/policy/labels` to verify at least one sensitivity label exists in the tenant
2. Attempts to also check whether mandatory labeling is enabled via the label policy settings endpoint; if that field is not surfaced by the API, collapses to policy-existence only and documents the limitation in a code comment

Returns a single `resourceId: tenantId` result row. No per-label enumeration — this is a governance posture check, not an asset check.

**Expected Outcomes**
- `sharepointTests` includes `microsoft_365.sharepoint.sensitivity_label_policy_enforced`
- Single result row with `resourceId: tenantId`
- `pass` if label policies exist (and mandatory labeling is on, if the API exposes it)
- `fail` with message "No sensitivity label policies are configured in this tenant"
- `fail` (distinct message) if policies exist but mandatory labeling is verifiably off
- `not_applicable` if the API returns 403 (MIP licensing not present on the tenant)
- `connector.json` has matching entry
- Unit tests cover: no labels → fail, labels present → pass, licensing 403 → not_applicable

> **Acceptable fallback**: If Graph beta does not expose a clean mandatory-labeling field, the check validates policy existence only. The implementation should add a `// NOTE: isMandatory field not available via Graph — checking policy existence only` comment and update the check title to `"Sensitivity label policies are configured"` (drop the "mandatory labeling" clause). This is confirmed acceptable.

**Todo List**
1. In `sharepoint.js`, add `async function checkSensitivityLabelPolicyEnforced(getToken, tenantId)`
2. Call `graphGet(getToken, "/informationProtection/policy/labels", "beta")` — catch 403 responses and return `not_applicable`
3. If `response.value` is empty or absent, return `fail`: `"No sensitivity label policies are configured in this tenant"`
4. Attempt to read `isMandatory` or equivalent from the response or a follow-up `GET /beta/informationProtection/policy` call; if not found, proceed with policy-existence pass only (add comment per the fallback note above)
5. Return `pass` row using `buildEvidencePayload` with `resourceType: "m365_label_policy"`, `resourceId: tenantId`, `region: null`, `details: { labelCount: response.value.length, isMandatory: <value or null> }`
6. Add test object to `sharepointTests`: key `microsoft_365.sharepoint.sensitivity_label_policy_enforced`, title `"Sensitivity label policies are configured"`, failTitle `"No sensitivity label policies are configured"`, `severityDefault: "high"`, `isoReferences: ["A.8.2.3"]`
7. Add matching entry to `connector.json`

**Relevant Context**
- Same files as Sub-Task 1
- ISO A.8.2.3 intentionally shared with Purview's `sensitivity_labels_applied` — complementary checks (policy existence here vs applied labels in Purview)
- Graph permission needed: `InformationProtectionPolicy.Read.All` — same permission already required for DLP check; no additional permission needed

**Status:** [x] done — implemented against the corrected endpoint
`GET /beta/security/informationProtection/sensitivityLabels`. The plan's original endpoint
(`GET /beta/informationProtection/policy/labels`) is deprecated and stopped returning data on
January 1, 2023 (confirmed via Microsoft Graph docs) — swapped before implementing. Design
otherwise matches the plan's approved fallback exactly (existence-only, no mandatory-labeling
field available).

---

### Sub-Task 3 — Seed SQL + Documentation

**Intent**
Update `init.sql` with seed rows for the two new automated_tests and test_control_mappings entries, and update `docs/connectors/microsoft_365.md` to document the new checks and the two new required Graph permissions.

**Expected Outcomes**
- `init.sql` has `ON CONFLICT (test_key) DO NOTHING` INSERT for both new test keys, with `severity_default: 'critical'` for the DLP check and `'high'` for the label check
- `init.sql` has matching `test_control_mappings` rows
- `docs/connectors/microsoft_365.md` Proposed Checks table has both new rows
- `docs/connectors/microsoft_365.md` API permissions setup section (step 2) includes `Sites.Read.All` and `InformationProtectionPolicy.Read.All`

**Todo List**
1. In `init.sql`, add to the `automated_tests` INSERT block: both new rows with appropriate title/description/severity/remediation_guidance (DLP: critical; labels: high)
2. In `init.sql`, add to the `test_control_mappings` INSERT block: `(dlp_test_key, 'A.13.2.1')` and `(label_test_key, 'A.8.2.3')`
3. In `docs/connectors/microsoft_365.md`, add two rows to the Proposed Checks table (section 4)
4. In `docs/connectors/microsoft_365.md`, add `Sites.Read.All` (for site enumeration) and `InformationProtectionPolicy.Read.All` (for DLP policies and label policies) to the API permissions step (section 2, step 2)

**Relevant Context**
- [`init.sql`](init.sql) — follow existing M365 `ON CONFLICT` INSERT pattern
- [`docs/connectors/microsoft_365.md`](docs/connectors/microsoft_365.md) — section 2 (setup) and section 4 (checks table)

**Status:** [x] done — also updated the duplicated Seed SQL block in
`docs/connectors/microsoft_365.md` section 5 (kept in sync with `init.sql`, matching the file's
existing pattern) and added two caveat notes to section 4 documenting the endpoint corrections.
Verified live: applied against the running `prism-db-1` container via the app's own
`testDefinitionSync` startup routine (not manual SQL) — both new `automated_tests` and
`test_control_mappings` rows confirmed present and correct in the running database.

---

### Sub-Task 4 — Unit Tests

**Intent**
Add unit tests for both new checks to the existing M365 Vitest suite. Follow the established mock-`fetch` pattern in the file: stub the Graph API endpoints (both v1.0 and beta), assert pass/fail/not_applicable/error outcomes for each branch.

**Expected Outcomes**
- `api/src/__tests__/connectorsMicrosoft365.test.js` has a test block for `checkDlpPolicyCoversSharepoint` covering:
  - no sites → `not_applicable`
  - sites exist, no DLP policies → single tenant-level `fail`
  - sites with a covering policy → `pass` per covered site
  - sites with no covering policy → `fail` per uncovered site
  - fetch error → `error`
- Same file has a test block for `checkSensitivityLabelPolicyEnforced` covering:
  - no labels → `fail`
  - labels present → `pass`
  - 403 response → `not_applicable`

**Todo List**
1. Read the existing test file to understand the mock/stub setup pattern (how `fetch` is stubbed per URL, how Graph pagination is mocked)
2. Add a `describe("dlp_policy_covers_sharepoint")` block with 5 test cases matching the outcomes above
3. Add a `describe("sensitivity_label_policy_enforced")` block with 3 test cases
4. Run `vitest` (or the project's test command) to confirm all new and existing tests pass

**Relevant Context**
- [`api/src/__tests__/connectorsMicrosoft365.test.js`](api/src/__tests__/connectorsMicrosoft365.test.js) — read this first; the mock pattern for Graph calls is established here
- The test file already imports and calls `runTests` / individual check functions; follow the same import and stub shape

**Status:** [x] done — 8 new tests added to `connectorsMicrosoft365.test.js` (4 per check:
not_applicable/fail/pass/error for DLP, fail/pass/not_applicable for labels — labels has no
sites-based not_applicable branch since it's tenant-scoped). Updated the pre-existing test-count
assertions (7→9) in both `connectorsMicrosoft365.test.js` and `connectorsRegistry.test.js` that
the plan didn't call out. Full suite: 661/661 passing.
