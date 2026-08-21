# Darwinbox Connector

## 1. Overview

- **Proposed `integrations.category`**: `hr`
- **Proposed `integrations.key`**: `darwinbox`
- **Proposed `integrations.auth_type`**: `api_key`

Darwinbox is a widely-used India-focused HRMS platform (core HR, payroll, performance, engagement). **This is the connector with the weakest/least self-service public API documentation of the three in this batch — flagged explicitly per the task instructions.** Darwinbox's API access is **not self-service**: it is provisioned only on request by Darwinbox's own integrations team, is described in third-party summaries as restricted to "privileged users" on a case-by-case basis, and the vendor's own hosted docs (`api-docs.darwinbox.com`) render as a client-side app that returned no static content when fetched during this research pass — meaning even the shape of the docs could not be independently confirmed beyond what third-party integration platforms (Knit, Bindbee, Merge) and Darwinbox's public Postman workspace summarize.

**Explicit caveat (per task instructions): API access for Darwinbox requires contacting Darwinbox's partner/integrations team to confirm current scope before implementation can start.** Everything below is Prism's best-available structure based on secondary sources (Postman public workspace listing, third-party integration-platform docs), not a primary-source confirmation, and should be re-verified once Darwinbox's integrations team responds to an access request.

Scope for v1 (tentative, pending vendor confirmation): read-only checks against employee master data (active/pending/deactivated status) to evidence onboarding/offboarding access controls (ISO 27001 Annex A.9). Role/permission and admin-account endpoints were not identified in any source consulted — see Section 3.

## 2. Authentication

**`auth_type`: `api_key`** (best-fit existing `integrations.auth_type` enum value — see caveat below on the actual mechanism)

Darwinbox's authentication does not cleanly match any single value in Prism's `auth_type` CHECK constraint (`iam_role`, `access_key`, `oauth2`, `api_key`). Based on secondary sources, Darwinbox supports **either**:

1. **Basic Auth or OAuth 2.0**, per one third-party summary, or
2. A **custom token-based scheme**: a SHA-512 hash computed from the concatenation of an admin email address, a secret key issued by Darwinbox, and the current epoch timestamp — effectively a signed, time-bound API key rather than a standard OAuth2 bearer token.

Given the ambiguity, this doc proposes `api_key` as the closest existing enum fit (it is credential-based and vendor-issued, not a standard three-legged OAuth2 grant), but **this must be confirmed directly with Darwinbox's integrations team** — if they confirm a true OAuth2 client-credentials flow is available for the target account, `oauth2` would be the more accurate value and the connector's credential-resolution logic would differ meaningfully (signed-hash generation vs. token exchange).

### Setup steps (vendor-mediated, not self-service)

1. **Contact Darwinbox's integrations team** (secondary sources cite `integrations@darwinbox.in`/`integrationsteam@darwinbox.in` — confirm the current contact via your Darwinbox account manager, as this was not verified against a primary Darwinbox page) to request API access for your instance.
2. Specify the intended use case (compliance evidence collection reading employee master/status data) — Darwinbox's integrations team reportedly scopes access and enabled data fields per request; **not all employee fields are enabled by default**, so the fields needed for offboarding checks (employment status, last working day) must be explicitly requested.
3. Obtain from Darwinbox: your instance's **client subdomain** (e.g. `https://yourcompany.darwinbox.in` or `.com`), an **admin email** to use as the signing identity, and a **secret key** for the SHA-512 signing scheme (if that is the mechanism confirmed for your account) — or OAuth2 `client_id`/`client_secret` if that flow is confirmed instead.
4. Confirm with Darwinbox which specific API endpoints/fields are enabled for your instance — do not assume the endpoint list in Section 3 below is complete or exists for your account without this confirmation.
5. If a Postman collection is shared by Darwinbox's team (their public workspace suggests this is standard practice — `postman.com/darwinbox-api/darwinbox-integration-team-s-public-workspace`), use it as the authoritative reference over this document, since it reflects what the vendor has actually granted.

### `config` shape (non-secret, stored on `integration_connections.config`) — tentative

```json
{
  "subdomain": "yourcompany",
  "adminEmail": "integration-admin@yourcompany.com",
  "authMechanism": "signed_hash"
}
```

### `secret` shape (encrypted, stored via `integration_credentials`) — tentative

```json
{
  "secretKey": "..."
}
```

If the SHA-512 signed-hash scheme is confirmed, the connector computes `SHA512(adminEmail + secretKey + unixTimestamp)` per request and sends it as a token/header value alongside the email and timestamp (exact header/param names not confirmed — obtain from Darwinbox's team or the shared Postman collection). If OAuth2 is confirmed instead for your account, this shape should be replaced with `clientId`/`clientSecret` and a standard token-exchange flow, matching the pattern in `docs/connectors/salesforce.md`.

## 3. API Reference

- **Base URL**: client-specific subdomain, pattern unconfirmed beyond "your Darwinbox instance URL" (e.g. `https://<company>.darwinbox.in` or `.com` depending on region/contract) — must be obtained from Darwinbox for the specific account.
- **Endpoints referenced in secondary sources** (via third-party integration-platform summaries of Darwinbox's Postman collection — **not independently verified against Darwinbox's own primary documentation**, since `api-docs.darwinbox.com` rendered no static content when fetched):
  - `POST /importapi/add` — add a pending employee record
  - `POST /importapi/activate` — activate a pending employee
  - `POST /importapi/deactivate` — deactivate an active employee (closest available signal for offboarding/access-revocation evidence)
  - `POST /importapi/educationdetails`, `POST /importapi/pastworkdetails` — supplementary employee data (not evidence-relevant)
  - `POST /UpdateEmployeeDetails/update` — update employee contact fields
  - `POST /Employeedocs/StandardDoc` — employee document upload
  - `POST /orgmasterapi/createdepartment`, `POST /orgmasterapi/createdesignation`, `POST /importapi/addLocations` — organizational master data (write-oriented; a corresponding read/list endpoint was not identified in the sources consulted)
- **Read/list endpoint gap**: nearly every endpoint identified above is a write/import operation (`add`, `activate`, `deactivate`, `create*`). No `GET`/list-style endpoint for enumerating current employees, their status, or their roles/permissions was found in any source consulted. This is a significant gap for an evidence-collection connector, which is fundamentally read-oriented — **confirm directly with Darwinbox's integrations team whether read/export endpoints exist** (e.g. an employee export or reporting API) before assuming the write-oriented endpoints above are the full surface.
- **Roles/permissions/admin-account endpoints**: none identified in any source consulted.
- **Audit log endpoints**: none identified in any source consulted.
- **Pagination**: not documented in any source consulted.
- **Rate limits**: not documented in any source consulted ("the official documentation does not specify explicit rate limits" per a third-party summary).
- **Webhooks**: reportedly not supported — periodic polling is the integration pattern third-party platforms use instead.

**Bottom line**: this connector cannot be responsibly scoped past "contact the vendor" today. The checks in Section 4 are written against the one plausible signal available (`/importapi/deactivate` as an offboarding-adjacent action) plus manual-evidence placeholders for everything else, rather than invented read endpoints.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `darwinbox.employees.roster_accessible` | Employee roster is retrievable via API (pending vendor confirmation) | medium | A.9.2.1 | Placeholder check: no documented read/list endpoint for the employee roster was identified in public/secondary sources; this check validates connectivity only once Darwinbox confirms an actual read endpoint for your account. | Contact Darwinbox's integrations team to confirm a read/export endpoint for employee records exists for your instance, and update this check once confirmed. |
| `darwinbox.employees.deactivation_events_present` | Employee deactivation actions are being recorded | high | A.9.2.6 | Checks that offboarded employees have a corresponding deactivation action/record (via `/importapi/deactivate` or equivalent), evidencing the HRIS reflects access-relevant status changes rather than relying solely on manual process. | Ensure the offboarding workflow calls Darwinbox's deactivation step (or the equivalent admin-UI action) promptly on an employee's last working day. |
| `darwinbox.employees.inactive_access_revoked` | Deactivated employees no longer show as active | high | A.9.2.6 | Checks employee records marked deactivated do not still report an active status elsewhere in the system, evidencing consistent offboarding state. | Investigate any employee record showing a deactivation event but a still-active status; correct the record and review the offboarding process for gaps. |
| `darwinbox.org.structure_documented` | Organizational structure (departments/designations) is maintained | low | A.7.2.1 | Checks department and designation master data is populated, evidencing that access/role assignments can be meaningfully mapped to org units. | Populate department and designation masters in Darwinbox so role-based access reviews can be scoped to real org units. |
| `darwinbox.employees.roles_permissions_review` | Darwinbox user roles and permissions have been reviewed (manual — no API found) | high | A.9.2.3 | Placeholder check: no role/permission-read API was identified for Darwinbox in any source consulted. Requires manual evidence (export/screenshot from Darwinbox admin console) until an API is confirmed with Darwinbox's integrations team. | Perform a periodic manual review of Darwinbox user roles/permissions and upload as manual evidence; ask Darwinbox's integrations team whether a roles/permissions API exists for your account. |
| `darwinbox.employees.admin_account_review` | Darwinbox admin accounts are limited to necessary personnel (manual — no API found) | critical | A.9.2.3 | Placeholder check: no admin-account-listing API was identified for Darwinbox in any source consulted. Requires manual evidence until confirmed otherwise. | Manually export the list of Darwinbox admin/super-admin users and confirm each has a documented business justification; ask Darwinbox's integrations team about API access to this list. |

## 5. Seed SQL

```sql
-- ===== Darwinbox connector: catalog seed data =====
-- NOTE: auth_type is a best-fit guess (api_key) pending vendor confirmation of the actual
-- auth mechanism (signed SHA-512 hash vs. OAuth2). Update if Darwinbox confirms otherwise.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('darwinbox', 'Darwinbox', 'hr', 'api_key', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('darwinbox', 'darwinbox.employees.roster_accessible', 'Employee roster is retrievable via API (pending vendor confirmation)', 'Placeholder check validating connectivity only, pending Darwinbox confirming an actual read/export endpoint for employee records.', 'medium', 'Contact Darwinbox''s integrations team to confirm a read/export endpoint for employee records exists for your instance, and update this check once confirmed.'),
  ('darwinbox', 'darwinbox.employees.deactivation_events_present', 'Employee deactivation actions are being recorded', 'Checks that offboarded employees have a corresponding deactivation action/record, evidencing the HRIS reflects access-relevant status changes.', 'high', 'Ensure the offboarding workflow calls Darwinbox''s deactivation step (or the equivalent admin-UI action) promptly on an employee''s last working day.'),
  ('darwinbox', 'darwinbox.employees.inactive_access_revoked', 'Deactivated employees no longer show as active', 'Checks employee records marked deactivated do not still report an active status elsewhere in the system, evidencing consistent offboarding state.', 'high', 'Investigate any employee record showing a deactivation event but a still-active status; correct the record and review the offboarding process for gaps.'),
  ('darwinbox', 'darwinbox.org.structure_documented', 'Organizational structure (departments/designations) is maintained', 'Checks department and designation master data is populated, evidencing that access/role assignments can be meaningfully mapped to org units.', 'low', 'Populate department and designation masters in Darwinbox so role-based access reviews can be scoped to real org units.'),
  ('darwinbox', 'darwinbox.employees.roles_permissions_review', 'Darwinbox user roles and permissions have been reviewed (manual - no API found)', 'Placeholder check: no role/permission-read API was identified for Darwinbox. Requires manual evidence until an API is confirmed with Darwinbox''s integrations team.', 'high', 'Perform a periodic manual review of Darwinbox user roles/permissions and upload as manual evidence; ask Darwinbox''s integrations team whether a roles/permissions API exists for your account.'),
  ('darwinbox', 'darwinbox.employees.admin_account_review', 'Darwinbox admin accounts are limited to necessary personnel (manual - no API found)', 'Placeholder check: no admin-account-listing API was identified for Darwinbox. Requires manual evidence until confirmed otherwise.', 'critical', 'Manually export the list of Darwinbox admin/super-admin users and confirm each has a documented business justification; ask Darwinbox''s integrations team about API access to this list.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('darwinbox.employees.roster_accessible', 'A.9.2.1'),
  ('darwinbox.employees.deactivation_events_present', 'A.9.2.6'),
  ('darwinbox.employees.inactive_access_revoked', 'A.9.2.6'),
  ('darwinbox.org.structure_documented', 'A.7.2.1'),
  ('darwinbox.employees.roles_permissions_review', 'A.9.2.3'),
  ('darwinbox.employees.admin_account_review', 'A.9.2.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `darwinbox` (used in `registry.js`).
- **Do not begin implementation before the vendor step below** — the credential shape, endpoint list, and even the `auth_type` value in this doc are all provisional.
- **Suggested files** (once vendor access is confirmed):
  - `api/src/connectors/darwinbox/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring the existing connector structure.
  - `api/src/connectors/darwinbox/credentials.js` — `resolveDarwinboxCredentials({ authType, config, secret })`: implements whichever mechanism Darwinbox confirms (SHA-512 signed hash of `adminEmail + secretKey + timestamp`, or an OAuth2 token exchange).
  - `api/src/connectors/darwinbox/client.js` — thin `fetch` wrapper for the confirmed base URL/endpoints.
  - `api/src/connectors/darwinbox/tests/employees.js` — `darwinbox.employees.*` checks, rewritten once real read endpoints are confirmed (the `deactivation_events_present`/`inactive_access_revoked` checks as written assume a way to read current employee status, which is not yet confirmed to exist).
  - `api/src/connectors/darwinbox/tests/org.js` — `darwinbox.org.structure_documented`.
- **Registry wiring**: add `import * as darwinbox from "./darwinbox/index.js";` and `[darwinbox.key]: darwinbox` to `api/src/connectors/registry.js`.
- **Required next step before any code is written**: email/ticket Darwinbox's integrations team (via the customer's account manager) to (a) confirm the auth mechanism (SHA-512 signed hash vs. OAuth2 vs. Basic Auth), (b) request a copy of their Postman collection or current API reference for the target instance, (c) confirm whether any read/list/export endpoint exists for employee status and role/permission data, and (d) confirm rate limits. This connector is the weakest-documented of the three in this batch and should not be scheduled for implementation until that response is in hand.
