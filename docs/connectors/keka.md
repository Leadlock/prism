# Keka Connector

## 1. Overview

- **Proposed `integrations.category`**: `hr`
- **Proposed `integrations.key`**: `keka`
- **Proposed `integrations.auth_type`**: `oauth2`

Keka is an India-focused HRMS (HR/payroll/performance) SaaS platform. It ships a documented public REST API (`developers.keka.com`) with OAuth2 client-credentials authentication per company account, which is the strongest documentation posture of the three connectors in this batch — this one is ready to scope for implementation without needing a vendor support ticket first.

Scope for v1: read-only checks against employee (HRIS) master data — active/inactive employee records, employment status, and organizational structure (groups/departments/locations) — to evidence user-access and offboarding controls (ISO 27001 Annex A.9). **Caveat**: Keka's publicly documented API surface (confirmed via `developers.keka.com`) is strongest for core HRIS employee data; it does **not** document a dedicated "roles and permissions" or "admin accounts" REST endpoint the way it documents `/hris/employees`. Keka's in-product "Roles & Permissions" feature (documented at `help.keka.com/admin/overview-roles-permissions`) governs which Keka *users* (i.e., people with login access to the Keka admin/ESS portal, not the general employee roster) can see/do what — but no public API endpoint to *read* that role/permission assignment programmatically was found during this research pass. Checks below that depend on role/permission or admin-account data are marked accordingly and may require confirming with Keka support whether such an endpoint exists on a given plan, or falling back to a manual/screenshot evidence type for that specific control.

## 2. Authentication

**`auth_type`: `oauth2`** (OAuth 2.0 Client Credentials flow, scoped per company/tenant — confirmed via `developers.keka.com/reference/authentication`)

Keka's API authenticates via a machine-to-machine OAuth2 Client Credentials grant against a dedicated identity endpoint, separate from the API host itself. Each company's Keka account has its own `client_id` and `client_secret`, plus a company-scoped `api_key`, all three of which are required together with a fixed `scope=kekaapi`.

### Setup steps (Keka admin panel / developer portal)

1. Confirm the company's Keka plan includes API access — Keka's own FAQ (`help.keka.com/admin/faqs-for-api`) implies API access is enabled per-account rather than universally on, so a company may need to contact Keka support/their account manager to have API access turned on first if it isn't already visible in Settings.
2. In the Keka admin panel, generate/locate the integration credentials: **Client ID**, **Client Secret**, and **API Key** (Keka's docs reference all three as required inputs to the token request; exact menu path was not confirmed in this research pass — expect it under an "API" or "Integrations" section of company Settings).
3. Note the company's Keka subdomain (e.g. `https://<company>.keka.com`) — this is the tenant identifier used for API calls once authenticated.
4. Request an access token via a `POST` to the identity endpoint:
   - Production: `https://login.keka.com/connect/token`
   - Sandbox (if the account has one provisioned): `https://login.kekademo.com/connect/token`
5. Token request body (client-credentials grant): `client_id`, `client_secret`, `api_key`, `scope=kekaapi`.
6. Use the returned `access_token` as a `Bearer` token on subsequent calls to `https://<company>.keka.com/api/v1/...`.
7. Token expiry/refresh semantics were not documented in the pages fetched during this research pass — treat the token as short-lived and re-request it per run (or cache with a conservative TTL) rather than assuming a long-lived token.

### `config` shape (non-secret, stored on `integration_connections.config`)

```json
{
  "subdomain": "yourcompany",
  "environment": "production",
  "apiBaseUrl": "https://yourcompany.keka.com/api/v1"
}
```

### `secret` shape (encrypted, stored via `integration_credentials`)

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "apiKey": "..."
}
```

The connector should `POST` `client_id`, `client_secret`, `api_key`, and `scope=kekaapi` to `https://login.keka.com/connect/token` (or `https://login.kekademo.com/connect/token` for a sandbox-flagged connection) to obtain a Bearer token, then call the HRIS endpoints below with `Authorization: Bearer <access_token>`.

## 3. API Reference

- **Base URL**: `https://<company>.keka.com/api/v1/hris/...` (production) — the company subdomain is customer-specific and must be stored in `config.subdomain`. A `kekademo.com`-hosted sandbox exists for integration testing per Keka's developer portal, though its exact URL pattern was not independently confirmed beyond the token endpoint.
- **Confirmed endpoints** (via `developers.keka.com`, cross-referenced against a third-party API directory summary — verify exact paths/params against `https://developers.keka.com/llms.txt` or the live reference before implementation, as this was not independently re-verified against a raw OpenAPI spec):
  - `GET /hris/employees` — list all employees (supports pagination; used for the employee roster / access review checks)
  - `GET /hris/employees/{id}` — get a specific employee record
  - `GET /hris/employees/updatefields` — enumerate updatable employee fields (schema discovery, not evidence-relevant)
  - `GET /hris/groups`, `GET /hris/grouptypes` — organizational grouping data
  - `GET /hris/departments`, `GET /hris/locations`, `GET /hris/jobtitles` — organizational structure
- **Employee status field**: the employee list/detail response is expected to carry an employment-status field (active/inactive/exited) based on standard HRIS API conventions, but the exact field name was not confirmed from primary documentation in this pass — confirm against a live `GET /hris/employees` response or the field list at `GET /hris/employees/updatefields` before wiring the offboarding check.
- **Roles/permissions/admin-account endpoints**: not found in the documented public API surface (see caveat in Overview). Do not assume these exist without confirming directly with Keka support or the full reference at `developers.keka.com/reference/getting-started-with-your-api`.
- **Pagination**: Keka's docs state the API supports pagination generally; exact parameter names (e.g. `page`/`pageSize` vs. cursor-based) were not confirmed in the pages fetched — verify against the live reference for `/hris/employees` before implementation.
- **Rate limits**: Keka's developer portal states the platform enforces "rate limiting" as part of its API design, but no specific numeric threshold (requests/minute or /day) was found in the pages fetched during this research pass. Confirm with Keka support or by inspecting response headers (e.g. a `Retry-After`/`X-RateLimit-*` header) during initial integration testing, and implement conservative backoff until a documented number is available.

**Documentation-access caveat**: Keka's full endpoint reference is served as an interactive Postman/Readme-style portal (`developers.keka.com`, `apidocs.keka.com`) that renders most detail client-side; several pages fetched during this research returned only partial content. The endpoint list above should be treated as directionally correct (confirmed via Keka's own developer portal navigation and a third-party API catalog summary) but re-verified against the live reference or `https://developers.keka.com/llms.txt` (an LLM-readable index Keka explicitly publishes) before writing connector code.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `keka.employees.roster_accessible` | Employee roster is retrievable via API | medium | A.9.2.1 | Checks `GET /hris/employees` returns the company's employee roster successfully, confirming the HRIS user-record source of truth is reachable for downstream access reviews. | Confirm the Keka API connection is authenticated and the API key/client has not been revoked; re-authorize the integration in Keka's admin panel. |
| `keka.employees.inactive_access_revoked` | Inactive/exited employees are marked inactive in Keka | high | A.9.2.6 | Checks employee records with an exit/termination date in the past no longer report an active employment status, evidencing timely offboarding within the HRIS. | Update the employee's status to Inactive/Exited in Keka promptly after the last working day, and confirm any linked SSO/app access was deprovisioned alongside it. |
| `keka.employees.terminated_no_stale_active_flag` | No terminated employee retains an active status beyond a grace period | high | A.9.2.6 | Checks employees with a termination/last-working-day date more than N days in the past (default 7) are not still flagged active, catching offboarding process delays. | Investigate why the HR offboarding workflow did not update employment status on schedule; update the record and review the offboarding checklist/process. |
| `keka.org.structure_documented` | Organizational structure (departments/locations) is maintained | low | A.7.2.1 | Checks `GET /hris/departments` and `GET /hris/locations` return non-empty, populated organizational structure data, evidencing that access/role assignments can be meaningfully mapped to org units. | Populate department and location masters in Keka under Organization Settings so role-based access reviews can be scoped to real org units. |
| `keka.employees.roles_permissions_review` | Keka user roles and permissions have been reviewed (manual/API-caveat) | high | A.9.2.3 | Placeholder check flagging that Keka's public API does not document a role/permission-read endpoint (see Overview caveat); this control currently requires a manual evidence upload (screenshot/export of Settings > Roles & Permissions) until an API-based path is confirmed with Keka. | Perform a periodic manual review of Keka's Roles & Permissions settings (`help.keka.com/admin/overview-roles-permissions`) and upload the review as manual evidence; contact Keka support to confirm whether a role-read API exists on your plan. |
| `keka.employees.admin_account_review` | Keka admin/HR-admin accounts are limited to necessary personnel (manual/API-caveat) | critical | A.9.2.3 | Placeholder check flagging that no documented public endpoint enumerates Keka admin-portal users specifically (distinct from the general employee roster); requires manual evidence until confirmed otherwise. | Manually export the list of users with Admin/HR Admin role in Keka and confirm each has a documented business justification; contact Keka support about API access to this list. |

Note: the last two checks are intentionally scoped as manual-evidence placeholders rather than invented API calls, per the instruction to be honest about documentation gaps rather than inventing endpoint names.

## 5. Seed SQL

```sql
-- ===== Keka connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('keka', 'Keka', 'hr', 'oauth2', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('keka', 'keka.employees.roster_accessible', 'Employee roster is retrievable via API', 'Checks the employee roster endpoint returns successfully, confirming the HRIS user-record source of truth is reachable for downstream access reviews.', 'medium', 'Confirm the Keka API connection is authenticated and the API key/client has not been revoked; re-authorize the integration in Keka''s admin panel.'),
  ('keka', 'keka.employees.inactive_access_revoked', 'Inactive/exited employees are marked inactive in Keka', 'Checks employee records with an exit/termination date in the past no longer report an active employment status, evidencing timely offboarding within the HRIS.', 'high', 'Update the employee''s status to Inactive/Exited in Keka promptly after the last working day, and confirm any linked SSO/app access was deprovisioned alongside it.'),
  ('keka', 'keka.employees.terminated_no_stale_active_flag', 'No terminated employee retains an active status beyond a grace period', 'Checks employees with a termination/last-working-day date more than N days in the past are not still flagged active, catching offboarding process delays.', 'high', 'Investigate why the HR offboarding workflow did not update employment status on schedule; update the record and review the offboarding checklist/process.'),
  ('keka', 'keka.org.structure_documented', 'Organizational structure (departments/locations) is maintained', 'Checks department and location master data returns non-empty, populated organizational structure data, evidencing that access/role assignments can be meaningfully mapped to org units.', 'low', 'Populate department and location masters in Keka under Organization Settings so role-based access reviews can be scoped to real org units.'),
  ('keka', 'keka.employees.roles_permissions_review', 'Keka user roles and permissions have been reviewed (manual/API-caveat)', 'Placeholder check flagging that Keka''s public API does not document a role/permission-read endpoint; this control currently requires a manual evidence upload until an API-based path is confirmed with Keka.', 'high', 'Perform a periodic manual review of Keka''s Roles & Permissions settings and upload the review as manual evidence; contact Keka support to confirm whether a role-read API exists on your plan.'),
  ('keka', 'keka.employees.admin_account_review', 'Keka admin/HR-admin accounts are limited to necessary personnel (manual/API-caveat)', 'Placeholder check flagging that no documented public endpoint enumerates Keka admin-portal users specifically; requires manual evidence until confirmed otherwise.', 'critical', 'Manually export the list of users with Admin/HR Admin role in Keka and confirm each has a documented business justification; contact Keka support about API access to this list.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('keka.employees.roster_accessible', 'A.9.2.1'),
  ('keka.employees.inactive_access_revoked', 'A.9.2.6'),
  ('keka.employees.terminated_no_stale_active_flag', 'A.9.2.6'),
  ('keka.org.structure_documented', 'A.7.2.1'),
  ('keka.employees.roles_permissions_review', 'A.9.2.3'),
  ('keka.employees.admin_account_review', 'A.9.2.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `keka` (used in `registry.js`).
- **Suggested files**:
  - `api/src/connectors/keka/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/aws/index.js`'s structure.
  - `api/src/connectors/keka/credentials.js` — `resolveKekaCredentials({ authType, config, secret })`: POSTs `client_id`/`client_secret`/`api_key`/`scope=kekaapi` to `https://login.keka.com/connect/token` (or the `kekademo.com` host when `config.environment === "sandbox"`), returns `{ accessToken, apiBaseUrl }`.
  - `api/src/connectors/keka/client.js` — thin `fetch` wrapper for `GET {apiBaseUrl}/hris/...` with `Authorization: Bearer` header and pagination handling (confirm actual pagination params before finalizing).
  - `api/src/connectors/keka/tests/employees.js` — `keka.employees.*` checks.
  - `api/src/connectors/keka/tests/org.js` — `keka.org.structure_documented`.
  - `api/src/connectors/keka/tests/manualPlaceholders.js` (or handled at the evidence-type layer, not as a `run()` API call) — the two role/permission and admin-account checks that currently require manual evidence per the caveat above; confirm with the team whether "manual evidence" checks belong in this connector's `tests[]` at all, or should instead be modeled purely as manual controls outside the automated-test framework, since `run()` for these has no real API call to make today.
- **Registry wiring**: add `import * as keka from "./keka/index.js";` and `[keka.key]: keka` to `api/src/connectors/registry.js`.
- **`testConnection()`**: perform the token exchange and, if possible, a cheap follow-up call (e.g. `GET /hris/employees?pageSize=1`, pending pagination-param confirmation) to validate the token actually authorizes API reads; return `{ ok: true, externalAccountId: config.subdomain }`.
- **Before implementation starts**: confirm (a) exact pagination parameters for `/hris/employees`, (b) the exact employment-status field name/values on the employee object, and (c) whether any endpoint exposes Keka user role/permission assignments — either via Keka support or by inspecting a live sandbox response — since all three are assumed-but-unconfirmed in this doc.
