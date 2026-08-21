# CrowdStrike Connector

## 1. Overview

- **Proposed `integrations.category`**: `security`
- **Proposed `integrations.key`**: `crowdstrike`
- **Proposed `integrations.auth_type`**: `oauth2`

CrowdStrike Falcon is an endpoint detection and response (EDR) platform. This connector reads endpoint (host) inventory, sensor policy assignment, detections, and vulnerability exposure from a customer's Falcon tenant to evidence endpoint protection/malware controls (ISO 27001 Annex A.12.2), vulnerability management (A.12.6), and monitoring/logging (A.12.4).

Scope for v1: read-only checks against the Falcon REST API's Hosts, Sensor Update Policy, Detections/Alerts, and Spotlight Vulnerabilities collections. No write access is required.

## 2. Authentication

**`auth_type`: `oauth2`**

Falcon uses **OAuth2 client credentials** exclusively for API clients — there is no alternative API-key or username/password mode for programmatic access; every API client is created and scoped in the Falcon console under **Support and resources > API Clients and Keys** ([CrowdStrike API Reference](https://developer.crowdstrike.com/api-reference/overview/)).

### Setup steps (Falcon console)

1. In the Falcon console, go to **Support and resources > API Clients and Keys**.
2. Click **Add new API client**, give it a descriptive name (e.g. "Prism Compliance Reader").
3. Under **API Scopes**, select only the read scopes this connector needs (grant nothing broader):
   - **Hosts** — Read (`hosts:read`) — device/endpoint inventory (OS, sensor version, last seen, containment status).
   - **Sensor Update Policies** — Read (`sensor-update-policies:read`) — sensor policy assignment and channel/build pinning.
   - **Detections** — Read (`detects:read`) — legacy detection records (severity, host, status). CrowdStrike is migrating detections onto the newer **Alerts** API; request both during the transition period.
   - **Alerts** — Read (`alerts:read`) — the current unified alert stream (supersedes Detects for most alert types going forward).
   - **User Management** — Read (`user-management:read`) — Falcon console user/role inventory, for admin-role review checks.
   - **Host Groups** — Read (`host-groups:read`) — used to scope/segment host-level checks by group (e.g. production vs. dev).
   - **Spotlight Vulnerabilities** — Read (`spotlight-vulnerabilities:read`) — exposed CVEs per host, remediation status.
4. Save. CrowdStrike displays the **Client ID** and **Client Secret** exactly once — copy both immediately; the secret cannot be retrieved again (only regenerated, which invalidates the old one).
5. Note the **cloud region** for this Falcon tenant (visible in the console URL, e.g. `falcon.crowdstrike.com` = US-1, `falcon.us-2.crowdstrike.com` = US-2, `falcon.eu-1.crowdstrike.com` = EU-1, `falcon.laggar.gcw.crowdstrike.com` = US-GOV-1). This determines the API base URL (see below) — CrowdStrike does not have a single global API host, and using the wrong regional host will fail authentication entirely for that tenant.

### `config` shape (non-secret, stored on `integration_connections.config`)

```json
{
  "cloudRegion": "us-1",
  "baseUrl": "https://api.crowdstrike.com"
}
```

`cloudRegion` is one of `us-1`, `us-2`, `eu-1`, `us-gov-1`, `us-gov-2` and `baseUrl` is stored explicitly (rather than derived at call time) so a tenant's region is unambiguous even if CrowdStrike's region-list changes.

### `secret` shape (encrypted, stored via `integration_credentials`)

```json
{
  "clientId": "abcd1234...",
  "clientSecret": "XyZ...redacted..."
}
```

The connector exchanges these for a bearer token via `POST {baseUrl}/oauth2/token` (`client_id` + `client_secret` as form-encoded body params), receiving a short-lived (~30 minute) bearer token to attach as `Authorization: Bearer {token}` on subsequent calls; the connector must re-authenticate per run rather than assuming the token outlives a single collection cycle.

## 3. API Reference

- **Base URL (region-dependent — this is the most important integration detail for this connector)**:
  - US-1 (default): `https://api.crowdstrike.com`
  - US-2: `https://api.us-2.crowdstrike.com`
  - EU-1: `https://api.eu-1.crowdstrike.com`
  - US-GOV-1: `https://api.laggar.gcw.crowdstrike.com`
  - A tenant is fixed to one region at signup; there is no cross-region API — `config.baseUrl` must match the console URL's region exactly.
- **Token endpoint**: `POST {baseUrl}/oauth2/token`.
- **Pagination**: offset-based on query/combined endpoints — `offset` and `limit` (default 100, max varies by endpoint, commonly up to 500) query params, with the response's `meta.pagination.total` indicating when to stop paging.
- **Rate limits**: CrowdStrike does not publish fixed numeric limits; limits are enforced per API client and vary by endpoint/tenant tier. A `429` response should be handled by inspecting `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-RetryAfter` response headers and backing off accordingly, rather than assuming a fixed request budget.
- **Key endpoints**:
  - `GET /devices/queries/devices/v1` + `POST /devices/entities/devices/v2` — host ID query + detail hydration (OS, sensor version, `last_seen`, `reduced_functionality_mode`).
  - `GET /policy/queries/sensor-update/v1` + `POST /policy/entities/sensor-update/v2` — sensor update policy definitions and assigned host groups.
  - `GET /alerts/queries/alerts/v2` + `POST /alerts/entities/alerts/v2` — current unified alert stream (severity, status, host).
  - `GET /detects/queries/detects/v1` + `POST /detects/entities/summaries/GET/v1` — legacy Detects API (severity, status, host) during the Alerts migration window.
  - `GET /spotlight/queries/vulnerabilities/v2` + `POST /spotlight/entities/vulnerabilities/v2` — per-host CVE exposure, CVSS score, remediation status.
  - `GET /user-management/queries/users/v1` + role-entity lookups — Falcon console user/role inventory.
- **Docs**: [CrowdStrike API Reference overview](https://developer.crowdstrike.com/api-reference/overview/) · [FalconPy authentication guide](https://developer.crowdstrike.com/sdks/python/authentication/) (community SDK docs — used here for the client-credentials flow shape, not as a hard dependency)

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `crowdstrike.host.stale_endpoints_reviewed` | No endpoints have gone stale without review | high | A.12.2.1 | Checks hosts (`/devices/entities/devices/v2`) whose `last_seen` exceeds a defined staleness threshold (default 30 days) are flagged rather than left silently unmanaged/unmonitored. | Investigate stale hosts to confirm they are decommissioned rather than simply offline; remove decommissioned assets from the fleet and reconcile against the asset inventory. |
| `crowdstrike.host.unmanaged_reduced_functionality` | No hosts are running in reduced functionality / sensor-degraded mode | high | A.12.2.1 | Checks hosts do not report `reduced_functionality_mode` or an equivalent degraded-sensor state, which indicates the sensor is installed but not providing full protection. | Investigate hosts in reduced functionality mode — commonly caused by license/policy misassignment or sensor tampering — and restore full protection. |
| `crowdstrike.sensor.policy_compliance` | All managed hosts are assigned an active sensor update policy | high | A.12.2.1 | Checks every host in `/devices/entities/devices/v2` maps to an active (non-default/non-empty) sensor update policy via `/policy/entities/sensor-update/v2`, rather than falling back to an unmanaged default. | Assign each host group an explicit sensor update policy under Host setup and management > Sensor update policies, rather than leaving hosts on the platform default. |
| `crowdstrike.sensor.build_currency` | Sensor update policies pin to a current (not deprecated) sensor build | medium | A.12.6.1 | Checks each sensor update policy's configured build/channel is not flagged deprecated or more than N versions behind the latest available build for its platform. | Update the sensor policy's build/channel assignment under Sensor update policies to a current, supported build. |
| `crowdstrike.detection.high_severity_backlog` | High/critical severity detections are triaged within SLA | critical | A.16.1.5 | Checks alerts/detections (`/alerts/entities/alerts/v2`, `/detects/entities/summaries/GET/v1`) with `severity` critical/high do not remain in an open/new status beyond the defined triage SLA (default 24-48 hours). | Triage the open high-severity detections listed in Falcon's Activity dashboard and update their status once investigated; if the backlog is systemic, review analyst staffing/alerting thresholds. |
| `crowdstrike.detection.no_unresolved_incidents` | No detections remain in an unresolved state past the review window | high | A.16.1.5 | Checks detections/alerts do not sit in `new` or `in_progress` status past a defined maximum age (default 7 days) regardless of severity. | Close out or explicitly defer aged detections with documented justification; investigate why detections are aging past the review window. |
| `crowdstrike.vulnerability.critical_exposure_review` | Critical/high CVE exposure on managed hosts is within policy | critical | A.12.6.1 | Checks Spotlight vulnerability records (`/spotlight/entities/vulnerabilities/v2`) with a critical/high severity and a remediation status other than "closed"/"remediated" do not exceed the defined age threshold (default 30 days for critical, 90 for high). | Patch or mitigate the flagged CVEs per the vulnerability management policy's SLA, or document a compensating control/risk acceptance for exceptions. |
| `crowdstrike.user.admin_role_review` | Falcon console admin roles are limited to a reviewed set of accounts | medium | A.9.2.3 | Checks `/user-management/queries/users/v1` role assignments for the Falcon Administrator (or equivalent full-access) role against an expected roster. | Review Falcon console user roles under User Management and remove administrator access from accounts that no longer require it. |

## 5. Seed SQL

```sql
-- ===== CrowdStrike connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('crowdstrike', 'CrowdStrike Falcon', 'security', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('crowdstrike', 'crowdstrike.host.stale_endpoints_reviewed', 'No endpoints have gone stale without review', 'Checks hosts whose last-seen timestamp exceeds a defined staleness threshold are flagged rather than left silently unmanaged.', 'high', 'Investigate stale hosts to confirm they are decommissioned rather than simply offline; remove decommissioned assets from the fleet and reconcile against the asset inventory.'),
  ('crowdstrike', 'crowdstrike.host.unmanaged_reduced_functionality', 'No hosts are running in reduced functionality / sensor-degraded mode', 'Checks hosts do not report a reduced functionality or degraded-sensor state, which indicates the sensor is installed but not providing full protection.', 'high', 'Investigate hosts in reduced functionality mode - commonly caused by license/policy misassignment or sensor tampering - and restore full protection.'),
  ('crowdstrike', 'crowdstrike.sensor.policy_compliance', 'All managed hosts are assigned an active sensor update policy', 'Checks every managed host maps to an active, non-default sensor update policy rather than falling back to an unmanaged default.', 'high', 'Assign each host group an explicit sensor update policy under Host setup and management > Sensor update policies, rather than leaving hosts on the platform default.'),
  ('crowdstrike', 'crowdstrike.sensor.build_currency', 'Sensor update policies pin to a current (not deprecated) sensor build', 'Checks each sensor update policy''s configured build/channel is not flagged deprecated or more than N versions behind the latest available build.', 'medium', 'Update the sensor policy''s build/channel assignment under Sensor update policies to a current, supported build.'),
  ('crowdstrike', 'crowdstrike.detection.high_severity_backlog', 'High/critical severity detections are triaged within SLA', 'Checks critical/high severity alerts and detections do not remain in an open or new status beyond the defined triage SLA.', 'critical', 'Triage the open high-severity detections listed in Falcon''s Activity dashboard and update their status once investigated; if the backlog is systemic, review analyst staffing/alerting thresholds.'),
  ('crowdstrike', 'crowdstrike.detection.no_unresolved_incidents', 'No detections remain in an unresolved state past the review window', 'Checks detections and alerts do not sit in a new or in-progress status past a defined maximum age regardless of severity.', 'high', 'Close out or explicitly defer aged detections with documented justification; investigate why detections are aging past the review window.'),
  ('crowdstrike', 'crowdstrike.vulnerability.critical_exposure_review', 'Critical/high CVE exposure on managed hosts is within policy', 'Checks critical/high severity vulnerability records with a non-remediated status do not exceed the defined age threshold.', 'critical', 'Patch or mitigate the flagged CVEs per the vulnerability management policy''s SLA, or document a compensating control/risk acceptance for exceptions.'),
  ('crowdstrike', 'crowdstrike.user.admin_role_review', 'Falcon console admin roles are limited to a reviewed set of accounts', 'Checks Falcon console administrator role assignments against an expected roster.', 'medium', 'Review Falcon console user roles under User Management and remove administrator access from accounts that no longer require it.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('crowdstrike.host.stale_endpoints_reviewed', 'A.12.2.1'),
  ('crowdstrike.host.unmanaged_reduced_functionality', 'A.12.2.1'),
  ('crowdstrike.sensor.policy_compliance', 'A.12.2.1'),
  ('crowdstrike.sensor.build_currency', 'A.12.6.1'),
  ('crowdstrike.detection.high_severity_backlog', 'A.16.1.5'),
  ('crowdstrike.detection.no_unresolved_incidents', 'A.16.1.5'),
  ('crowdstrike.vulnerability.critical_exposure_review', 'A.12.6.1'),
  ('crowdstrike.user.admin_role_review', 'A.9.2.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `crowdstrike` (used in `registry.js`).
- **Suggested files**:
  - `api/src/connectors/crowdstrike/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/aws/index.js`'s structure (builds a token-authenticated client, runs each test's `run(clients)`).
  - `api/src/connectors/crowdstrike/credentials.js` — `resolveCrowdstrikeCredentials({ authType, config, secret })`: validates `authType === "oauth2"`, POSTs `client_id`/`client_secret` to `{config.baseUrl}/oauth2/token`, returns `{ accessToken, baseUrl: config.baseUrl }`. Must re-fetch the token per `runTests()` invocation given the ~30 minute lifetime — do not cache across scheduled runs.
  - `api/src/connectors/crowdstrike/client.js` — thin `fetch`-based wrapper implementing the two-step query-then-hydrate pattern common to Falcon endpoints (`.../queries/.../v1` returns IDs, `.../entities/.../v2` hydrates them in batches), plus offset-pagination and 429/`X-RateLimit-*` handling.
  - `api/src/connectors/crowdstrike/tests/hosts.js` — `checkStaleEndpointsReviewed`, `checkUnmanagedReducedFunctionality`.
  - `api/src/connectors/crowdstrike/tests/sensorPolicy.js` — `checkSensorPolicyCompliance`, `checkBuildCurrency`.
  - `api/src/connectors/crowdstrike/tests/detections.js` — `checkHighSeverityBacklog`, `checkNoUnresolvedIncidents`.
  - `api/src/connectors/crowdstrike/tests/vulnerabilities.js` — `checkCriticalExposureReview`.
  - `api/src/connectors/crowdstrike/tests/users.js` — `checkAdminRoleReview`.
- **Registry wiring**: add `import * as crowdstrike from "./crowdstrike/index.js";` and `[crowdstrike.key]: crowdstrike` to `api/src/connectors/registry.js`.
- **Regional/multi-cloud consideration (the sharpest edge in this connector)**: unlike AWS/Azure where a single global/tenant-scoped endpoint works regardless of physical region, CrowdStrike's regions are **fully separate API hosts with no cross-region routing** — a client credential pair created in a EU-1 tenant will fail authentication entirely against `api.crowdstrike.com`. `config.baseUrl` must be captured explicitly at connection setup (not inferred), and the connection UI/setup wizard should offer the region as an explicit dropdown rather than a free-text field, to prevent a copy-pasted wrong host from silently breaking the connector.
- **`testConnection()`**: perform the OAuth2 token exchange itself as the connectivity probe (a successful token response already confirms both connectivity and credential validity), then optionally follow with a cheap `GET /devices/queries/devices/v1?limit=1` to confirm the granted scopes actually include Hosts read — CrowdStrike's token endpoint does not itself validate which scopes are usable, only that the client exists.
- **Detects vs. Alerts migration**: CrowdStrike is deprecating the legacy Detects API in favor of the unified Alerts API; implement `crowdstrike.detection.*` checks against Alerts first and fall back to Detects only if `alerts:read` wasn't granted, so the connector doesn't break for tenants that migrate ahead of a hard cutover date.
