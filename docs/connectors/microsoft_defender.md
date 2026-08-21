# Microsoft Defender Connector (proposed)

Status: design spec, not yet implemented. Follows the existing connector pattern (see
`api/src/connectors/purview/` for the plain-`fetch` + multi-resource-token shape this connector
should copy, and `docs/connectors/entra_id.md` for the shared Azure AD app registration this
connector reuses — with one important exception, see Authentication below).

## 1. Overview

- **Connector key**: `microsoft_defender`
- **Category**: `endpoint_security` (free-text, no DB constraint — distinct from `azure`'s `cloud`
  and `microsoft_365`'s `collaboration`, since this connector's data (devices, vulnerabilities,
  alerts) is neither cloud-infrastructure nor collaboration-workload data).
- **Audit scope**: **Microsoft Defender for Endpoint** — onboarded device/machine inventory and
  health, discovered software vulnerabilities and their remediation status, security
  recommendations (Defender's policy/configuration-improvement surface), and security alerts —
  i.e. exactly the "Devices, vulnerabilities, alerts, security policies" scope from the
  prioritization sheet, where "security policies" maps to Defender's recommendation/exposure-score
  surface rather than a separate Intune policy API.
- **Boundary vs. the other 4 Microsoft connectors in this group**:
  - **`microsoft_365`** (existing sibling doc) explicitly draws this exact boundary already: its
    Overview states *"Defender for Endpoint (devices, vulnerabilities, endpoint alerts): that's
    `microsoft_defender`'s job. This connector only covers **Defender for Office 365** (email
    protection: Safe Links, Safe Attachments)."* That is a clean, non-overlapping split — this
    connector proposes zero Safe Links/Safe Attachments checks, and `microsoft_365.md` proposes
    zero device/vulnerability/alert checks. No `test_key` namespace collision to reconcile.
  - **`azure`** (existing connector, extended by its own sibling doc): **Microsoft Defender for
    Cloud** (Azure workload-protection plan enablement) is already a live check there
    (`azure.security.defender_enabled`, `A.12.1.1`, in `api/src/connectors/azure/tests/logging.js`).
    That is a distinct product (Cloud Security Posture Management for Azure resources) from
    Defender for Endpoint (device/EDR telemetry) covered here, despite the shared "Defender"
    branding — this connector does not touch ARM or re-check Defender for Cloud's plan-enablement
    state.
  - **`entra_id`**: Entra ID Protection risk detections (risky users/sign-ins) are a related but
    separate identity-risk signal, not proposed in either `entra_id.md` or here — out of scope for
    this pass in both docs, not silently duplicated.
  - **`microsoft_teams`**: Teams-specific external-access/guest/policy configuration is entirely
    out of scope here, even though Teams chat/meetings are a common vector Defender for Endpoint
    alerts reference.

## 2. Authentication

- **`auth_type`**: `oauth2` — client-credentials flow against the **same underlying Azure AD app
  registration** as `entra_id`/`microsoft_365`/`microsoft_teams` (see "Shared app registration" in
  `docs/connectors/entra_id.md`). However, this connector is the one place in the group where
  Microsoft Graph consent is **not enough on its own** — Defender for Endpoint exposes its own API
  surface with its own resource/audience and its own separate consent step.

### Setup steps

1. Reuse the shared app registration (or create one — see `entra_id.md` step 2) in
   **Microsoft Entra ID > App registrations**.
2. **API permissions > Add a permission > APIs my organization uses**, search for
   **`WindowsDefenderATP`** (this is the internal/legacy name for the Defender for Endpoint API;
   it does not appear in the default "Microsoft APIs" tab — start typing the exact name for it to
   appear, exactly as `microsoft_365.md` notes for the Exchange Online Admin API resource). Add
   **Application permissions**:
   - `Machine.Read.All` — device/machine inventory (`GET /api/machines`).
   - `Vulnerability.Read.All` — discovered vulnerabilities per device
     (`GET /api/machines/{id}/vulnerabilities`, `GET /api/vulnerabilities/machinesVulnerabilities`).
   - `SecurityRecommendation.Read.All` — security recommendations
     (`GET /api/recommendations`).
   - `Alert.Read.All` — alerts (`GET /api/alerts` and the per-entity alert-lookup endpoints).
     **Verify at implementation time**: Microsoft's own "List alerts API" reference page
     currently lists only `Alert.ReadWrite.All` as the accepted permission for `GET /api/alerts`,
     while the Hello World tutorial and several other alert-lookup endpoints (e.g. "Get IP related
     alerts", "Get user-related alerts") document `Alert.Read.All` as sufficient. Request
     `Alert.Read.All` first since it's least-privileged and matches the tutorial/most endpoints;
     if `GET /api/alerts` itself rejects it in practice, fall back to `Alert.ReadWrite.All` and
     note the discrepancy — this is a live inconsistency in Microsoft's documentation, not
     something to silently paper over.
3. Select **Grant admin consent for `<tenant>`** for the `WindowsDefenderATP` permissions above —
   this is a **separate consent grant** from the Microsoft Graph consent used by
   `entra_id`/`microsoft_365`/`microsoft_teams`, because it's a different API resource in Entra ID
   (a second application registration entry under "Enterprise applications" gets created
   automatically for `WindowsDefenderATP` the first time any tenant app requests it — this is
   normal, not a sign of misconfiguration).
4. In Prism, create the `microsoft_defender` integration connection and enter the `config`/`secret`
   below (same `tenantId`/`clientId`/`clientSecret` triple as the other Microsoft connectors if the
   app registration is shared — the distinction is entirely in which resource the token is scoped
   to at request time, not in which credentials are used).

### The distinct token-audience consideration

This is the detail most likely to trip up implementation, so it's called out on its own:

- Every other connector in this group requests a token with
  `scope=https://graph.microsoft.com/.default` (Graph audience).
- Defender for Endpoint API calls are made against `https://api.security.microsoft.com` (the
  current, unified, geo-flexible endpoint — regional variants like `us.api.security.microsoft.com`
  also exist for reduced latency), but **the token must still be requested for the legacy resource
  `https://api.securitycenter.microsoft.com`** — Microsoft's own docs confirm *"Some Microsoft
  Defender for Endpoint APIs continue to require access tokens issued for the legacy resource
  `https://api.securitycenter.microsoft.com`. If the token audience doesn't match the resource
  expected by the API, requests fail with `403 Forbidden`, even if the API endpoint uses
  `https://api.security.microsoft.com`."*
- Concretely: `POST https://login.microsoftonline.com/{tenantId}/oauth2/token` (v1 token endpoint,
  matching the shape `purview/credentials.js` already uses, not the v2.0 endpoint) with
  `resource=https://api.securitycenter.microsoft.com`, then send the resulting bearer token
  against `https://api.security.microsoft.com/api/...` URLs. The **request URL and the token
  audience are two different strings** — this is the one place in the whole Microsoft connector
  group where that's true, and it's easy to "fix" incorrectly by assuming they should match.

### `config` / `secret` shapes

```json
// integration_connections.config
{
  "tenantId": "contoso.onmicrosoft.com"
}
```

```json
// integration_credentials (decrypted secret shape)
{
  "clientId": "11111111-1111-1111-1111-111111111111",
  "clientSecret": "<client secret value>"
}
```

## 3. API Reference

- **Base URL**: `https://api.security.microsoft.com` (unified endpoint; legacy
  `https://api.securitycenter.microsoft.com` still works for the API calls themselves and appears
  in some older docs/examples, but Microsoft's current guidance is to call the unified endpoint —
  only the **token audience**, not the request URL, must stay pinned to the legacy resource string,
  per the caveat above).
- **API surface**: this is a bespoke REST API (OData V4 query support, not Graph), not part of
  `graph.microsoft.com` — a structurally separate surface from every other connector in this
  group except in that it's issued by the same Azure AD tenant.
- **Pagination**: OData `$top` (max `10,000` per request) and `$skip` — **not** the
  `@odata.nextLink` cursor pattern the Graph-backed connectors (`entra_id`, `microsoft_365`,
  `microsoft_teams`) use. Do not reuse `graphPaginate()` here; this connector needs its own
  `$top`/`$skip` pagination loop.
- **Rate limiting**: varies by endpoint, not a single tenant-wide limit —
  `GET /api/machines` and `GET /api/alerts` are each limited to 100 calls/minute and 1,500
  calls/hour; vulnerability/recommendation export-style endpoints are more restrictive at 30
  calls/minute and 1,000 calls/hour. `429` responses include a standard throttling error body;
  honor it with a bounded retry, consistent with how the rest of this connector group handles
  `Retry-After`.
- **Alternate surface, noted but not used here**: Microsoft Graph's own Security API
  (`GET https://graph.microsoft.com/v1.0/security/alerts_v2`, permission `SecurityAlert.Read.All`)
  also surfaces Defender alerts (and, per community reports, Defender for Office 365 alerts
  alongside Defender for Endpoint ones) through the ordinary Graph audience. It's mentioned here
  only so a future implementer doesn't wonder why this connector didn't just use Graph for alerts
  too — `alerts_v2` doesn't expose the machine/vulnerability/recommendation data this connector
  also needs, so the connector would still need the Defender for Endpoint API's own audience
  regardless; consolidating everything on one surface (Defender for Endpoint API) is simpler than
  splitting alerts onto Graph and everything else onto `api.security.microsoft.com`.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `microsoft_defender.devices.onboarding_coverage_complete` | Managed devices are onboarded to Defender for Endpoint | high | A.8.1.1 | Checks the device inventory (`GET /api/machines`) reports no device with `onboardingStatus` of `CanBeOnboarded` or `InsufficientInfo` left unresolved, i.e. every discoverable device is either `Onboarded` or explicitly `Unsupported`. | Onboard the flagged devices to Defender for Endpoint via Intune, Group Policy, or the onboarding script under the Defender portal > Settings > Endpoints > Onboarding. |
| `microsoft_defender.devices.sensor_health_active` | Onboarded devices report active sensor health | medium | A.12.2.1 | Checks onboarded devices (`GET /api/machines`) do not have `healthStatus` of `Inactive` or `ImpairedCommunication` beyond a defined grace period, which would indicate the endpoint sensor has stopped reporting. | Investigate devices with impaired or inactive sensor health under the Defender portal > Device inventory — check network connectivity to Defender cloud service URLs and sensor service status on the device. |
| `microsoft_defender.devices.high_exposure_devices_remediated` | High-exposure devices have an active remediation plan | high | A.12.6.1 | Checks devices with `exposureLevel: "High"` (`GET /api/machines`) are not left in that state indefinitely — either their exposure score is trending down or they have open, assigned recommendations/remediation activity. | Prioritize remediation of the security recommendations affecting high-exposure devices under Defender Vulnerability Management > Device inventory, filtered to high exposure level. |
| `microsoft_defender.vulnerabilities.critical_cves_remediated` | Critical vulnerabilities with a public exploit are remediated within SLA | critical | A.12.6.1 | Checks discovered vulnerabilities (`GET /api/vulnerabilities/machinesVulnerabilities`, filterable by `severity`) with `severity: "Critical"` and a known public exploit are not older than a defined remediation SLA (default 14 days) since first discovery. | Patch or otherwise remediate the affected software per the linked security recommendation, prioritizing vulnerabilities with `publicExploit: true`. |
| `microsoft_defender.recommendations.high_impact_open_reviewed` | High-impact security recommendations are actioned or have a documented exception | high | A.12.6.1 | Checks security recommendations (`GET /api/recommendations`) with high `exposureImpact`/`configScoreImpact` and no active exception (`status` other than `Exception`) are not left open beyond a defined review cadence. | Remediate the recommendation, or file a documented exception with business justification under Defender Vulnerability Management > Recommendations. |
| `microsoft_defender.alerts.high_severity_triaged_promptly` | High and critical severity alerts are triaged within SLA | critical | A.16.1.5 | Checks alerts (`GET /api/alerts`, filterable by `severity`/`status`) with `severity` of `High` or `Critical` do not remain in `status: "New"` beyond a defined triage SLA (default 24 hours) from `alertCreationTime`. | Assign and triage the flagged alerts under the Defender portal > Incidents & alerts, and tune detection/automation rules if a recurring category is consistently missed. |
| `microsoft_defender.alerts.no_unassigned_critical_alerts` | Critical alerts are assigned to an owner | medium | A.16.1.2 | Checks alerts with `severity: "Critical"` have a non-empty `assignedTo` field, evidencing that incident ownership — not just visibility — is established for the organization's most severe detections. | Assign an owner to each unassigned critical alert under the Defender portal > Incidents & alerts, or configure automated investigation and response to auto-assign where appropriate. |

## 5. Seed SQL

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('microsoft_defender', 'Microsoft Defender', 'endpoint_security', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('microsoft_defender', 'microsoft_defender.devices.onboarding_coverage_complete', 'Managed devices are onboarded to Defender for Endpoint', 'Checks no discoverable device is left un-onboarded (CanBeOnboarded or InsufficientInfo status).', 'high', 'Onboard the flagged devices via Intune, Group Policy, or the onboarding script under Defender portal > Settings > Endpoints > Onboarding.'),
  ('microsoft_defender', 'microsoft_defender.devices.sensor_health_active', 'Onboarded devices report active sensor health', 'Checks onboarded devices do not report Inactive or ImpairedCommunication health status beyond a grace period.', 'medium', 'Investigate devices with impaired or inactive sensor health under Defender portal > Device inventory.'),
  ('microsoft_defender', 'microsoft_defender.devices.high_exposure_devices_remediated', 'High-exposure devices have an active remediation plan', 'Checks devices with High exposure level are not left without remediation activity.', 'high', 'Prioritize remediation of security recommendations affecting high-exposure devices.'),
  ('microsoft_defender', 'microsoft_defender.vulnerabilities.critical_cves_remediated', 'Critical vulnerabilities with a public exploit are remediated within SLA', 'Checks Critical severity vulnerabilities with a known public exploit are not older than the defined remediation SLA.', 'critical', 'Patch or remediate the affected software per the linked security recommendation, prioritizing public-exploit vulnerabilities.'),
  ('microsoft_defender', 'microsoft_defender.recommendations.high_impact_open_reviewed', 'High-impact security recommendations are actioned or have a documented exception', 'Checks high-impact recommendations without an active exception are not left open beyond the review cadence.', 'high', 'Remediate the recommendation or file a documented exception under Defender Vulnerability Management > Recommendations.'),
  ('microsoft_defender', 'microsoft_defender.alerts.high_severity_triaged_promptly', 'High and critical severity alerts are triaged within SLA', 'Checks High/Critical severity alerts do not remain in New status beyond the triage SLA.', 'critical', 'Assign and triage the flagged alerts under Defender portal > Incidents & alerts.'),
  ('microsoft_defender', 'microsoft_defender.alerts.no_unassigned_critical_alerts', 'Critical alerts are assigned to an owner', 'Checks Critical severity alerts have a non-empty assignedTo field.', 'medium', 'Assign an owner to each unassigned critical alert, or configure automated investigation and response.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('microsoft_defender.devices.onboarding_coverage_complete', 'A.8.1.1'),
  ('microsoft_defender.devices.sensor_health_active', 'A.12.2.1'),
  ('microsoft_defender.devices.high_exposure_devices_remediated', 'A.12.6.1'),
  ('microsoft_defender.vulnerabilities.critical_cves_remediated', 'A.12.6.1'),
  ('microsoft_defender.recommendations.high_impact_open_reviewed', 'A.12.6.1'),
  ('microsoft_defender.alerts.high_severity_triaged_promptly', 'A.16.1.5'),
  ('microsoft_defender.alerts.no_unassigned_critical_alerts', 'A.16.1.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `microsoft_defender` — new entry in `api/src/connectors/registry.js`:
  `import * as microsoftDefender from "./microsoft_defender/index.js";` and add
  `[microsoftDefender.key]: microsoftDefender` to the `connectors` map.
- **Files to add**:
  - `api/src/connectors/microsoft_defender/credentials.js` — **does not** call the shared
    `resolveMicrosoftGraphCredentials()` helper from `entra_id.md` as-is, because that helper's
    default resource (`https://graph.microsoft.com`) is wrong for this connector. Instead, call it
    with an explicit `resource: "https://api.securitycenter.microsoft.com"` override — the helper
    was designed generically enough (per its description in `entra_id.md`) for exactly this case:
    "the other three connectors pass a different resource string for their non-Graph API
    surfaces ... Defender for Endpoint ... while reusing the same token-POST and caching logic."
    This connector is the concrete case that proves out that part of the shared helper's design;
    it should not need a bespoke `fetchToken` implementation of its own.
  - `api/src/connectors/microsoft_defender/index.js` — `key`, `tests`, `testConnection` (probe
    `GET /api/machines?$top=1` — cheap, requires only `Machine.Read.All`), `runTests`, and
    `describeDefenderError()` — modeled on `purview/index.js`'s `describePurviewError()` shape,
    substring-matching the common `403 Forbidden` "token audience mismatch" failure mode described
    above so a misconfigured token resource produces an actionable error message instead of a bare
    403.
  - `api/src/connectors/microsoft_defender/oDataPaginate.js` — a `$top`/`$skip` pagination helper
    (analogous in spirit to the `graphPaginate()` helper proposed for the Graph-backed connectors,
    but a genuinely different implementation since this API doesn't return `@odata.nextLink`).
  - `api/src/connectors/microsoft_defender/tests/devices.js`, `tests/vulnerabilities.js`,
    `tests/recommendations.js`, `tests/alerts.js` — one file per check group.
- **Files to edit**: `init.sql` (append the seed blocks above), `api/src/connectors/registry.js`.
- **Sharing the credential-resolution helper with the rest of the group**: this connector reuses
  the *token-acquisition mechanics* of `resolveMicrosoftGraphCredentials()` (the client-credentials
  POST, the per-resource cache-with-expiry-skew pattern from `purview/credentials.js`) but supplies
  a different `resource` than every sibling connector. Concretely:
  `resolveMicrosoftGraphCredentials({ config, secret, resource: "https://api.securitycenter.microsoft.com" })`
  should return a credentials object whose base URL field points at
  `https://api.security.microsoft.com` (the request URL) while the token it mints internally is
  scoped to the `api.securitycenter.microsoft.com` resource (the token audience) — the helper's
  `resource` parameter should map to the token audience, not to a base-URL prefix, precisely
  because those two strings differ for this connector and need to be independently configurable.
  If the helper as designed in `entra_id.md` hard-codes an assumption that `resource` doubles as
  the base URL, that assumption needs to be relaxed before this connector can reuse it cleanly —
  flagged here so it's caught in code review of whichever connector lands first, not rediscovered
  as a bug when this connector is implemented second or third.
- **Verify before implementing**: the `Alert.Read.All` vs. `Alert.ReadWrite.All` permission
  discrepancy noted in Authentication step 2 — confirm which one `GET /api/alerts` actually
  accepts in a live tenant before finalizing the documented least-privilege permission list.
