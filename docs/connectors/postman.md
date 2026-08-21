# Postman Connector

## 1. Overview

- **Proposed `integrations.category`**: `devops`
- **Proposed `integrations.key`**: `postman`
- **Proposed `integrations.auth_type`**: `api_key`

Postman is an API design/testing/collaboration platform. For ISO 27001 purposes the compliance-relevant surface is Postman's **team/organization administration** layer, not its request-testing features: who has admin/owner rights on the team, which workspaces are exposed outside the team (a real secret-leakage vector — public workspaces have repeatedly been the source of exposed API keys and tokens found by third parties), which accounts hold the "Guest" or "Partner" (external) roles, and whether API-key/user lifecycle events are actually being logged.

**Scope for v1** (per the user's prioritization sheet: organizations, teams, workspaces, users, API keys, permissions):
- Team membership and role assignment (Admin / Super Admin / Developer / Viewer / Guest / Partner).
- Workspace visibility (`personal` / `private` / `team` / `public` / `partner`) — the public-exposure check.
- SCIM-based automated de-provisioning, where the org has Enterprise SCIM configured.
- API key lifecycle *activity* as captured in Audit Logs.

**Honest gap — this is the one place this doc scopes down from the ideal**: Postman's public REST API has **no endpoint that lists individual API keys, their scopes, creation date, expiry, or last-used timestamp**. Key management (`go.postman.co/manage-postman-keys`) is a dashboard-only surface — the Postman API documentation for key management (learning.postman.com/docs/administration/managing-your-team/managing-api-keys) describes filtering/searching/revoking keys and org-wide expiry policies entirely in UI terms, and no corresponding `GET /keys`-style endpoint exists in the Postman API reference. The closest evidence Prism can collect automatically is the **Audit Logs API** (`GET /audit-logs`, Professional/Enterprise only), which records events like "created a Postman API key" — so the proposed check is reframed from "is this key stale" (not verifiable) to "is key-lifecycle activity actually being captured in the audit trail" (verifiable). This is called out again under Proposed Checks below.

## 2. Authentication

**`auth_type`: `api_key`**

Postman's own API authenticates with a single per-user API key sent as a request header — no OAuth handshake, no client secret rotation flow.

### Setup steps (Postman UI)

1. Sign in to Postman as a user with **Admin** or **Super Admin** team role (required to see team-wide data such as all workspaces and all members, not just the caller's own).
2. Go to **Account Settings > API Keys** (or the header **Organization > Postman Keys** dashboard on Enterprise plans, which additionally shows/filters/revokes existing keys).
3. Click **Generate API Key**, give it a descriptive name (e.g. `prism-evidence-collector`), and copy the value immediately — Postman shows it only once. Keys are prefixed `PMAK-`.
4. If the org has **"Set expiry for API keys"** enabled under organization settings, note the expiry date; Prism's connection will stop authenticating once the key expires and will need a fresh key generated and re-entered.
5. (Optional, Enterprise + SCIM-provisioned orgs only) Note the org's **team ID** from **Team Settings** — some endpoints (e.g. `GET /teams/{teamId}`) require it explicitly rather than inferring it from the calling key.
6. (Optional, only if the org wants the SCIM-based de-provisioning check to run) confirm SCIM provisioning is configured under **Team Settings > SCIM Provisioning** — this uses a *separate* SCIM-specific bearer token issued from that same screen, distinct from the personal API key above; Prism only needs to know *whether* SCIM is active, which the regular API key can already probe (see API Reference).

### `config` shape (non-secret, stored on `integration_connections.config`)

```json
{
  "teamId": "1234567"
}
```

### `secret` shape (encrypted, stored via `integration_credentials`)

```json
{
  "apiKey": "PMAK-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

The connector sends `X-Api-Key: <secret.apiKey>` on every request. `config.teamId` is optional — if omitted, the connector resolves it at connect time via `GET /teams` (returns all teams visible to the key) and uses the first/only team, erroring if the org has more than one team and none was specified.

## 3. API Reference

- **Base URL**: `https://api.postman.com` (the public Postman API; distinct from `https://api.getpostman.com`, an older alias still accepted for some legacy endpoints, and from `https://api.getpostman.com/scim/v2/` — the *separate* SCIM base, which takes its own SCIM bearer token, not the `X-Api-Key`).
- **Auth header**: `X-Api-Key: <apiKey>` on every request (per `learning.postman.com/docs/reference/postman-api/authentication`).
- **Rate limits**: 300 requests/minute per API key (`learning.postman.com/docs/reference/postman-api/postman-api-rate-limits`); responses carry `RateLimit-Remaining` / `RateLimit-Reset` headers Prism should read and back off on rather than hard-coding a fixed delay.
- **Pagination**: mixed by endpoint age/family:
  - Newer endpoints (`GET /teams`, `GET /audit-logs`) are cursor-based: `?cursor=&limit=`, with `meta.nextCursor` in the response to page with.
  - `GET /workspaces` returns the full list in one response with no pagination parameters (acceptable at current scale; revisit if Postman changes this).
  - The separate SCIM endpoint (`GET /scim/v2/Users`) uses SCIM's own `startIndex`/`count` convention (default page size 100).
- **Endpoints needed**:
  - `GET /workspaces` — all workspaces visible to the key; each entry includes `id`, `name`, `type` (`personal`|`team`), and `visibility` (`personal`|`private`|`team`|`public`|`partner`) — `visibility: "public"` is the exposure signal.
  - `GET /teams` — list teams (`id`, `name`, `memberCount`, etc.), `?include=true` to also return team settings.
  - `GET /teams/{teamId}?include=members,userRoles` — team member roster with each member's role (`Super Admin`, `Admin`, `Community Manager`, `Developer`, `Viewer`, `Billing Only`, `Guest`, `Partner`, `Partner Lead`, etc.).
  - `GET /workspace-roles` — the catalog of assignable workspace-level roles (`Admin`/`Editor`/`Viewer`), used to interpret per-workspace role assignments returned alongside workspace details.
  - `GET /audit-logs` (Professional/Enterprise only) — team audit events (`id`, `action`, `actor`, `timestamp`, `message`), 180-day retention; includes API-key creation/removal and role-change events.
  - `GET /scim/v2/Users` (Enterprise + SCIM-provisioned orgs only) — returns `200` with the user roster if SCIM provisioning is active, or `404`/`403` if not configured — used purely as an active/inactive probe for the SCIM de-provisioning check, not to re-fetch a roster Prism already has from `GET /teams/{teamId}?include=members`.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `postman.workspace.public_visibility_reviewed` | No workspace is exposed with public visibility without review | high | A.8.2.3 | Checks `GET /workspaces` for any workspace with `visibility: "public"`, flagging it for review — public workspaces are visible to anyone on the internet and are a documented source of leaked API keys/tokens/secrets left in example requests or environment variables. | Change the workspace's visibility to `team` or `private` under Workspace Settings > Visibility unless it is deliberately maintained as a public-facing developer resource with no sensitive values in any collection/environment/example. |
| `postman.team.privileged_role_count_minimized` | Admin/Super Admin team role is limited to necessary personnel | medium | A.9.2.3 | Checks the number of team members holding `Admin` or `Super Admin` role (via `GET /teams/{teamId}?include=members,userRoles`) does not exceed a defined threshold (default 5), flagging excessive standing privileged access. | Review the team member list and demote accounts that don't require full administrative rights over team settings, billing, and all workspaces to `Developer` or `Viewer`. |
| `postman.team.guest_role_access_reviewed` | Guest-role access is periodically reviewed | medium | A.9.2.5 | Checks team members assigned the `Guest` role (external users granted ad hoc access to specific shared collections outside the team) are enumerated for periodic access review rather than left indefinitely. | Confirm each Guest account still has a current business justification; remove Guest access under Team Settings > Members and Groups for anyone who no longer needs it. |
| `postman.team.partner_workspace_access_reviewed` | Partner Workspace external access is periodically reviewed | medium | A.9.2.5 | Checks team members assigned the `Partner` or `Partner Lead` role (external collaborators with standing access to one or more Partner Workspaces, Enterprise only) are enumerated for periodic review; returns `not_applicable` if the org has no Partner Workspaces feature enabled. | Confirm each Partner/Partner Lead account is tied to an active external engagement; remove the role once the partnership or project concludes. |
| `postman.org.scim_deprovisioning_active` | Automated user de-provisioning (SCIM) is configured | medium | A.9.2.6 | Checks `GET /scim/v2/Users` responds successfully, evidencing the org has SCIM provisioning configured against an IdP so that user removal in the IdP automatically de-provisions Postman access; returns `not_applicable` on non-Enterprise plans or where SCIM is simply not configured (a config choice, not itself a failure, but worth surfacing). | If the org relies on manual off-boarding instead, document that process; for Enterprise plans, prefer configuring SCIM under Team Settings > SCIM Provisioning so access removal isn't dependent on someone remembering a manual step. |
| `postman.apikey.lifecycle_activity_logged` | Postman API key lifecycle events are captured in Audit Logs | medium | A.12.4.1 | **Scoped down** from an ideal "flag stale/over-scoped keys" check, because the Postman API exposes no endpoint listing individual keys' age, scopes, or last-used time. Instead checks `GET /audit-logs` (Professional/Enterprise) returns key-lifecycle events (`action` matching key creation/removal) within the lookback window, evidencing that API key activity is at least auditable after the fact even though it isn't queryable as current state. | Review Audit Logs (or the exported SIEM feed) periodically for unexpected `Postman API key created` events; since Postman doesn't expose key age via API, track key rotation manually via the `go.postman.co/manage-postman-keys` dashboard, which does show creation date and last-used time. |

## 5. Seed SQL

```sql
-- ===== Postman connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('postman', 'Postman', 'devops', 'api_key', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('postman', 'postman.workspace.public_visibility_reviewed', 'No workspace is exposed with public visibility without review', 'Checks for any workspace with public visibility, flagging it for review since public workspaces are a documented source of leaked API keys/tokens/secrets.', 'high', 'Change the workspace''s visibility to team or private unless it is deliberately maintained as a public-facing developer resource with no sensitive values.'),
  ('postman', 'postman.team.privileged_role_count_minimized', 'Admin/Super Admin team role is limited to necessary personnel', 'Checks the number of team members holding Admin or Super Admin role does not exceed a defined threshold, flagging excessive standing privileged access.', 'medium', 'Review the team member list and demote accounts that don''t require full administrative rights to Developer or Viewer.'),
  ('postman', 'postman.team.guest_role_access_reviewed', 'Guest-role access is periodically reviewed', 'Checks team members assigned the Guest role are enumerated for periodic access review rather than left indefinitely.', 'medium', 'Confirm each Guest account still has a current business justification; remove Guest access for anyone who no longer needs it.'),
  ('postman', 'postman.team.partner_workspace_access_reviewed', 'Partner Workspace external access is periodically reviewed', 'Checks team members assigned the Partner or Partner Lead role are enumerated for periodic review.', 'medium', 'Confirm each Partner/Partner Lead account is tied to an active external engagement; remove the role once the partnership concludes.'),
  ('postman', 'postman.org.scim_deprovisioning_active', 'Automated user de-provisioning (SCIM) is configured', 'Checks the org has SCIM provisioning configured against an IdP so user removal automatically de-provisions Postman access.', 'medium', 'For Enterprise plans, prefer configuring SCIM under Team Settings > SCIM Provisioning so access removal isn''t dependent on a manual step.'),
  ('postman', 'postman.apikey.lifecycle_activity_logged', 'Postman API key lifecycle events are captured in Audit Logs', 'Checks Audit Logs return key-lifecycle events within the lookback window, evidencing API key activity is auditable.', 'medium', 'Review Audit Logs periodically for unexpected API key creation events; track key rotation manually via the Postman API key management dashboard.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('postman.workspace.public_visibility_reviewed', 'A.8.2.3'),
  ('postman.team.privileged_role_count_minimized', 'A.9.2.3'),
  ('postman.team.guest_role_access_reviewed', 'A.9.2.5'),
  ('postman.team.partner_workspace_access_reviewed', 'A.9.2.5'),
  ('postman.org.scim_deprovisioning_active', 'A.9.2.6'),
  ('postman.apikey.lifecycle_activity_logged', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector `key`**: `postman` (added to `registry.js`).
- **Suggested files**:
  - `api/src/connectors/postman/index.js` — exports `key`, `tests`, `testConnection()`, `runTests()`, mirroring `api/src/connectors/aws/index.js`'s structure: build one small `fetch`-based client (or thin wrapper) carrying `apiKey` and `teamId`, run each test's `run(clients)`.
  - `api/src/connectors/postman/credentials.js` — trivial for `api_key`: just validates `secret.apiKey` is present and returns it; no token exchange needed (unlike AWS/GitHub/Salesforce).
  - `api/src/connectors/postman/client.js` — wraps `fetch` for `GET /workspaces`, `GET /teams`, `GET /teams/{teamId}`, `GET /audit-logs`, `GET /scim/v2/Users` (against the SCIM base, only called for the SCIM-active probe); centralizes the `X-Api-Key` header and `RateLimit-*` header handling/backoff.
  - `api/src/connectors/postman/tests/workspaces.js` — `checkPublicVisibilityReviewed`.
  - `api/src/connectors/postman/tests/team.js` — `checkPrivilegedRoleCountMinimized`, `checkGuestRoleAccessReviewed`, `checkPartnerWorkspaceAccessReviewed`.
  - `api/src/connectors/postman/tests/org.js` — `checkScimDeprovisioningActive`, `checkApiKeyLifecycleActivityLogged`.
- **Registry wiring**: add `import * as postman from "./postman/index.js";` and `[postman.key]: postman` to `api/src/connectors/registry.js`, matching the existing one-line-per-connector shape.
- **`testConnection()`**: a cheap probe is `GET /teams` (with the configured or resolved `teamId`) — return `{ ok: true, externalAccountId: String(teamId) }`.
- **Not-applicable handling**: `postman.team.partner_workspace_access_reviewed` and `postman.org.scim_deprovisioning_active` should return `not_applicable` (not `fail`) when the underlying feature isn't present/enabled on the org's plan, following the same precedent as GitHub's Actions checks returning `not_applicable` when the App lacks the relevant permission.
- **Threshold config**: `postman.team.privileged_role_count_minimized`'s threshold (proposed default: 5) should live as a named constant in `team.js`, matching the inline-constant convention used for `github.org.owners_count_minimized`.
- **Known limitation to carry into the UI**: `postman.apikey.lifecycle_activity_logged` cannot tell Prism *which* key is stale or *what scopes* it has — only that key-lifecycle events exist in the audit trail. The check's description/remediation text above should render as-is in the Findings UI so auditors don't mistake it for a full key-inventory check.
