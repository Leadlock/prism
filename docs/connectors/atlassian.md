# Atlassian Connector

> **New connector.** Covers Atlassian Cloud at the organization level (admin.atlassian.com) plus the two products the org sits on top of — Jira Cloud and Confluence Cloud. Follows the existing connector module pattern in `api/src/connectors/<key>/index.js` (see `api/src/connectors/azure/index.js` for the OAuth2-style structural reference, and `api/src/connectors/github/index.js` for the pattern of a single static-credential client feeding multiple test files).

## 1. Overview

- **Category**: `collaboration` (new category value). Existing categories are `cloud` (aws, azure), `devops` (github, gitlab — source-control/CI tooling), and `data_governance` (purview). Jira and Confluence are workspace/project-collaboration tools, not infrastructure or source-control tooling, so folding them into `devops` would misrepresent what they audit (issue trackers and wikis, not pipelines or repos). `collaboration` is proposed as the category for future connectors of this shape (e.g. Slack, Notion) as well.
- **Connector key**: `atlassian` (new — to be added to `api/src/connectors/registry.js`).
- **Scope, org-level vs. per-product**:
  - **Organization-level** (admin.atlassian.com Organization API — `api.atlassian.com/admin/...`): managed users, groups, product access, admin/owner role assignment, security policies (2FA/SSO enforcement, allowed domains), audit log (events). This is the primary compliance surface — it applies once per Atlassian organization regardless of how many Jira/Confluence sites hang off it.
  - **Per-product** (Jira Cloud REST API v3, Confluence Cloud REST API v1/v2): project- and space-level permission scheme review — specifically detecting public/anonymous access grants, which the Organization API has no visibility into (it manages identity and org policy, not per-project ACLs).
  - A company connects **one Atlassian organization** (`config.orgId`) plus **one representative Jira/Confluence site** (`config.siteUrl`, e.g. `https://acme.atlassian.net`) per connection — most Atlassian customers run a single site per org, and multi-site is out of scope for v1 (see Implementation Notes).

## 2. Authentication

**`auth_type`: `api_key`** (not `oauth2`). Reasoning:

1. **The Organization API — where the highest-severity checks live (2FA/SSO enforcement, admin roles, audit log) — only supports API-key Bearer auth.** There is no OAuth2 (3LO) grant type for `api.atlassian.com/admin/v1|v2/orgs/...`; Atlassian's own docs for these endpoints state authentication is "implemented via an API key... use the API Key as a Bearer access token." Choosing `oauth2` as the connector's `auth_type` would misdescribe how the majority of its checks actually authenticate.
2. **OAuth 2.0 (3LO) is designed for user-facing, consent-driven apps** (typically Marketplace apps acting on behalf of an individual end user via a browser redirect). Prism's evidence collector is an unattended, scheduled, org-wide background job with no human in the loop per run — it isn't acting "as a user," it's acting as the organization's compliance tooling. Atlassian's own developer docs explicitly steer this exact use case ("simple scripts and direct/manual calls to the REST APIs") toward API tokens rather than requiring a registered OAuth2 app with redirect URIs and refresh-token rotation.
3. **`integrations.auth_type` is one value per connector**, and every check in scope — Organization API, Jira, and Confluence — can be satisfied with API-key-shaped credentials: an **Organization API key** (Bearer token) for the org-level checks, and a per-product **API token** (email + token, HTTP Basic) for the two Jira/Confluence permission-scheme checks. Splitting `auth_type` per check isn't supported by the schema, so the auth model that covers 100% of proposed checks with one credential shape wins.
4. Atlassian has been actively investing in the API-token path as the supported machine-to-machine mechanism, not deprecating it: **scoped API keys** (restricting an Organization API key to specific admin scopes instead of full access) shipped as the current recommended default when generating a key, and Atlassian introduced per-token rate limiting (effective November 22, 2025) to make the token path more production-grade, not to push users off it. This further supports `api_key` as the durable choice rather than something to migrate away from.

If Prism later needs to act *as a specific end user* (e.g. a "connect your own Jira account" feature outside compliance evidence collection), that would justify a second, OAuth2 (3LO)-based integration — but it is not what this connector needs.

### Setup steps

**A. Organization API key (org-level checks: users, groups, policies, audit log)**

1. Go to `admin.atlassian.com`, select the organization to audit.
2. Navigate to **Settings > API keys**.
3. Click **Create API key**. Prefer **API keys with scopes** over an unscoped (full-access) key — select only the read scopes the checks below need (`read:org:atlassian-admin`, `read:user:atlassian-admin` or equivalent, `read:audit-log:atlassian-admin`, `read:policy:atlassian-admin` — confirm exact scope names against the current scope picker in the console, as Atlassian has been iterating on scope naming).
4. Name it descriptively (e.g. `prism-evidence-collection`) and set an expiration date (max 1 year — Atlassian requires an expiry on every key). Track this expiry for rotation; Prism does not auto-refresh this key.
5. Copy the key immediately — it is shown once and cannot be recovered later, only regenerated.
6. Note the **Organization ID**, shown on the same Organization settings page (used as `{orgId}` in every Organization API path).

**B. Jira/Confluence API token (per-product checks: permission schemes, space permissions)**

1. As a user with a **read-only/auditor-level product role** in the target Jira and Confluence sites (do not use an admin account's token if a lower-privilege account can read permission schemes — Prism's checks are read-only), go to `id.atlassian.com/manage-profile/security/api-tokens`.
2. Click **Create API token**, name it (e.g. `prism-evidence-collection`), set an expiration (Atlassian now requires expiring tokens), and copy it immediately.
3. This token is used with **HTTP Basic auth**: `base64(email:apiToken)` in the `Authorization` header, against both the Jira site (`https://<site>.atlassian.net/rest/api/3/...`) and the Confluence site on the same tenant (`https://<site>.atlassian.net/wiki/rest/api/...`) — one token covers both products on a given site.

### `config` / `secret` shapes

```json
// integration_connections.config
{
  "orgId": "1e2e3e4e-...-organization-uuid",
  "siteUrl": "https://acme.atlassian.net"
}
```

```json
// integration_credentials (decrypted secret shape)
{
  "orgApiKey": "eyJhbGciOi...",
  "productEmail": "prism-audit@acme.com",
  "productApiToken": "ATATT3xFfGF0..."
}
```

## 3. API Reference

| Surface | Base URL | Auth |
|---|---|---|
| Organization API | `https://api.atlassian.com/admin/` | `Authorization: Bearer {orgApiKey}` |
| Jira Cloud REST API v3 | `https://{site}.atlassian.net/rest/api/3/` | `Authorization: Basic {base64(email:apiToken)}` |
| Confluence Cloud REST API | `https://{site}.atlassian.net/wiki/rest/api/` (v1) | `Authorization: Basic {base64(email:apiToken)}` |

**Confirmed Organization API endpoints** (verified against `developer.atlassian.com/cloud/admin/*` — paths below include the version prefix exactly as documented):

- `GET /v1/orgs/{orgId}` — organization details (`testConnection` probe)
- `GET /v1/orgs/{orgId}/users` — managed accounts in the org (user list + status)
- `GET /v2/orgs/{orgId}/directories/{directoryId}/users` — richer per-user directory listing (product access, account type)
- `GET /v1/orgs/{orgId}/directory/users/{accountId}/last-active-dates` — last-active timestamps (dormant-account signal)
- `GET /v1/orgs/{orgId}/policies` and `GET /v1/orgs/{orgId}/policies/{policyId}` — org security policies (2FA/SSO enforcement, allowed domains, session duration)
- `GET /v1/orgs/{orgId}/events` — audit log query (filter by `action`, `from`, `to`); `GET /v1/orgs/{orgId}/events/{eventId}` for a single event; `GET /v1/orgs/{orgId}/event-actions` to enumerate loggable action types
- **Groups**: enumerated via the Directory/Groups endpoints under the same `/v2/orgs/{orgId}/...` family (group membership is what several checks below cross-reference against user product access)

**Jira Cloud REST API v3** (relevant to this connector):

- `GET /rest/api/3/project/search` — enumerate projects
- `GET /rest/api/3/permissionscheme` — list permission schemes; `GET /rest/api/3/permissionscheme/{schemeId}?expand=permissions` — scheme detail, including each permission's `holder.type` (`group`, `user`, `projectRole`, or `anyone`) and `holder.value`. A `holder.type: "anyone"` grant on `BROWSE_PROJECTS` (or `CREATE_ISSUES`) is exactly Jira Cloud's supported mechanism for public/anonymous project access — confirmed current behavior (adding the **Anyone** group to a permission grants unauthenticated Internet access, per Atlassian's own documentation), not a legacy/deprecated concept.
- `GET /rest/api/3/project/{projectIdOrKey}` — resolve which permission scheme a project uses

**Confluence Cloud REST API**:

- `GET /wiki/rest/api/space` (v1) — enumerate spaces
- `GET /wiki/rest/api/space/{spaceKey}/permission` (v1) — space permission list
- `GET /wiki/api/v2/spaces/{id}/permissions` (v2, RBAC-enabled tenants) — newer equivalent, requires `read:space:confluence` scope if accessed via OAuth2 (not applicable here since this connector uses Basic auth)
- Anonymous/unlicensed space access is a distinct opt-in feature (`/wiki/rest/knowledge-base/1.0/permissions/space/anonymousView` toggles it) rather than a flag returned inline on the standard permission list — the check below treats "no anonymous-view grant found for the space" as pass, and a positive grant as fail.

**Pagination**: cursor-based on the Organization API (`cursor` query parameter, opaque token in the response); offset/`startAt`+`maxResults` on Jira/Confluence v3/v1 APIs (standard Atlassian REST pagination envelope: `{ startAt, maxResults, total, values: [...] }`).

**Rate limits**: Organization API — separate buckets per sub-API, e.g. the Events (audit log) API is limited to 60 req/min per user and roughly 10 req/min per API path (tightened from 50/min in 2025); the Last-Active-Dates API allows 200 req/min. Response headers `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` are present on Organization API responses. Jira/Confluence Cloud enforce per-token rate limits (effective Nov 22, 2025) on API-token-authenticated requests; back off on `429` using `Retry-After` where present, mirroring the pattern in `github/index.js`'s `describeGithubError`.

## 4. Proposed Checks (9)

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `atlassian.org.two_factor_enforced` | Organization enforces two-factor authentication | critical | A.9.4.2 | Checks the org's security policy (`GET /v1/orgs/{orgId}/policies`) has a two-step verification / 2FA-enforcement policy active for all managed accounts. | Create or enable a "Two-step verification" security policy under admin.atlassian.com > Security > Authentication policies and apply it to all users. |
| `atlassian.org.sso_enforced` | Organization enforces single sign-on for managed accounts | high | A.9.2.1 | Checks the org's security policy reports SAML SSO is required (password-based login disabled) for accounts on verified/claimed domains. | Configure a SAML SSO identity provider under Security > Identity providers, then enable an enforcement policy requiring SSO for all managed accounts. |
| `atlassian.org.admin_role_review` | Organization admin role is limited to necessary personnel | high | A.9.2.3 | Checks the number of accounts holding the org-admin (or product-admin) role, resolved via the Users/Directory API's role data, does not exceed a defined threshold (default 5), flagging excessive standing privileged access. | Review the organization's Administrators list under Security > Administrators and demote accounts that don't require full org-admin access to a scoped product-admin or member role. |
| `atlassian.org.guest_external_access` | Guest and unmanaged external accounts are reviewed | high | A.9.2.5 | Checks for accounts with product access whose email domain is not on the org's list of claimed/verified domains (i.e. unmanaged or external "guest" identities), flagging any that hold access beyond what an active collaboration requires. | Review external/guest accounts under Directory > Managed accounts, and remove product access for any account that no longer needs it or belongs to an unverified domain. |
| `atlassian.org.managed_accounts_policy` | User accounts are managed under a verified domain | medium | A.9.2.1 | Checks that accounts with product access are "managed" (belonging to a domain the org has verified via Domain Claiming), rather than unmanaged personal accounts the org cannot centrally govern (deactivate, enforce policy on, or audit). | Verify remaining domains under Directory > Domains, and migrate or offboard any unmanaged accounts once domain claiming is complete. |
| `atlassian.org.api_token_rotation` | API tokens are rotated within a defined age threshold | medium | A.9.4.3 | Checks product API tokens associated with managed accounts (via the user-management Api-Tokens data, or the configured expiry on tokens created after Atlassian's mandatory-expiry rollout) are not older than a defined threshold (default 90 days) or lack an expiration date entirely. | Rotate the API token under id.atlassian.com > Security > API tokens, and always set an expiration date when creating new tokens. |
| `atlassian.org.audit_log_retention` | Audit log events are actively retained and queryable | high | A.12.4.1 | Checks the Events API (`GET /v1/orgs/{orgId}/events`) returns events within the expected retention window (at least the last 30 days), evidencing audit logging is active rather than silently lapsed. | Confirm audit logging is enabled for the organization (available on Enterprise/Premium plans) and investigate any gap in event history with Atlassian support. |
| `atlassian.jira.permission_scheme_no_public_access` | Jira project permission schemes do not grant public/anonymous access | critical | A.9.1.2 | Checks every permission scheme in use (`GET /rest/api/3/permissionscheme/{id}?expand=permissions`) has no permission grant with `holder.type: "anyone"` on `BROWSE_PROJECTS`, `CREATE_ISSUES`, or `EDIT_ISSUES` — the mechanism by which a Jira Cloud project is made accessible without authentication. | Remove the "Anyone" grant from the affected permission(s) in the scheme under Project settings > Permissions (or the global Permission Schemes admin page), restricting access to named groups or roles. |
| `atlassian.confluence.space_permission_no_anonymous_access` | Confluence spaces do not grant anonymous/unlicensed access | critical | A.9.1.2 | Checks each space's permission set (`GET /wiki/rest/api/space/{spaceKey}/permission`) has no anonymous-view or unlicensed-access grant enabled, which would expose space content to unauthenticated internet users. | Disable anonymous/unlicensed access for the space under Space settings > Permissions, and confirm the site-wide "Allow anonymous access" setting (if present) is off unless explicitly required. |

## 5. Seed SQL

```sql
-- ===== Atlassian connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('atlassian', 'Atlassian (Jira & Confluence)', 'collaboration', 'api_key', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('atlassian', 'atlassian.org.two_factor_enforced', 'Organization enforces two-factor authentication', 'Checks the org''s security policy has a two-step verification / 2FA-enforcement policy active for all managed accounts.', 'critical', 'Create or enable a "Two-step verification" security policy under admin.atlassian.com > Security > Authentication policies and apply it to all users.'),
  ('atlassian', 'atlassian.org.sso_enforced', 'Organization enforces single sign-on for managed accounts', 'Checks the org''s security policy reports SAML SSO is required (password-based login disabled) for accounts on verified/claimed domains.', 'high', 'Configure a SAML SSO identity provider under Security > Identity providers, then enable an enforcement policy requiring SSO for all managed accounts.'),
  ('atlassian', 'atlassian.org.admin_role_review', 'Organization admin role is limited to necessary personnel', 'Checks the number of accounts holding the org-admin (or product-admin) role does not exceed a defined threshold, flagging excessive standing privileged access.', 'high', 'Review the organization''s Administrators list under Security > Administrators and demote accounts that don''t require full org-admin access to a scoped product-admin or member role.'),
  ('atlassian', 'atlassian.org.guest_external_access', 'Guest and unmanaged external accounts are reviewed', 'Checks for accounts with product access whose email domain is not on the org''s list of claimed/verified domains, flagging any that hold access beyond what an active collaboration requires.', 'high', 'Review external/guest accounts under Directory > Managed accounts, and remove product access for any account that no longer needs it or belongs to an unverified domain.'),
  ('atlassian', 'atlassian.org.managed_accounts_policy', 'User accounts are managed under a verified domain', 'Checks that accounts with product access are managed (belonging to a domain the org has verified via Domain Claiming), rather than unmanaged personal accounts the org cannot centrally govern.', 'medium', 'Verify remaining domains under Directory > Domains, and migrate or offboard any unmanaged accounts once domain claiming is complete.'),
  ('atlassian', 'atlassian.org.api_token_rotation', 'API tokens are rotated within a defined age threshold', 'Checks product API tokens associated with managed accounts are not older than a defined threshold or lack an expiration date entirely.', 'medium', 'Rotate the API token under id.atlassian.com > Security > API tokens, and always set an expiration date when creating new tokens.'),
  ('atlassian', 'atlassian.org.audit_log_retention', 'Audit log events are actively retained and queryable', 'Checks the Events API returns events within the expected retention window, evidencing audit logging is active rather than silently lapsed.', 'high', 'Confirm audit logging is enabled for the organization (available on Enterprise/Premium plans) and investigate any gap in event history with Atlassian support.'),
  ('atlassian', 'atlassian.jira.permission_scheme_no_public_access', 'Jira project permission schemes do not grant public/anonymous access', 'Checks every permission scheme in use has no permission grant with holder.type "anyone" on Browse Projects, Create Issues, or Edit Issues.', 'critical', 'Remove the "Anyone" grant from the affected permission(s) in the scheme under Project settings > Permissions (or the global Permission Schemes admin page), restricting access to named groups or roles.'),
  ('atlassian', 'atlassian.confluence.space_permission_no_anonymous_access', 'Confluence spaces do not grant anonymous/unlicensed access', 'Checks each space''s permission set has no anonymous-view or unlicensed-access grant enabled.', 'critical', 'Disable anonymous/unlicensed access for the space under Space settings > Permissions, and confirm the site-wide "Allow anonymous access" setting (if present) is off unless explicitly required.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('atlassian.org.two_factor_enforced', 'A.9.4.2'),
  ('atlassian.org.sso_enforced', 'A.9.2.1'),
  ('atlassian.org.admin_role_review', 'A.9.2.3'),
  ('atlassian.org.guest_external_access', 'A.9.2.5'),
  ('atlassian.org.managed_accounts_policy', 'A.9.2.1'),
  ('atlassian.org.api_token_rotation', 'A.9.4.3'),
  ('atlassian.org.audit_log_retention', 'A.12.4.1'),
  ('atlassian.jira.permission_scheme_no_public_access', 'A.9.1.2'),
  ('atlassian.confluence.space_permission_no_anonymous_access', 'A.9.1.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `atlassian` (new) — register in `api/src/connectors/registry.js`:
  ```js
  import * as atlassian from "./atlassian/index.js";
  const connectors = { [aws.key]: aws, [azure.key]: azure, [github.key]: github, [purview.key]: purview, [atlassian.key]: atlassian };
  ```
- **Files to add** (mirroring the `github`/`gitlab` connector layout):
  - `api/src/connectors/atlassian/credentials.js` — `resolveAtlassianCredentials({ authType, config, secret })`: validates `authType === "api_key"`, returns two request-builders off one object — `orgClient` (Bearer `secret.orgApiKey` against `api.atlassian.com/admin`) and `productClient` (Basic `base64(secret.productEmail:secret.productApiToken)` against `config.siteUrl`).
  - `api/src/connectors/atlassian/index.js` — exports `key = "atlassian"`, `tests`, `testConnection` (probes `GET /v1/orgs/{orgId}` for the org client and `GET /rest/api/3/myself` for the product client — both must succeed), `runTests` (builds `clients = { org, orgId, jira, confluence, siteUrl }` once per run, iterates `tests`, same shape as `azure/index.js` and `github/index.js`).
  - `api/src/connectors/atlassian/tests/orgAccess.js` — `atlassian.org.two_factor_enforced`, `atlassian.org.sso_enforced`, `atlassian.org.admin_role_review`, `atlassian.org.guest_external_access`, `atlassian.org.managed_accounts_policy`.
  - `api/src/connectors/atlassian/tests/orgAudit.js` — `atlassian.org.api_token_rotation`, `atlassian.org.audit_log_retention`.
  - `api/src/connectors/atlassian/tests/jira.js` — `atlassian.jira.permission_scheme_no_public_access`.
  - `api/src/connectors/atlassian/tests/confluence.js` — `atlassian.confluence.space_permission_no_anonymous_access`.
- **Files to edit**: `init.sql` (append the seed blocks above, following the `-- ===== <X> connector: catalog seed data =====` comment convention already used for Purview/GitHub), `api/src/connectors/registry.js`.
- **Client library**: no official Atlassian JS SDK covers both the Organization API and Jira/Confluence REST APIs in one package — use a plain `fetch`-based client (consistent with the raw-`pg` / no-heavy-dependency style elsewhere in this repo) rather than pulling in a third-party wrapper; the Organization API's cursor pagination and Jira/Confluence's `startAt`/`maxResults` pagination are both simple enough to hand-roll two small paginate helpers, one per style.
- **Two credential shapes, one connection**: unlike `azure`/`github` (single credential resolves one client), this connector's `resolveAtlassianCredentials` must produce two distinct authenticated clients from the one stored `secret` — keep this contained inside `credentials.js` so `index.js` and the test files just consume `clients.org` / `clients.jira` / `clients.confluence` without knowing about the two auth schemes underneath.
- **`holder.type: "anyone"` detection caveat**: confirm during implementation whether `expand=permissions` on `GET /rest/api/3/permissionscheme/{id}` returns `holder.type` literally as `"anyone"` or as a `group` grant naming the built-in `Anyone` pseudo-group on any given site — Atlassian's public/anonymous access model has shifted terminology across API versions, so this should be verified against a live test site rather than assumed from documentation excerpts alone.
- **Not-applicable handling**: `atlassian.org.sso_enforced` and `atlassian.org.two_factor_enforced` should return `not_applicable` (not `fail`) when the org is on a plan tier where the relevant policy type isn't offered (e.g. SSO enforcement requires Enterprise), following the same precedent as `checkTwoFactorRequired`/`checkSecretScanningEnabled` in `github/tests/`.
- **Threshold config**: `atlassian.org.admin_role_review`'s admin-count threshold (proposed default: 5) and `atlassian.org.api_token_rotation`'s age threshold (proposed default: 90 days) should live as named constants in their respective test files, matching the inline-constant convention used for `gitlab.group.owners_count_minimized`.
