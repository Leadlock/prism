# Freshworks Connector

## 1. Overview

- **Proposed `integrations.category`**: `business_apps`
- **Proposed `integrations.key`**: `freshworks` (see the split recommendation at the end of this section and in section 6 — **recommendation: split into `freshdesk` and `freshservice` connector keys**, not one combined `freshworks` key)

"Freshworks" is the parent brand; there is no single "Freshworks org-level" API. Freshdesk (customer support/helpdesk) and Freshservice (IT service management/ITSM) are **separate products with separate REST APIs, separate per-domain base URLs, and separate per-agent API keys** — an agent logging into one product does not automatically have visibility into the other, and a Freshworks account admin manages each product's agents/roles/groups from that product's own Admin settings, not a unified Freshworks console. There is a Freshworks-wide "Neo" account/billing layer, but it does not expose a public REST API for agent/role/group/security administration — that administration is entirely per-product.

**Scope decision — read before implementing**: because Freshdesk and Freshservice are functionally independent APIs with independent auth (an agent can hold a Freshdesk API key, a Freshservice API key, both, or neither, and they are not interchangeable), this document specs them as **two connectors that share one write-up** rather than pretending a single `freshworks` integration can authenticate once and reach both products. Section 6 recommends registering them as `freshdesk` and `freshservice` in `registry.js` and in the `integrations` table, each as its own row, rather than a single `freshworks` row — see the rationale there.

Scope for v1 covers, per product:
- **Freshdesk**: Agents (list/roles/status), Roles (read-only catalog), Groups (agent groups + members), Companies, Account (plan/domain metadata).
- **Freshservice**: Agents (list/roles/status), Roles (read-only catalog), Groups (agent groups + members, workspace-aware), Requesters, Account, and Audit Logs (Enterprise-tier only — see the check table below for how the connector handles lower tiers).

Both products cover authentication/session config (2FA, SSO) only partially via API — see the Authentication section and the check-level caveats below.

## 2. Authentication

**`auth_type`: `api_key`** (identical shape for both products; treat as two independent connections)

Both Freshdesk and Freshservice authenticate identically: **HTTP Basic Auth with the agent's API key as the username and any non-empty string as the password** (Freshservice explicitly deprecated username/password Basic Auth as of May 31, 2023 — API-key auth is now the only supported method for both products). There is no OAuth2 client-credentials flow for routine Admin API access in either product's general API.

Critically, **the API key inherits the generating agent's own role and permissions** — every API call is scoped exactly as if that agent were clicking through the UI. For Prism's evidence collection to see the full Agents/Roles/Groups/Account picture, the API key must belong to a **full Administrator** agent in that product, not a restricted agent.

### Setup steps — Freshdesk

1. Log in to the Freshdesk account at `https://<yourdomain>.freshdesk.com` as an Administrator.
2. Confirm API key access is enabled account-wide: **Admin > Account > API Settings** (a Freshdesk admin toggle; if disabled, no agent can retrieve their key even from their own profile).
3. Click the profile picture (top right) > **Profile Settings** (or **View API Key**), then complete the CAPTCHA challenge to reveal the key.
4. Use a dedicated Administrator-role agent (a service account, not a named individual's personal login) so the key survives staff turnover.
5. Record the account's Freshdesk domain, e.g. `yourcompany.freshdesk.com`.

### Setup steps — Freshservice

1. Log in to the Freshservice account at `https://<yourdomain>.freshservice.com` as an Administrator.
2. Go to **Admin > Account Settings** and confirm API access is enabled for the account (also a global toggle, separate from Freshdesk's — the two products' "enable API key access" settings are unrelated even though both are Freshworks products).
3. Click the profile picture (top right) > **Profile Settings**, and copy the **API Key** field.
4. As with Freshdesk, use a dedicated Administrator-role agent/service account.
5. Record the account's Freshservice domain, e.g. `yourcompany.freshservice.com`.

### `config` shape — Freshdesk (non-secret, stored on `integration_connections.config`)

```json
{
  "domain": "yourcompany.freshdesk.com"
}
```

### `secret` shape — Freshdesk (encrypted, stored via `integration_credentials`)

```json
{
  "apiKey": "AbCdEfGhIjKlMnOpQrSt"
}
```

### `config` shape — Freshservice

```json
{
  "domain": "yourcompany.freshservice.com",
  "planTier": "enterprise"
}
```

`planTier` is self-reported by the customer during setup (Growth/Pro/Enterprise), since it gates whether the Audit Logs API is reachable at all (Enterprise-only) — see section 4.

### `secret` shape — Freshservice

```json
{
  "apiKey": "ZyXwVuTsRqPoNmLkJiHg"
}
```

Both connectors send `Authorization: Basic base64(apiKey:X)` on every request (`X` is a placeholder password value, per Freshworks' documented convention).

## 3. API Reference

### Freshdesk

- **Base URL**: `https://<domain>/api/v2/` (e.g. `https://yourcompany.freshdesk.com/api/v2/agents`). HTTPS only.
- **Key endpoints**: `GET /agents` (list, includes `role_ids`/status), `GET /roles` (read-only catalog of roles and their permission descriptions), `GET /groups` (agent groups + `agent_ids`), `GET /companies`, `GET /account` (returns the account id, name, and Freshdesk plan/domain).
- **Pagination**: `page`/`per_page` query params, default page size 30, max 100 per page; no cursor — the connector increments `page` until a short page is returned.
- **Rate limits**: plan-tier-based, per hour, not per minute — roughly 3,000 calls/hour on Blossom/Garden tiers up to 5,000+/hour on Estate/Forest; exceeding it returns `HTTP 429` with `X-RateLimit-Total`/`X-RateLimit-Remaining`/`Retry-After` response headers.
- **Not exposed via API**: account-level 2FA enforcement status and SSO configuration have no documented read endpoint in the public Freshdesk Admin API — these remain Dashboard-only (**Admin > Account > Security**), so the corresponding checks below are config-attested/manual, matching Razorpay's Dashboard-only gaps in the sibling connector doc.

### Freshservice

- **Base URL**: `https://<domain>/api/v2/` (e.g. `https://yourcompany.freshservice.com/api/v2/agents`). HTTPS only; custom CNAMEs are not supported for API access even if configured for the portal UI.
- **Key endpoints**: `GET /agents` (list, includes `roles` array with `role_id`/`assignment_scope`), `GET /roles` (read-only), `GET /groups` (agent groups, workspace-aware in multi-workspace accounts), `GET /requesters`, `GET /account` (plan tier, domain, subscription details), `GET /audit-logs` (Enterprise plan only).
- **Pagination**: `page`/`per_page`, default 30, max 100 per page; `link` response header carries a `rel="next"` URL when more pages remain.
- **Rate limits**: per-minute, plan-tier-based — approximately 100/min (Starter) up to 500/min (Enterprise), with lower per-resource sub-limits for ticket/asset/user operations specifically; `HTTP 429` responses include a `Retry-After` header (seconds).
- **Audit Logs gate**: the Audit Logs API is **only reachable on the Enterprise plan** — calling it on Starter/Growth/Pro returns an error (documented error code pattern includes `require_feature`), not an empty list. The connector must treat that response as `not_applicable` (feature not licensed) rather than `fail` (control absent), the same "don't conflate absence-of-visibility with absence-of-control" pattern used in `api/src/connectors/github/tests/access.js`'s `checkTwoFactorRequired`.
- **Not exposed via API**: like Freshdesk, per-account SSO enforcement and 2FA-required policy have no documented dedicated read endpoint; some of this may be inferable indirectly (e.g., an agent record rejecting an email change "because SSO is enabled" is a documented side effect, not a queryable flag) but is not a reliable API-first signal, so it is treated as config-attested/manual below.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `freshdesk.agents.no_orphaned_admin_roles` | No agent retains an Administrator role without a documented business justification | high | A.9.2.3 | **API-verified.** Calls `GET /agents` + `GET /roles` and flags active agents whose `role_ids` include the Administrator role beyond a configured expected-admin count/allowlist. | Review Admin > Team > Agents, remove the Administrator role from agents who don't need full account access, and use scoped custom roles instead. |
| `freshdesk.agents.deactivated_on_offboarding` | No agent accounts remain active past their offboarding date | high | A.9.2.1 | **API-verified**, evidence-only (date comparison requires an external HR feed Prism does not have — flags for manual review rather than auto-failing). Calls `GET /agents` and lists all active agents with last-login/created metadata for the auditor to cross-reference against HR offboarding records. | Deactivate the agent under Admin > Team > Agents as part of the offboarding checklist; do not delete the record (breaks ticket history/attribution). |
| `freshdesk.groups.membership_reviewed` | Agent groups (ticket routing/escalation) have a reviewed, non-empty membership list | medium | A.9.2.5 | **API-verified.** Calls `GET /groups` and flags groups with zero members (orphaned routing rule) or with membership not reviewed within the policy window (requires a `lastReviewedAt` self-reported timestamp per group, config-attested). | Assign or remove agents from each group under Admin > Workflows > Groups so ticket routing reflects current staffing, and record the review date. |
| `freshdesk.account.two_factor_enforced_attestation` | Two-factor authentication is enforced for all agents | critical | A.9.4.2 | **Config-attested — no read API exists.** Freshdesk's Admin API has no documented endpoint returning account-wide 2FA enforcement status; this appears as `not_applicable` until the customer supplies a dated screenshot of Admin > Account > Security showing "Force agents to setup Two Factor Authentication" enabled. | Enable "Force agents to setup Two Factor Authentication" under Admin > Account > Security, then upload a dated screenshot as manual evidence in Prism. |
| `freshdesk.account.sso_enforced_attestation` | Single sign-on is configured and enforced for agent login | high | A.9.4.2 | **Config-attested — no read API exists.** Same limitation as the 2FA check above; SSO configuration/enforcement is Dashboard-only (Admin > Account > Security > Single Sign-On). | Configure and enforce SAML/SSO under Admin > Account > Security, then upload dated evidence in Prism. |
| `freshservice.agents.no_orphaned_admin_roles` | No agent retains an Administrator-scope role without documented justification | high | A.9.2.3 | **API-verified.** Calls `GET /agents` + `GET /roles`, flags active agents whose `roles[].role_id` maps to an Administrator-scope role beyond the expected-admin allowlist. | Review Admin > User Management > Agents, scope down roles to least-privilege ITSM roles (e.g. "Change Manager", "Asset Manager") instead of full Administrator where possible. |
| `freshservice.groups.workspace_membership_reviewed` | Agent groups (incident/change routing) have reviewed, non-empty membership across workspaces | medium | A.9.2.5 | **API-verified.** Calls `GET /groups` (paginated per workspace on multi-workspace accounts) and flags empty or stale-reviewed groups, same pattern as the Freshdesk groups check. | Assign or remove agents from each group under Admin > Workflows > Groups per workspace, and record the review date. |
| `freshservice.audit.logs_available` | Audit log history is available and actively recording | high | A.12.4.1 | **API-verified, tier-gated.** Calls `GET /audit-logs`; if the plan is below Enterprise, the endpoint itself is unreachable — the check returns `not_applicable` with a message noting the plan tier lacks this feature (not a control failure) rather than `fail`, mirroring how `purview.audit.unified_logging_enabled`'s sibling check in `purview` is written and how GitHub's 2FA check treats an unreadable field. | If on Enterprise, confirm audit log entries are recent (no gap); if below Enterprise, either upgrade the plan or document audit logging via an alternate control (e.g., exported change tickets) as compensating evidence. |
| `freshservice.account.two_factor_enforced_attestation` | Two-factor authentication is enforced for all agents | critical | A.9.4.2 | **Config-attested — no read API exists.** Same limitation as Freshdesk's equivalent check; Freshservice's 2FA enforcement toggle lives under Admin > Account Settings > Security and has no documented read endpoint. | Enable mandatory 2FA under Admin > Account Settings > Security, then upload dated evidence in Prism. |
| `freshservice.account.sso_enforced_attestation` | Single sign-on is configured and enforced for agent login | high | A.9.4.2 | **Config-attested — no read API exists.** Same limitation as Freshdesk's SSO check. | Configure and enforce SSO under Admin > Account Settings > Security > Single Sign-On, then upload dated evidence in Prism. |

(10 checks total, 5 per product, within the "8-10 Freshworks checks" target from the prioritization sheet.)

## 5. Seed SQL

```sql
-- ===== Freshworks connectors (Freshdesk + Freshservice): catalog seed data =====
-- Registered as two separate integrations rather than one combined "freshworks"
-- row — see docs/connectors/freshworks.md section 6 for the rationale.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('freshdesk', 'Freshdesk', 'business_apps', 'api_key', 'active'),
  ('freshservice', 'Freshservice', 'business_apps', 'api_key', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('freshdesk', 'freshdesk.agents.no_orphaned_admin_roles', 'No agent retains an Administrator role without a documented business justification', 'Checks active agents whose roles include Administrator beyond a configured expected-admin count/allowlist.', 'high', 'Review Admin > Team > Agents, remove the Administrator role from agents who don''t need full account access, and use scoped custom roles instead.'),
  ('freshdesk', 'freshdesk.agents.deactivated_on_offboarding', 'No agent accounts remain active past their offboarding date', 'Lists active agents with last-login/created metadata for cross-reference against HR offboarding records; requires manual review since Prism has no HR feed.', 'high', 'Deactivate the agent under Admin > Team > Agents as part of the offboarding checklist; do not delete the record.'),
  ('freshdesk', 'freshdesk.groups.membership_reviewed', 'Agent groups (ticket routing/escalation) have a reviewed, non-empty membership list', 'Flags groups with zero members or membership not reviewed within the policy window.', 'medium', 'Assign or remove agents from each group under Admin > Workflows > Groups so ticket routing reflects current staffing, and record the review date.'),
  ('freshdesk', 'freshdesk.account.two_factor_enforced_attestation', 'Two-factor authentication is enforced for all agents', 'No Freshdesk Admin API endpoint returns account-wide 2FA enforcement status; requires manual dated evidence.', 'critical', 'Enable "Force agents to setup Two Factor Authentication" under Admin > Account > Security, then upload a dated screenshot as manual evidence in Prism.'),
  ('freshdesk', 'freshdesk.account.sso_enforced_attestation', 'Single sign-on is configured and enforced for agent login', 'SSO configuration/enforcement is Dashboard-only with no read API; requires manual dated evidence.', 'high', 'Configure and enforce SAML/SSO under Admin > Account > Security, then upload dated evidence in Prism.'),
  ('freshservice', 'freshservice.agents.no_orphaned_admin_roles', 'No agent retains an Administrator-scope role without documented justification', 'Checks active agents whose role_id maps to an Administrator-scope role beyond the expected-admin allowlist.', 'high', 'Review Admin > User Management > Agents, scope down roles to least-privilege ITSM roles instead of full Administrator where possible.'),
  ('freshservice', 'freshservice.groups.workspace_membership_reviewed', 'Agent groups (incident/change routing) have reviewed, non-empty membership across workspaces', 'Flags empty or stale-reviewed groups per workspace.', 'medium', 'Assign or remove agents from each group under Admin > Workflows > Groups per workspace, and record the review date.'),
  ('freshservice', 'freshservice.audit.logs_available', 'Audit log history is available and actively recording', 'Calls the Audit Logs API; returns not_applicable on sub-Enterprise plans where the feature is unlicensed rather than failing the control.', 'high', 'If on Enterprise, confirm audit log entries are recent; if below Enterprise, upgrade the plan or document an alternate compensating control.'),
  ('freshservice', 'freshservice.account.two_factor_enforced_attestation', 'Two-factor authentication is enforced for all agents', 'No Freshservice API endpoint returns account-wide 2FA enforcement status; requires manual dated evidence.', 'critical', 'Enable mandatory 2FA under Admin > Account Settings > Security, then upload dated evidence in Prism.'),
  ('freshservice', 'freshservice.account.sso_enforced_attestation', 'Single sign-on is configured and enforced for agent login', 'SSO configuration/enforcement has no read API; requires manual dated evidence.', 'high', 'Configure and enforce SSO under Admin > Account Settings > Security > Single Sign-On, then upload dated evidence in Prism.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('freshdesk.agents.no_orphaned_admin_roles', 'A.9.2.3'),
  ('freshdesk.agents.deactivated_on_offboarding', 'A.9.2.1'),
  ('freshdesk.groups.membership_reviewed', 'A.9.2.5'),
  ('freshdesk.account.two_factor_enforced_attestation', 'A.9.4.2'),
  ('freshdesk.account.sso_enforced_attestation', 'A.9.4.2'),
  ('freshservice.agents.no_orphaned_admin_roles', 'A.9.2.3'),
  ('freshservice.groups.workspace_membership_reviewed', 'A.9.2.5'),
  ('freshservice.audit.logs_available', 'A.12.4.1'),
  ('freshservice.account.two_factor_enforced_attestation', 'A.9.4.2'),
  ('freshservice.account.sso_enforced_attestation', 'A.9.4.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Recommendation: split into `freshdesk` and `freshservice` connector keys, not one `freshworks` key.** Reasons:
  1. Authentication is per-product and non-transitive — a Freshdesk API key does not work against `*.freshservice.com` and vice versa. A single `freshworks` connection would need two separate credential slots anyway, which is exactly what two connector rows give you for free via the existing `integration_connections` (one row per connection) model.
  2. A customer may run only one of the two products (many run Freshdesk without Freshservice, or vice versa) — forcing both credentials into one `freshworks` connector would make the unused half either awkwardly optional or force a confusing "partial connection" status that doesn't fit the existing `integration_connections.status` enum (`pending`/`connected`/`error`/`revoked`) cleanly.
  3. `automated_tests.test_key` and ISO mappings are already per-check, not per-vendor-brand, so nothing is lost organizationally by having `freshdesk.*` and `freshservice.*` prefixes instead of `freshworks.freshdesk.*` — it's actually more consistent with the existing `github.*`/`purview.*`/`azure.*` naming (product name, not parent-company name).
  4. Matches how the two products already appear in `registry.js`'s pattern of one entry per distinct API surface (`aws`, `azure`, `github`, `purview` are each a distinct API, not grouped by parent vendor).
- **Connector `key`s**: `freshdesk` and `freshservice` (both registered in `registry.js`).
- **Suggested files**:
  - `api/src/connectors/freshdesk/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/github/index.js`'s structure (simple API-key auth, no token exchange, but do include a `describeFreshdeskError` helper analogous to `describeGithubError`/`describeAzureError` since Freshdesk's 429/403 responses carry useful `X-RateLimit-*`/`Retry-After` headers worth surfacing distinctly).
  - `api/src/connectors/freshdesk/credentials.js` — `resolveFreshdeskCredentials({ authType, config, secret })`: returns the Basic Auth header value from `secret.apiKey` plus the configured `domain`; no SDK dependency needed, a thin `fetch` wrapper suffices.
  - `api/src/connectors/freshdesk/client.js` — wraps `fetch` against `https://{domain}/api/v2/`, handling `page`/`per_page` pagination and 429 backoff via `Retry-After`.
  - `api/src/connectors/freshdesk/tests/agents.js`, `tests/groups.js`, `tests/account.js`.
  - `api/src/connectors/freshservice/index.js`, `credentials.js`, `client.js` — same shape, targeting `https://{domain}/api/v2/`, with the `link` response-header pagination style instead of Freshdesk's plain page-count style, and a `planTier` gate before attempting `GET /audit-logs`.
  - `api/src/connectors/freshservice/tests/agents.js`, `tests/groups.js`, `tests/audit.js`, `tests/account.js`.
- **Registry wiring**: add `import * as freshdesk from "./freshdesk/index.js";` and `import * as freshservice from "./freshservice/index.js";`, plus `[freshdesk.key]: freshdesk` and `[freshservice.key]: freshservice`, to `api/src/connectors/registry.js`.
- **`testConnection()`** for each should call `GET /account` — a cheap, low-permission-requirement endpoint in both products — analogous to AWS's `GetCallerIdentity`/GitHub's `orgs.get` pattern, returning `{ ok: true, externalAccountId: <account id from the response> }`.
- **Config-attested and tier-gated checks must be visually distinguished in the UI** from true API-verified checks (same UI caveat as the Razorpay connector doc) — the 2FA/SSO attestation checks in both products, and Freshservice's Enterprise-only Audit Logs check, should never render as an equivalent-confidence green checkmark next to a check that actually queried live data.
