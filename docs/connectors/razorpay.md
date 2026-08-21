# Razorpay Connector

## 1. Overview

- **Proposed `integrations.category`**: `payments`
- **Proposed `integrations.key`**: `razorpay`
- **Proposed `integrations.auth_type`**: `api_key`

Razorpay is an Indian payment gateway/aggregator. All of its core APIs (Orders, Payments, Refunds, Settlements, Payment Links, Subscriptions, etc.) are authenticated with a single Key Id/Key Secret pair, generated per merchant account, transmitted as HTTP Basic Auth over `https://api.razorpay.com/v1`.

**Documented scope gap — read this before using the checks below.** The user's prioritization sheet asks Prism to audit *Users, roles, API keys, webhooks, applications, account/security configuration* for Razorpay. Research against Razorpay's public API docs (`razorpay.com/docs/api/`) found:

| Area requested | API-accessible for a regular merchant? | Notes |
|---|---|---|
| Team members / user roles | **No.** Dashboard-only. | Managed at **Account & Settings > Business Settings > Manage Team** (invite, role, remove). There is no `/v1/team` or `/v1/users` endpoint in the public merchant API surface — only Razorpay staff-facing/internal tooling exposes this. |
| API key generation / rotation / listing | **No.** Dashboard-only. | Keys are generated and regenerated at **Account & Settings > API Keys**. There is no endpoint to list existing keys, read a key's creation/rotation timestamp, or rotate a key programmatically. The Key Secret is shown exactly once at generation time and cannot be retrieved again via API or UI. |
| Webhooks (create/list/update/delete) | **Partner accounts only**, not regular merchants. | Razorpay does publish a Webhooks API (`/v2/accounts/{account_id}/webhooks`), but it is scoped under **Partners** — it lets an OAuth Partner app manage webhooks *on behalf of a sub-merchant account it manages*, not a merchant managing its own webhooks. A regular (non-Partner) merchant's webhook configuration is Dashboard-only, at **Account & Settings > Webhooks**. |
| Applications (OAuth apps a merchant has authorized) | **No** documented self-service listing endpoint for a plain merchant account. | Only visible via Dashboard; OAuth/Partner app management is a separate, Partner-program-specific surface. |
| Live vs. test mode key usage | **Yes, but only as configuration inspection, not a live API pull.** | Razorpay Key Ids are self-describing: they are prefixed `rzp_live_...` or `rzp_test_...`. Prism can determine mode by string-inspecting the configured `keyId` — no API call is required or possible for this fact. |
| Webhook signature verification | **Not verifiable via API at all.** | Whether a merchant has HMAC signature verification implemented is a property of the merchant's own webhook receiver code, invisible to Razorpay's API and to Prism. The only API-adjacent fact Prism can check is whether a webhook secret has been entered into the Prism connection config (i.e., that the *evidence* needed to verify signatures has been captured), which is a self-attested/config-presence check, not a live pull. |

**Practical consequence**: because the requested audit surface (users/roles/keys/webhooks/apps) is almost entirely Dashboard-only, this connector's checks are split into two kinds, and each check in section 4 is labeled accordingly:
- **API-verified** — the check calls a live Razorpay endpoint (Orders/Payments) or inspects the configured credential string itself.
- **Config-attested** — the check can only compare Prism's own stored connection config against a policy (e.g., "is a webhook secret on file") because Razorpay exposes no endpoint to verify the underlying fact. These checks should be clearly labeled `config-attested` in findings evidence so auditors don't mistake them for a live control verification.

This gap should be flagged to the customer during connector setup (e.g., a banner: "Razorpay does not expose team/API key/webhook management via API — these controls must be evidenced manually or via screenshot upload until Razorpay adds an API for them").

## 2. Authentication

**`auth_type`: `api_key`**

### Setup steps (Razorpay Dashboard)

1. Log in to the [Razorpay Dashboard](https://dashboard.razorpay.com/).
2. Switch to **Live mode** in the top toggle if you want to audit production data (Test mode keys only return test-mode Orders/Payments — auditing test mode alone will produce a misleadingly empty or synthetic evidence set).
3. Click **Account & Settings** in the left menu.
4. Under **Website and app settings**, select **API Keys**.
5. Click **Generate Key** (or **Regenerate Live Key** if one already exists — note regenerating invalidates the old key immediately).
6. Copy the **Key Id** (format `rzp_live_XXXXXXXXXXXX` or `rzp_test_XXXXXXXXXXXX`) and the **Key Secret** shown in the confirmation dialog. The secret is shown once only — if lost, it must be regenerated (which invalidates the previous key pair for any other integration using it).
7. Store the Key Id in Prism's connection `config` and the Key Secret in `secret`.
8. Optional, for the config-attested webhook check: under **Account & Settings > Webhooks**, if a webhook is already configured, copy its **Webhook Secret** value and also store it in Prism's `secret` so Prism can at least confirm one is on file.
9. Optional, to make the API-key-rotation check meaningful: record the date the Live key pair was generated/regenerated (Razorpay does not expose this via API or in the Dashboard UI as a timestamp — the customer must self-report it, e.g. from their own change-management ticket) and store it as `config.keyGeneratedAt`.

### `config` shape (non-secret, stored on `integration_connections.config`)

```json
{
  "keyId": "rzp_live_AbCdEfGh12345",
  "keyGeneratedAt": "2026-05-01",
  "webhookSecretOnFile": true
}
```

### `secret` shape (encrypted, stored via `integration_credentials`)

```json
{
  "keySecret": "aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
  "webhookSecret": "whsec_1234567890abcdef"
}
```

The connector sends `Authorization: Basic base64(keyId:keySecret)` on every request to `https://api.razorpay.com/v1/*`.

## 3. API Reference

- **Base URL**: `https://api.razorpay.com/v1` for the core Payments API (Orders, Payments, Refunds, Settlements, Payment Links, Customers, Subscriptions, Invoices). A separate `https://api.razorpay.com/v2` base exists for select newer resources (e.g. Partner `/v2/accounts`), not needed for this connector's scope.
- **Authentication**: HTTP Basic Auth, `username = Key Id`, `password = Key Secret`, on every request. No OAuth token/refresh cycle for the core API.
- **Modes**: Test and Live are fully separate data planes selected purely by which Key Id/Secret pair is used — there is no `?mode=` parameter. A `rzp_test_*` key only ever sees test-mode Orders/Payments/Refunds; a `rzp_live_*` key only ever sees live data.
- **Pagination**: list endpoints (e.g. `GET /v1/payments`, `GET /v1/orders`) use `count` (max 100, default 10) and `skip` query parameters; responses include `"count"` (items in this page) inside the JSON body rather than a `Link`/cursor header — the connector must track `skip += count` itself and stop when a page returns fewer than the requested `count`.
- **Rate limits**: Razorpay does not publish a fixed public rate-limit number in its API docs; in practice it throttles per Key Id and returns `HTTP 429` with a JSON `error.description` on throttling — the connector should back off and retry rather than assume a fixed quota.
- **Webhook signature verification** (for the merchant's own receiver, not this connector's API calls): Razorpay signs each webhook POST body with `HMAC-SHA256`, keyed by the webhook secret, delivered in the `X-Razorpay-Signature` header. Verification is: `hmac_sha256(raw_request_body, webhook_secret) === X-Razorpay-Signature` (constant-time compare), computed over the **raw, unparsed** request body. Duplicate delivery is possible; Razorpay recommends de-duplicating via the `x-razorpay-event-id` header rather than assuming exactly-once delivery.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `razorpay.keys.live_mode_in_use` | Connected API key is a live-mode key, not a test-mode key | medium | A.14.2.9 | **API-verified** (string inspection, no network call). Checks the configured `keyId` is prefixed `rzp_live_` rather than `rzp_test_`, confirming Prism is auditing production payment activity rather than a test sandbox. | Generate a Live-mode key pair under Account & Settings > API Keys and reconnect Prism with the `rzp_live_` key instead of a test key. |
| `razorpay.keys.rotation_age_within_policy` | API key pair has been rotated within the policy window | medium | A.9.2.4 | **Config-attested.** Razorpay exposes no API or Dashboard timestamp for key creation/rotation, so this check compares the customer-supplied `config.keyGeneratedAt` against the company's rotation policy (default 180 days) — it can only be as accurate as what was self-reported. | Regenerate the Live API key pair under Account & Settings > API Keys, update every system using the old key, then update `keyGeneratedAt` in the Prism connection. |
| `razorpay.webhooks.secret_on_file` | A webhook signing secret has been captured for signature verification evidence | high | A.9.4.1 | **Config-attested.** Razorpay's Webhooks API is Partner-account-only, so Prism cannot query a regular merchant's webhook configuration directly. This check only confirms a `webhookSecret` has been stored in the Prism connection, as a proxy for "the merchant has a webhook configured and the secret needed to verify its signature is available for evidence." | Under Account & Settings > Webhooks, confirm a webhook is configured with HTTPS delivery, copy its secret, and add it to the Prism connection's stored secret. |
| `razorpay.webhooks.signature_verification_documented` | Webhook signature verification (HMAC-SHA256 over `X-Razorpay-Signature`) is documented as implemented on the receiving endpoint | high | A.14.1.3 | **Config-attested / manual.** Whether the merchant's own webhook receiver actually validates `X-Razorpay-Signature` is entirely outside Razorpay's API and Prism's network visibility — this must be evidenced by the customer (code reference, screenshot, or an internal attestation flag) rather than a live pull. Marked `not_applicable` by default until the customer supplies evidence via manual upload. | Implement HMAC-SHA256 verification of `X-Razorpay-Signature` on the raw request body before processing any webhook event, then attach the code reference or a signed attestation as manual evidence in Prism. |
| `razorpay.payments.captured_reconciled` | Captured payments are being retrieved and reconciled (API connectivity/evidence-freshness check) | low | A.12.1.1 | **API-verified.** Calls `GET /v1/payments?count=1` with the connected key to confirm the credential is valid, live, and returning recent transaction data — used as a connectivity/freshness signal for the rest of the payment evidence trail rather than a specific control. | If this fails, verify the Key Id/Secret pair hasn't been regenerated or revoked in the Dashboard since Prism was connected. |
| `razorpay.account.team_access_reviewed_attestation` | Team member access (Dashboard "Manage Team") has been reviewed within the policy window | high | A.9.2.5 | **Config-attested / manual — no API exists.** Razorpay has no API for team/role listing; this check cannot run automatically. It exists as a placeholder so the control appears in Prism's findings list as `not_applicable` (with an explanatory message) until manual evidence (e.g. a dated screenshot of Manage Team) is uploaded. | Review Account & Settings > Business Settings > Manage Team at least quarterly, remove access for anyone who no longer needs it, and upload a dated screenshot as manual evidence in Prism. |

## 5. Seed SQL

```sql
-- ===== Razorpay connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('razorpay', 'Razorpay', 'payments', 'api_key', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('razorpay', 'razorpay.keys.live_mode_in_use', 'Connected API key is a live-mode key, not a test-mode key', 'Checks the configured Key Id is prefixed rzp_live_ rather than rzp_test_, confirming Prism is auditing production payment activity rather than a test sandbox.', 'medium', 'Generate a Live-mode key pair under Account & Settings > API Keys and reconnect Prism with the rzp_live_ key instead of a test key.'),
  ('razorpay', 'razorpay.keys.rotation_age_within_policy', 'API key pair has been rotated within the policy window', 'Compares the customer-supplied key-generated date against the company''s rotation policy (default 180 days); Razorpay exposes no API or Dashboard timestamp for this, so accuracy depends on the self-reported date.', 'medium', 'Regenerate the Live API key pair under Account & Settings > API Keys, update every system using the old key, then update the recorded generation date in the Prism connection.'),
  ('razorpay', 'razorpay.webhooks.secret_on_file', 'A webhook signing secret has been captured for signature verification evidence', 'Confirms a webhook secret has been stored in the Prism connection as a proxy for a webhook being configured, since Razorpay''s Webhooks API is Partner-account-only and not queryable for a regular merchant.', 'high', 'Under Account & Settings > Webhooks, confirm a webhook is configured with HTTPS delivery, copy its secret, and add it to the Prism connection''s stored secret.'),
  ('razorpay', 'razorpay.webhooks.signature_verification_documented', 'Webhook signature verification (HMAC-SHA256 over X-Razorpay-Signature) is documented as implemented on the receiving endpoint', 'Whether the merchant''s webhook receiver validates the signature is outside Razorpay''s API and Prism''s network visibility; requires manual evidence from the customer.', 'high', 'Implement HMAC-SHA256 verification of X-Razorpay-Signature on the raw request body before processing any webhook event, then attach the code reference or a signed attestation as manual evidence in Prism.'),
  ('razorpay', 'razorpay.payments.captured_reconciled', 'Captured payments are being retrieved and reconciled (API connectivity/evidence-freshness check)', 'Calls the Payments API with the connected key to confirm the credential is valid, live, and returning recent transaction data, as a connectivity/freshness signal.', 'low', 'If this fails, verify the Key Id/Secret pair hasn''t been regenerated or revoked in the Dashboard since Prism was connected.'),
  ('razorpay', 'razorpay.account.team_access_reviewed_attestation', 'Team member access (Dashboard Manage Team) has been reviewed within the policy window', 'Placeholder control: Razorpay has no API for team/role listing, so this cannot run automatically and appears as not_applicable until manual evidence is uploaded.', 'high', 'Review Account & Settings > Business Settings > Manage Team at least quarterly, remove access for anyone who no longer needs it, and upload a dated screenshot as manual evidence in Prism.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('razorpay.keys.live_mode_in_use', 'A.14.2.9'),
  ('razorpay.keys.rotation_age_within_policy', 'A.9.2.4'),
  ('razorpay.webhooks.secret_on_file', 'A.9.4.1'),
  ('razorpay.webhooks.signature_verification_documented', 'A.14.1.3'),
  ('razorpay.payments.captured_reconciled', 'A.12.1.1'),
  ('razorpay.account.team_access_reviewed_attestation', 'A.9.2.5')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `razorpay` (used in `registry.js`).
- **Suggested files**:
  - `api/src/connectors/razorpay/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/aws/index.js`'s structure (simple key-pair auth, no token exchange).
  - `api/src/connectors/razorpay/credentials.js` — `resolveRazorpayCredentials({ authType, config, secret })`: just returns the pre-formed Basic Auth header value (`Buffer.from(\`${config.keyId}:${secret.keySecret}\`).toString("base64")`) plus `webhookSecretOnFile: Boolean(secret.webhookSecret)`; there is no token exchange or SDK dependency needed — a thin `fetch` wrapper is sufficient.
  - `api/src/connectors/razorpay/client.js` — small wrapper around `fetch` targeting `https://api.razorpay.com/v1`, handling the `count`/`skip` pagination style and 429 backoff.
  - `api/src/connectors/razorpay/tests/keys.js`, `tests/webhooks.js`, `tests/payments.js`, `tests/account.js` — grouped by resource area, matching `api/src/connectors/github/tests/*.js`'s split.
- **Registry wiring**: add `import * as razorpay from "./razorpay/index.js";` and `[razorpay.key]: razorpay` to `api/src/connectors/registry.js`.
- **`testConnection()`** should perform a cheap connectivity probe — e.g. `GET /v1/payments?count=1` — analogous to AWS's `GetCallerIdentity` pattern, returning `{ ok: true, externalAccountId: <merchant/account id if present in response, else the keyId prefix> }`. Razorpay's Payments API responses do not consistently surface a distinct "account id" separate from the Key Id itself, so `externalAccountId` may just echo the configured `keyId`.
- **Config-attested vs. API-verified checks must be visually distinguished in the UI** (e.g., a badge on the finding) so auditors don't treat a self-reported date or an "assumed present" flag as equivalent to a verified control — this is the most important implementation caveat for this connector given how much of the requested scope (team/roles, API key rotation, webhooks, applications) sits entirely behind Dashboard-only UI with no API.
- Consider filing/monitoring a feature request with Razorpay for a merchant-scoped Team Members / API Keys / Webhooks read API — if Razorpay ever exposes this, the `config-attested` checks above should be converted to true `API-verified` checks.
