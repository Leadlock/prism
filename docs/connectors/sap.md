# SAP Connector

## 1. Overview — read this before scheduling any build work

**SAP is architecturally different from Salesforce and ServiceNow, and this connector is NOT equally ready to build.** Salesforce and ServiceNow are single-vendor-hosted cloud SaaS products with one standard, internet-reachable REST API surface each. "SAP" is not one thing — it's a family of deployment models with very different connectivity stories:

- **SAP BTP (Business Technology Platform)** — cloud-native, internet-reachable, has modern OAuth2 + OData v2/v4 APIs. A Prism connector against this is architecturally the same shape as the Salesforce/ServiceNow connectors.
- **SAP S/4HANA on-premise** — typically deployed inside the customer's own network, fronted by **SAP Gateway** (OData services) or reached via RFC/BAPI calls. Prism (running outside the customer's network) generally **cannot reach an on-prem SAP system directly from the internet**. Reaching it requires either the customer exposing their Gateway through a reverse proxy/VPN, or SAP's own **Cloud Connector** (an on-prem agent that establishes an outbound-only tunnel to a cloud connectivity broker) — an integration model, not a simple REST call.
- **SAP ECC** — older, RFC-heavy, the weakest API story of the three; OData/Gateway support is often absent or requires a separate add-on.

**Disposition: build this connector's v1 only against the OData-over-Gateway scenario for a cloud-reachable instance, and only after confirming the specific customer's connectivity model and OData service catalog.** This is the same disposition already applied to TallyPrime elsewhere in the backlog — a connector that depends on customer-specific network reachability is not something Prism can build generically and schedule alongside a standard SaaS OAuth2 connector. Treat SAP as **discovery-gated, not backlog-ready**: don't schedule engineering time until a specific customer's Gateway reachability and OData service names are confirmed (see §6).

- **Proposed `integrations.category`**: `business_apps`
- **Proposed `integrations.key`**: `sap`
- **Proposed `integrations.auth_type`**: `oauth2` (falls back to `api_key` for Basic Auth-only Gateway configs — see §2)

Scope for v1 (assuming a cloud-reachable Gateway is confirmed): read-only checks against SAP Gateway OData services exposing user, role, and authorization data — evidencing identity/access-management controls (ISO 27001 Annex A.9) and configuration/audit controls (A.12).

## 2. Authentication — two scenarios, only one is in scope for v1

### (a) SAP BTP / cloud-reachable Gateway — IN SCOPE for v1

SAP Gateway supports both **OAuth 2.0** and **Basic Authentication** depending on how the Gateway/backend is configured; SAP's own current guidance is that OAuth 2.0 is the recommended, more secure approach, with Basic Auth acceptable only where OAuth2 isn't configured (common on older/simpler Gateway setups, still frequently seen in the field).

**`auth_type: oauth2`** (preferred path):

1. In the SAP backend, an administrator registers an OAuth client via transaction **`SOAUTH2`** (or the newer **`OA2C_CONFIG`**) — this maps the target OData service to exactly one OAuth 2.0 scope.
2. The OAuth authorization server (either SAP's own AS ABAP OAuth server or an external IdP federated to it) issues client credentials; record the **Client ID**, **Client Secret**, and the **token endpoint URL**.
3. A backend role (via transaction `PFCG`) must grant the underlying OData service's authorization object (`S_SERVICE` plus the specific authorization objects the target Business/API Object requires) to the integration user tied to the OAuth scope — OAuth alone does not bypass ABAP authorization checks; the mapped user must independently hold the correct roles for the check to succeed. **The exact authorization objects required vary by which OData services the target instance exposes — confirm against the customer's actual `PFCG` role design, not assumed generically.**
4. Confirm SSL/TLS is enabled on the Gateway host (required for OAuth2 token exchange).
5. Have the customer confirm which specific OData services are activated for external consumption via transaction **`/IWFND/MAINT_SERVICE`** (the Gateway service catalog) — do not assume a service name exists; **this must be confirmed against the customer's actual Gateway service catalog per deployment.**

**`auth_type: api_key`** (Basic Auth fallback, when OAuth2 isn't configured on the target Gateway):

1. Create a dedicated, non-dialog **communication/integration user** (`SU01`, user type "Communication Data" or "System") scoped to read-only authorizations for the target OData services — never reuse a named/dialog user's credentials.
2. Assign a `PFCG` role granting `S_SERVICE` authorization for the confirmed OData service(s) plus read-only access to the underlying business objects, and nothing else.
3. Confirm the Gateway host enforces HTTPS — Basic Auth credentials must never be sent over plain HTTP.
4. Record the Gateway base URL, the communication user's username, and password.

### (b) On-premise SAP behind a customer network — OUT OF SCOPE for this connector's v1

If the customer's SAP instance is not directly internet-reachable, the only supported paths are:

- **SAP Cloud Connector**: an on-prem agent the customer installs and configures, which establishes an outbound-only tunnel from their network to SAP BTP's Connectivity/Destination service; SAP BTP then routes through it to reach the on-prem Gateway. This requires the customer to stand up and maintain their own Cloud Connector infrastructure and Destination configuration — Prism would be calling through infrastructure the customer owns and operates, not a direct API.
- **A customer-side reverse proxy/VPN** exposing the Gateway endpoint to Prism directly — equally a customer-side infrastructure commitment, with its own security review implications (opening a path from the internet to an internal SAP system).

Both paths have the same disposition as the TallyPrime connector: **do not build against this scenario until a specific customer commits to and stands up the relay infrastructure.** There is no generic "SAP on-prem connector" Prism can ship without that prerequisite existing per-customer.

### `config` shape (scenario a, OAuth2)

```json
{
  "gatewayBaseUrl": "https://yourcompany-gateway.example.com:8443",
  "clientId": "prism-evidence-client",
  "tokenUrl": "https://yourcompany-gateway.example.com:8443/sap/bc/sec/oauth2/token",
  "odataServicePath": "/sap/opu/odata/sap/ZPRISM_USER_AUTH_SRV"
}
```

### `secret` shape (scenario a, OAuth2)

```json
{
  "clientSecret": "***"
}
```

### `config`/`secret` shape (scenario a, Basic Auth fallback, `auth_type: api_key`)

```json
{
  "gatewayBaseUrl": "https://yourcompany-gateway.example.com:8443",
  "odataServicePath": "/sap/opu/odata/sap/ZPRISM_USER_AUTH_SRV"
}
```
```json
{
  "username": "PRISM_SVC",
  "password": "***"
}
```

## 3. API Reference

- **Base URL**: the customer's confirmed Gateway host, e.g. `https://<host>:<port>/sap/opu/odata/...` — there is no universal SAP base URL; this must come from customer discovery, not assumption.
- **Query language**: **OData** (v2, the more common Gateway default, or v4 on newer setups) — resource-and-query-option based (`$filter`, `$select`, `$expand`, `$top`, `$skip`), not SOQL/Table API-style query strings.
- **Service discovery**: the Gateway service catalog (`/IWFND/MAINT_SERVICE` in the backend, exposed externally at `/sap/opu/odata/iwfnd/CATALOGSERVICE;v=2/` for programmatic discovery) lists activated services. Each OData service has a `$metadata` document (`GET {servicePath}/$metadata`) describing its entity sets — inspect this per customer to identify the actual entity names, since **standard SAP delivers no single canonical "user"/"role" OData service name that's guaranteed present**; some customers expose user/role data through custom Z-services, others through partial standard content (e.g. `API_BUSINESS_PARTNER` covers business partner data, not `SU01` user master data), and IAM-oriented data is frequently not exposed via OData at all without custom development.
- **Pagination**: OData v2/v4 standard `$top`/`$skip`, or **server-side paging** via the `__next` link returned when a Gateway service enforces a max page size — follow `__next` rather than incrementing `$skip` blindly, since Gateway-enforced max-rows-per-request varies by service configuration.
- **Rate limits**: no universal published SAP Gateway rate limit — these are typically customer/Basis-team configured (via ICM connection limits, work process counts) and vary per instance; confirm with the customer's Basis team rather than assuming a number, and back off aggressively (SAP Gateway systems are frequently also serving interactive UI traffic and are more resource-constrained than a dedicated SaaS API tier).

## 4. Proposed Checks (feasibility-scoped: cloud-reachable Gateway, standard SAP content only)

These are scoped deliberately narrow — to what's plausible via commonly-available standard SAP Gateway/GRC content (e.g. via `GRAC_*` OData services if SAP GRC Access Control is licensed, or `SU01`/`PFCG`-adjacent custom Z-services many customers already expose) rather than assuming universal availability. **Confirm the actual entity/service names per customer before implementing any of these** — the `test_key` names below use SAP domain terms (users/roles/audit), not concrete confirmed OData paths, because those paths are not standardizable across SAP estates.

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `sap.user.no_inactive_privileged` | No locked/inactive users retain a privileged role | high | A.9.2.1 | Checks users marked locked (`SU01` lock status) or inactive via the exposed user OData entity do not still carry a privileged role (e.g. `SAP_ALL`, `SAP_NEW`, or a customer-defined admin composite role) in the exposed role-assignment entity. | Remove the role assignment via `PFCG`/`SU01` when a user is locked or deprovisioned; do not leave privileged roles attached to a locked account. |
| `sap.role.sap_all_assignment_bounded` | Assignment of the `SAP_ALL` profile/role is within policy | critical | A.9.2.3 | Checks the count of users assigned the `SAP_ALL` (or equivalent full-access) profile does not exceed the configured threshold — `SAP_ALL` grants unrestricted access and is a standard SAP hardening red flag. | Review `SAP_ALL` assignments in `SU01`/`PFCG` and replace with scoped composite roles built on least-privilege authorization objects. |
| `sap.role.segregation_of_duties_conflicts` | No user holds a known segregation-of-duties conflicting role pair | high | A.9.2.3 | Checks the exposed role-assignment entity for known SoD-conflicting pairs (e.g. a user holding both a "create vendor" and "approve payment" role) where the customer has a GRC Access Control ruleset exposed via OData. | Investigate and remediate the SoD conflict via SAP GRC Access Control (or manual role reassignment) per the customer's SoD ruleset. |
| `sap.password_policy.strength_enforced` | Password policy meets minimum strength requirements | high | A.9.4.3 | Checks the instance's password policy profile parameters (`login/min_password_lng`, `login/password_expiration_time`, etc., where exposed via a custom monitoring OData service) meet the company's policy baseline. | Update the relevant `login/*` profile parameters via transaction `RZ10`/`RZ11` and confirm they take effect via `RZ11` display. |
| `sap.audit.security_audit_log_active` | Security Audit Log (SAL) is active and recording | critical | A.12.4.1 | Checks the Security Audit Log (transaction `SM19`/`RSAU_CONFIG`, exposed via a custom monitoring OData service) is active on the target application server(s), evidencing audit logging isn't disabled. | Activate the Security Audit Log profile via `RSAU_CONFIG`/`SM19` and confirm it is enabled on all relevant application servers. |
| `sap.user.default_accounts_secured` | Default SAP accounts (`SAP*`, `DDIC`) are locked or have non-default passwords | critical | A.9.2.1 | Checks the standard default accounts are either locked or confirmed to have had their default password changed, per the exposed user status entity. | Lock `SAP*`/`DDIC` in all clients where not actively needed, and confirm password has been changed from the SAP-shipped default in any client where it must remain active. |

## 5. Seed SQL

```sql
-- ===== SAP connector: catalog seed data =====
-- NOTE: seed with status 'coming_soon' (or 'beta' at earliest) until a specific
-- customer's Gateway connectivity and OData service catalog have been confirmed
-- per the feasibility note in section 1 — do not seed as 'active'.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('sap', 'SAP', 'business_apps', 'oauth2', 'coming_soon')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('sap', 'sap.user.no_inactive_privileged', 'No locked/inactive users retain a privileged role', 'Checks locked or inactive users do not still carry a privileged role (e.g. SAP_ALL or a customer-defined admin composite role).', 'high', 'Remove the role assignment via PFCG/SU01 when a user is locked or deprovisioned; do not leave privileged roles attached to a locked account.'),
  ('sap', 'sap.role.sap_all_assignment_bounded', 'Assignment of the SAP_ALL profile/role is within policy', 'Checks the count of users assigned SAP_ALL (or equivalent full-access) does not exceed the configured threshold.', 'critical', 'Review SAP_ALL assignments in SU01/PFCG and replace with scoped composite roles built on least-privilege authorization objects.'),
  ('sap', 'sap.role.segregation_of_duties_conflicts', 'No user holds a known segregation-of-duties conflicting role pair', 'Checks for known SoD-conflicting role pairs where the customer has a GRC Access Control ruleset exposed via OData.', 'high', 'Investigate and remediate the SoD conflict via SAP GRC Access Control (or manual role reassignment) per the customer''s SoD ruleset.'),
  ('sap', 'sap.password_policy.strength_enforced', 'Password policy meets minimum strength requirements', 'Checks the instance''s password policy profile parameters meet the company''s policy baseline.', 'high', 'Update the relevant login/* profile parameters via transaction RZ10/RZ11 and confirm they take effect.'),
  ('sap', 'sap.audit.security_audit_log_active', 'Security Audit Log (SAL) is active and recording', 'Checks the Security Audit Log is active on the target application server(s), evidencing audit logging isn''t disabled.', 'critical', 'Activate the Security Audit Log profile via RSAU_CONFIG/SM19 and confirm it is enabled on all relevant application servers.'),
  ('sap', 'sap.user.default_accounts_secured', 'Default SAP accounts (SAP*, DDIC) are locked or have non-default passwords', 'Checks default accounts are either locked or confirmed to have had their default password changed.', 'critical', 'Lock SAP*/DDIC in all clients where not actively needed, and confirm password has been changed from the SAP-shipped default in any client where it must remain active.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('sap.user.no_inactive_privileged', 'A.9.2.1'),
  ('sap.role.sap_all_assignment_bounded', 'A.9.2.3'),
  ('sap.role.segregation_of_duties_conflicts', 'A.9.2.3'),
  ('sap.password_policy.strength_enforced', 'A.9.4.3'),
  ('sap.audit.security_audit_log_active', 'A.12.4.1'),
  ('sap.user.default_accounts_secured', 'A.9.2.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `sap` (used in `registry.js`), **but do not wire it into `registry.js` or schedule engineering time until the prerequisite discovery below is complete.**
- **Suggested files** (once discovery is complete and a build is scheduled):
  - `api/src/connectors/sap/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, structurally similar to `api/src/connectors/azure/index.js`, but the OData client and service paths must be parameterized per customer `config.odataServicePath` rather than hardcoded, since service names are not standard across SAP estates.
  - `api/src/connectors/sap/credentials.js` — `resolveSapCredentials({ authType, config, secret })`: branches on `oauth2` (client-credentials-style token fetch against `config.tokenUrl`) vs `api_key` (Basic Auth header construction) per §2.
  - `api/src/connectors/sap/client.js` — thin OData client: `$metadata` introspection, `$filter`/`$select`/`$top`/`$skip` query building, `__next` pagination following.
  - `api/src/connectors/sap/tests/users.js`, `tests/roles.js`, `tests/audit.js` — grouped by resource area; each test's `run(clients)` should be defensive about missing entities (catch 404 on an OData entity set and return a clear "not applicable — service/entity not present on this instance" result rather than throwing), since service availability is customer-specific.
- **Recommendation: build after confirming customer connectivity model — do NOT schedule alongside Salesforce/ServiceNow.** Concretely, before any implementation work starts on this connector:
  1. Confirm with the specific customer whether their SAP instance's Gateway is directly internet-reachable, reachable via a customer-managed relay they're willing to stand up (Cloud Connector or VPN/proxy), or not reachable at all (in which case this connector is not buildable for that customer — same disposition as TallyPrime).
  2. If reachable, obtain that customer's actual Gateway service catalog (`/IWFND/MAINT_SERVICE` export or equivalent) and confirm which OData services expose user/role/audit data — do not assume the service names used as placeholders in §3/§4 exist.
  3. Confirm OAuth2 vs Basic Auth availability on that specific Gateway configuration.
  4. Only then finalize the check list and `config`/`secret` shapes against the confirmed service paths, and schedule the build.
