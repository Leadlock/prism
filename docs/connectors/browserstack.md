# BrowserStack Connector

## 1. Overview

- **Proposed `integrations.category`**: `devops`
- **Proposed `integrations.key`**: `browserstack`
- **Proposed `integrations.auth_type`**: `api_key`

BrowserStack is a cloud cross-browser/device testing platform (Automate, App Automate, Live, App Live, Percy). Its public API surface is split across two genuinely different products, and the split matters for what Prism can actually verify:

1. **The Automate/App Automate testing APIs** (`plan.json`, `recycle_key.json`, session/build endpoints) — available to **every** paid plan, authenticated with the same username + Access Key pair every account already has.
2. **The User Management REST API** (Users, Teams, Service Accounts, Usage Reports, Audit Logs) — a genuinely documented, comprehensive admin API living under `browserstack.com/docs/enterprise/api-reference/...`. It is **not a separate product** from the user's own account credentials (same Basic Auth), but it is gated to **Enterprise plans only, and must be explicitly enabled by BrowserStack Support before it starts responding** — it is not self-service the way generating an Automate Access Key is.

**Scope for v1** (per the user's prioritization sheet: users, teams, projects, permissions, API access):
- Org-wide Owner/Admin role concentration (Enterprise User Management API).
- Service account scope (org-wide vs. team-scoped) review (Enterprise User Management API).
- Audit-log activity as evidence the org's admin actions are actually being captured (Enterprise User Management API).
- Access key rotation cadence (config-attested — see gap below).
- API connectivity/plan-usage as a freshness signal (Automate Plan API — available on every plan).

**Honest gap — read before using the checks below.** Two distinct limitations, not one:
- **Plan-gating, not a documentation gap.** Unlike Postman's key-inventory gap or Razorpay's team/webhook gap (where the underlying data simply isn't exposed by any API), BrowserStack's Users/Teams/Service-Accounts/Audit-Logs endpoints genuinely exist and return real data — `GET /user/user_detail`, `GET /user/service-accounts`, `GET /audit/v1/logs`, etc. are documented, working REST endpoints. The catch is that they 403/404 for any account that isn't (a) on an Enterprise plan and (b) has had the User Management API explicitly turned on for its org by BrowserStack Support. Most Prism customers on Automate/App Automate's lower tiers will simply not have this switched on, so the checks built against it must default to `not_applicable` rather than `fail` — the same pattern `postman.md` uses for its SCIM and Partner-Workspace checks (Enterprise-only features that are a config choice, not a failure, when absent).
- **No key-age/last-used timestamp anywhere.** Neither the Automate Access Key nor a Service Account's `authkey` expose a creation or last-rotated date via any documented endpoint (the Service Accounts API's own docs explicitly omit creation/last-used/expiry fields from every one of its four operations). This mirrors Razorpay's key-rotation gap exactly — the rotation-age check below is **config-attested**, comparing a customer-supplied date against policy, not a live API read.

## 2. Authentication

**`auth_type`: `api_key`**

BrowserStack authenticates with HTTP Basic Auth using a per-account **username** (not the login email) and **Access Key** — the same pair is valid across the Automate/App Automate APIs and the Enterprise User Management API; there is no separate OAuth handshake or token exchange.

### Setup steps (BrowserStack dashboard)

1. Log in to BrowserStack as a user with **Owner** or **Admin** organization role (required to see org-wide data on the User Management API, and to view the account-level Access Key rather than a per-user one).
2. Go to **Account > Settings** (`browserstack.com/accounts/settings`).
3. Under the **Access Key** section, copy the **Username** and **Access Key** values shown there.
4. **(Enterprise plans only)** If the org is on an Enterprise plan and wants the Users/Teams/Service-Accounts/Audit-Logs checks to actually run (rather than report `not_applicable`), contact BrowserStack Support and ask them to enable the **User Management REST API** for the organization — this is a support-provisioned switch, not a self-service toggle in the dashboard. Once confirmed enabled, set `config.enterpriseApiEnabled: true`.
5. Note the date the Access Key was last generated/reset under Account > Settings (BrowserStack does not expose this as an API-readable timestamp anywhere), and store it as `config.accessKeyGeneratedAt` so the rotation-policy check has something to compare against.
6. Optionally set `config.privilegedRoleThreshold` (default `5`) to define how many concurrent Owner/Admin-role users is considered excessive for this org.

### `config` shape (non-secret, stored on `integration_connections.config`)

```json
{
  "username": "jane_doe123",
  "enterpriseApiEnabled": false,
  "accessKeyGeneratedAt": "2026-05-01",
  "privilegedRoleThreshold": 5
}
```

### `secret` shape (encrypted, stored via `integration_credentials`)

```json
{
  "accessKey": "aBcDeFgHiJkLmNoPqRsTuVwXy"
}
```

The connector sends `Authorization: Basic base64(config.username:secret.accessKey)` on every request. `config.enterpriseApiEnabled` gates whether the connector even attempts the Users/Teams/Service-Accounts/Audit-Logs calls — if `false`, those checks short-circuit to `not_applicable` without making a request that would just 403.

## 3. API Reference

- **Base URLs**:
  - `https://api.browserstack.com` — Automate Plan API, Access Key reset, and (per BrowserStack's own docs) the primary base most Users/Teams endpoints are documented against.
  - `https://api-enterprise.browserstack.com` — an alternate base some Enterprise User Management API pages reference for the same endpoints; the connector should try the primary base first and fall back to this one if BrowserStack support confirms the org was provisioned against it.
  - `https://api-cloud.browserstack.com` — used by the App Automate variants (`/app-automate/plan.json`, `/app-automate/current_parallel_queue_usage`).
- **Auth**: HTTP Basic Auth, `username:accessKey`, on every request — identical across all three bases.
- **Rate limits**: the Enterprise User Management API publishes an explicit limit — **5 requests in an initial burst, then 15 requests/minute**, returning `429 Too Many Requests` past that. The Automate/App Automate APIs (`plan.json`, `recycle_key.json`) don't publish a fixed number; the connector should still back off on `429`.
- **Pagination**: none of the endpoints below use cursor/offset pagination — `GET /user/user_detail` and `GET /user/service-accounts` return the full org/team list in one response; the Usage Reports and Audit Logs APIs use date-range filters (`oldest_date`/`latest_date`, or default "last two weeks") rather than paging through pages.
- **Endpoints needed**:
  - `GET /automate/plan.json` — **available on every plan**. Returns `automate_plan`, `parallel_sessions_running`, `parallel_sessions_max_allowed`, `team_parallel_sessions_max_allowed`, `queued_sessions`, `queued_sessions_max_allowed`. Used as the cheap connectivity/credential-validity probe and the plan-usage freshness check.
  - `PUT /automate/recycle_key.json` — **available on every plan**. Resets/rotates the Access Key. Not called by any automated check (it's a mutating, credential-invalidating action) — referenced only in remediation guidance for the rotation-policy check.
  - `GET /user/user_detail` (optionally `?role=admin` / `?role=owner` / `?status=pending` / `?status=disabled`) — **Enterprise User Management API, requires `enterpriseApiEnabled`**. Returns each user's `id`, `username`, `full_name`, `email`, `role` (`owner`/`admin`/`user`), `teams`, and `product_access`. Used for the privileged-role-count check.
  - `GET /user/service-accounts` — **Enterprise User Management API**. Returns each service account's `identifier`, `username`, `teamName`, and `mainGroup` (boolean — `true` means the account is scoped organization-wide rather than to one team). Used for the service-account-scope check.
  - `GET /audit/v1/logs?oldest_date=YYYY-MM-DD&latest_date=YYYY-MM-DD` — **Enterprise User Management API**. Returns audit events (`event_id`, `date`, `actor`, `activity.category`, `activity.activity_name`, `location`). Used to confirm admin/user-management activity is actually being captured.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `browserstack.org.privileged_role_count_minimized` | Owner/Admin organization role is limited to necessary personnel | high | A.9.2.3 | **API-verified, Enterprise-only.** Checks `GET /user/user_detail?role=admin` (plus the single `owner`) does not exceed `config.privilegedRoleThreshold` (default 5) users holding org-wide Owner/Admin role — these roles can invite/remove members, change roles, and modify every team's product access. Returns `not_applicable` if `config.enterpriseApiEnabled` is `false`. | Review the user list under Account > User Management and demote accounts that don't need org-wide administrative rights down to the `user` role via `PUT /user/update_user_role`. |
| `browserstack.team.service_account_scope_reviewed` | Organization-scoped service accounts are periodically reviewed | medium | A.9.2.3 | **API-verified, Enterprise-only.** Checks `GET /user/service-accounts` for any account with `mainGroup: true` (org-wide scope rather than a single team) and flags each for review — a leaked or over-scoped org-wide service account's `authkey` grants CI/automation access across every team. Returns `not_applicable` if `config.enterpriseApiEnabled` is `false`. | Confirm each org-scoped service account still needs organization-wide access; where a specific team's access would suffice, delete and recreate it scoped to that team via the Service Accounts API/console. |
| `browserstack.org.audit_logging_active` | Organization admin activity is captured in Audit Logs | medium | A.12.4.1 | **API-verified, Enterprise-only.** Checks `GET /audit/v1/logs` (30-day lookback window by default) returns at least one event, evidencing that user-management/settings activity is actually being logged rather than the Audit Logs feature being unconfigured or unused. Returns `not_applicable` if `config.enterpriseApiEnabled` is `false`. | If no events are returned, confirm the Enterprise plan's Audit Logs feature is active for the org; review `GET /audit/v1/logs` periodically (or export to a SIEM) for unexpected role changes or service-account creation events. |
| `browserstack.automate.access_key_rotation_within_policy` | Account Access Key has been rotated within the policy window | medium | A.9.2.4 | **Config-attested — available regardless of plan.** BrowserStack exposes no API or dashboard timestamp for when the Access Key was last generated/reset, so this check compares the customer-supplied `config.accessKeyGeneratedAt` against the company's rotation policy (default 180 days); accuracy depends entirely on the self-reported date. | Reset the Access Key via `PUT /automate/recycle_key.json` (or Account > Settings), update every CI system/service account using the old key, then update `accessKeyGeneratedAt` in the Prism connection. |
| `browserstack.automate.plan_connectivity_verified` | BrowserStack credentials are valid and plan/session data is retrievable | low | A.12.1.1 | **API-verified — available regardless of plan.** Calls `GET /automate/plan.json` to confirm the configured username/Access Key pair is valid and actively returning plan and parallel-session data; used as a connectivity/evidence-freshness signal for the rest of this connector rather than a specific control. | If this fails, verify the Access Key hasn't been reset (`recycle_key.json` invalidates the previous key immediately) since Prism was connected, and reconnect with the current key. |

## 5. Seed SQL

```sql
-- ===== BrowserStack connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('browserstack', 'BrowserStack', 'devops', 'api_key', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('browserstack', 'browserstack.org.privileged_role_count_minimized', 'Owner/Admin organization role is limited to necessary personnel', 'Checks the number of users holding org-wide Owner or Admin role does not exceed a defined threshold, flagging excessive standing privileged access. Requires the Enterprise User Management API to be enabled; otherwise not_applicable.', 'high', 'Review the user list under Account > User Management and demote accounts that don''t need org-wide administrative rights down to the user role.'),
  ('browserstack', 'browserstack.team.service_account_scope_reviewed', 'Organization-scoped service accounts are periodically reviewed', 'Checks service accounts for organization-wide scope (mainGroup) rather than team scope and flags each for review, since a leaked org-wide service account key grants CI/automation access across every team. Requires the Enterprise User Management API; otherwise not_applicable.', 'medium', 'Confirm each org-scoped service account still needs organization-wide access; recreate it scoped to a specific team where sufficient.'),
  ('browserstack', 'browserstack.org.audit_logging_active', 'Organization admin activity is captured in Audit Logs', 'Checks the Audit Logs API returns at least one event within the lookback window, evidencing user-management/settings activity is being logged. Requires the Enterprise User Management API; otherwise not_applicable.', 'medium', 'Confirm the Enterprise plan''s Audit Logs feature is active for the org; review audit logs periodically for unexpected role changes or service-account creation events.'),
  ('browserstack', 'browserstack.automate.access_key_rotation_within_policy', 'Account Access Key has been rotated within the policy window', 'Compares the customer-supplied Access Key generation date against the company''s rotation policy (default 180 days); BrowserStack exposes no API or dashboard timestamp for this, so accuracy depends on the self-reported date.', 'medium', 'Reset the Access Key via the recycle_key API or Account > Settings, update every CI system/service account using the old key, then update the recorded generation date in the Prism connection.'),
  ('browserstack', 'browserstack.automate.plan_connectivity_verified', 'BrowserStack credentials are valid and plan/session data is retrievable', 'Calls the Automate Plan API to confirm the configured credentials are valid and actively returning plan and parallel-session data, as a connectivity/freshness signal.', 'low', 'If this fails, verify the Access Key hasn''t been reset since Prism was connected, and reconnect with the current key.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('browserstack.org.privileged_role_count_minimized', 'A.9.2.3'),
  ('browserstack.team.service_account_scope_reviewed', 'A.9.2.3'),
  ('browserstack.org.audit_logging_active', 'A.12.4.1'),
  ('browserstack.automate.access_key_rotation_within_policy', 'A.9.2.4'),
  ('browserstack.automate.plan_connectivity_verified', 'A.12.1.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `browserstack` (added to `registry.js`).
- **Suggested files**:
  - `api/src/connectors/browserstack/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/aws/index.js`'s structure: build one small `fetch`-based client carrying `username`, `accessKey`, and `enterpriseApiEnabled`, run each test's `run(clients)`.
  - `api/src/connectors/browserstack/credentials.js` — trivial for `api_key`: validates `config.username` and `secret.accessKey` are present and returns the pre-formed Basic Auth header (`Buffer.from(\`${config.username}:${secret.accessKey}\`).toString("base64")`); no token exchange needed.
  - `api/src/connectors/browserstack/client.js` — wraps `fetch` for `GET /automate/plan.json` (`api.browserstack.com`), `GET /user/user_detail`, `GET /user/service-accounts`, `GET /audit/v1/logs` (Enterprise base, with fallback to `api-enterprise.browserstack.com` per API Reference above); centralizes the Basic Auth header and 429 backoff (5-burst/15-per-minute limit on the Enterprise endpoints).
  - `api/src/connectors/browserstack/tests/org.js` — `checkPrivilegedRoleCountMinimized`, `checkAuditLoggingActive`.
  - `api/src/connectors/browserstack/tests/team.js` — `checkServiceAccountScopeReviewed`.
  - `api/src/connectors/browserstack/tests/automate.js` — `checkAccessKeyRotationWithinPolicy`, `checkPlanConnectivityVerified`.
- **Registry wiring**: add `import * as browserstack from "./browserstack/index.js";` and `[browserstack.key]: browserstack` to `api/src/connectors/registry.js`.
- **`testConnection()`**: use `GET /automate/plan.json` (works on every plan, unlike the Enterprise endpoints) — return `{ ok: true, externalAccountId: config.username }`.
- **Not-applicable handling**: `browserstack.org.privileged_role_count_minimized`, `browserstack.team.service_account_scope_reviewed`, and `browserstack.org.audit_logging_active` must all check `config.enterpriseApiEnabled` before making any request and return `not_applicable` immediately if it's `false` — attempting the call anyway would just surface a 403/404 as a false "fail", the same precedent as `postman.md`'s SCIM/Partner-Workspace `not_applicable` handling for plan-gated features.
- **Threshold config**: `browserstack.org.privileged_role_count_minimized`'s threshold (proposed default: 5) should live as a named constant in `org.js`, overridable via `config.privilegedRoleThreshold`, matching the inline-constant convention used for `github.org.owners_count_minimized` and `postman.team.privileged_role_count_minimized`.
- **Config-attested vs. API-verified must be visually distinguished in the UI** — `browserstack.automate.access_key_rotation_within_policy` is the one check here that can only compare a self-reported date, not a live value (mirroring `razorpay.keys.rotation_age_within_policy`); it should carry the same `config-attested` badge treatment in findings evidence so auditors don't mistake it for a verified control.
- **Known limitation to carry into onboarding UI**: unlike Postman (whose gap is a genuine missing endpoint) or Razorpay (whose gap is "Partner-account-only"), BrowserStack's gap here is **plan-tier + support-provisioning**. The connector setup flow should surface a clear message when `enterpriseApiEnabled` is left `false` — e.g., "Your organization's users, teams, and service accounts cannot be audited via API unless your BrowserStack plan is Enterprise and BrowserStack Support has enabled the User Management API for your org. Contact BrowserStack Support to enable it, then update this connection." — rather than silently showing three `not_applicable` findings with no explanation.
