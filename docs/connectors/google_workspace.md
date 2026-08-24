# Google Workspace Connector

Status: implemented (`api/src/connectors/google_workspace/`). Follows the existing connector
pattern (see `api/src/connectors/azure/` and `api/src/connectors/github/`, both OAuth2-based).

**Correction vs. the original design below**: the Drive/Gmail/Calendar sharing-default checks
read via the **Cloud Identity Policy API** (`cloudidentity.googleapis.com`, scope
`cloud-identity.policies.readonly`) — a distinct API/host from the **Chrome Policy API**
(`chromepolicy.googleapis.com`) originally proposed for all of them. Google splits these across
two separate APIs even though both are configured from adjacent Admin Console "Additional Google
services" policy screens; verified against `docs.cloud.google.com/identity/docs/concepts/
supported-policy-api-settings`, which lists the exact `drive_and_docs.*`, `gmail.auto_forwarding`,
and `calendar.primary_calendar_max_allowed_external_sharing` setting types used by
`tests/drive.js`, `tests/gmail.js`, `tests/calendar.js`. The Chrome Policy API (and its
`chrome.management.policy.readonly` scope) is used only by `tests/devices.js`, resolving the
documented `chrome.users.SessionLengthV2` schema. Also added: `admin.directory.customer.readonly`,
used once at credential-resolution time (`customers.get`) to resolve the `"my_customer"` alias to
a real `customers/Cxxxx` ID up front, since the Cloud Identity Policy API's `customer==` filter
and the Chrome Policy API's `customer` path segment aren't documented as accepting the alias.

## 1. Overview

- **Connector key**: `google_workspace`
- **Category**: `identity` (Admin SDK Directory/Reports and Chrome Policy are fundamentally
  identity- and endpoint-management APIs; Drive/Gmail/Calendar checks ride along on the same
  service account rather than justifying a separate `saas` connector). `category` has no
  DB-level CHECK constraint, so this is a naming convention only, consistent with
  `cloud` (aws/azure), `devops` (github), `data_governance` (purview).
- **`auth_type`**: `oauth2` (domain-wide delegation via a Google Cloud service account — see
  below for why this is the right classification for the existing CHECK constraint on
  `integrations.auth_type`, which allows only `'iam_role', 'access_key', 'oauth2', 'api_key'`).
- **Audit scope**: super admin / delegated admin role assignment, 2-Step Verification (2SV)
  enforcement, third-party OAuth app authorizations, Google Drive external/public sharing
  defaults, Gmail auto-forwarding and content-compliance (DLP) settings, Calendar external
  sharing defaults, ChromeOS device policy compliance, suspended/inactive user account
  hygiene, and Admin/audit log availability — mirroring the user's prioritization sheet
  (Admin, users, groups, MFA, OAuth apps, Drive, Gmail, Calendar, devices, Chrome, audit).

## 2. Authentication

### Why domain-wide delegation, not a 3-legged OAuth2 client

Admin SDK endpoints act on behalf of the whole Workspace domain, not one signed-in user, and
must keep working unattended (no browser, no refresh-token-holding human) whenever Prism runs a
scheduled collection. Google's documented pattern for exactly this case is a **Google Cloud
service account with domain-wide delegation, authorized in the Workspace Admin Console, that
mints a JWT impersonating a super admin's email via the `sub` claim** — the same shape Prism
already uses for GitHub (a GitHub App private key, no interactive OAuth dance at collection
time). This is *not* the classic "OAuth2 client ID + client secret + user consent screen" flow;
it is still bucketed under `auth_type: 'oauth2'` in Prism's schema because the credential the
connector holds is a private key that mints short-lived OAuth2 access tokens (via a JWT Bearer
grant, RFC 7523) rather than a static long-lived key like AWS's `iam_role`/`access_key` types —
consistent with how `azure` (client secret credential) and `github` (App private key) are both
already classified `oauth2` in this codebase despite neither being a user-consent redirect flow.

### Setup steps (performed once by the customer's Workspace super admin)

1. **Create or choose a Google Cloud project** in [Google Cloud Console](https://console.cloud.google.com/)
   that will host the connector's service account (a dedicated project per customer/tenant is
   recommended for quota isolation).
2. **Enable the required APIs** on that project: `Admin SDK API` (covers both the Directory API
   and Reports API), and `Chrome Policy API`. (APIs & Services > Library > enable each.)
3. **Create a service account**: IAM & Admin > Service Accounts > Create Service Account (no
   project IAM roles are required — all authorization happens in the Workspace Admin Console,
   not GCP IAM). Note the service account's **email** and **numeric Client ID** (shown on the
   service account's Details tab, not the email).
4. **Enable domain-wide delegation** on the service account (Service Accounts > select account >
   Details > "Show domain-wide delegation" / Advanced settings > check "Enable Google Workspace
   Domain-wide Delegation").
5. **Generate a key**: Service Accounts > select account > Keys > Add Key > Create new key > JSON.
   Download the JSON key file — this becomes the connector's `secret`. Treat it as a bearer
   credential; anyone holding it can impersonate any user in the domain for the granted scopes.
6. **Authorize the Client ID in the Workspace Admin Console** (must be done by a Workspace
   *super admin*, separately from GCP): Admin Console > Security > Access and data control >
   API Controls > Domain-wide Delegation > **Manage Domain Wide Delegation** > Add new. Paste
   the service account's numeric **Client ID** and the exact comma-separated **OAuth scope
   list** below. Note: Workspace editions with multi-party approval enabled may require a
   second super admin to confirm this authorization before it takes effect.
7. **Record the impersonation target**: a super admin (or any admin with sufficient read
   privileges) email address the service account will impersonate via the JWT `sub` claim — this
   becomes `config.adminEmail`. The account itself is never billed or otherwise affected; it's
   only used as the identity the Directory/Reports/Chrome Policy APIs authorize against.

### Exact OAuth scope list to authorize

```
https://www.googleapis.com/auth/admin.directory.user.readonly
https://www.googleapis.com/auth/admin.directory.user.security
https://www.googleapis.com/auth/admin.directory.group.readonly
https://www.googleapis.com/auth/admin.directory.group.member.readonly
https://www.googleapis.com/auth/admin.directory.domain.readonly
https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly
https://www.googleapis.com/auth/admin.directory.device.mobile.readonly
https://www.googleapis.com/auth/admin.reports.audit.readonly
https://www.googleapis.com/auth/chrome.management.policy.readonly
```

Scope-to-purpose mapping:

| Scope | Used for |
|---|---|
| `admin.directory.user.readonly` | User inventory, suspended/inactive account review, admin role flags on user records |
| `admin.directory.user.security` | `Directory.tokens.list` (per-user authorized third-party OAuth apps) — this is a distinct, higher-privilege scope from `.readonly`; Google requires it specifically for the tokens/security-events surface |
| `admin.directory.group.readonly` | Group inventory (e.g. admin/security groups) |
| `admin.directory.group.member.readonly` | Group membership (who holds elevated group-based access) |
| `admin.directory.domain.readonly` | Resolving verified domains under the customer |
| `admin.directory.device.chromeos.readonly` | ChromeOS device inventory/compliance status |
| `admin.directory.device.mobile.readonly` | Mobile device inventory (encryption/screen-lock status) |
| `admin.reports.audit.readonly` | Admin/login/OAuth-token/Drive activity events (2SV enforcement evidence, audit log retention/availability, Drive external-sharing events) |
| `chrome.management.policy.readonly` | Resolved Chrome/ChromeOS policy values (Drive/Gmail/Calendar sharing defaults are Chrome-managed or Directory-managed settings, not separate consumer-style toggles, so this scope covers org-unit policy resolution generally) |

No `admin.directory.user` (read-write), `admin.directory.group` (read-write), or
`cloud-platform` scope is requested — every check in this connector is read-only, consistent
with the "evidence collection" nature of Prism's connectors (it never mutates customer tenants).

### `config` JSON shape (stored in `integration_connections.config`, not encrypted)

```json
{
  "adminEmail": "admin@customer-domain.com",
  "customerId": "my_customer"
}
```

- `adminEmail`: the super admin (or sufficiently-privileged admin) email the service account
  impersonates via the JWT `sub` claim. Required on every API call.
- `customerId`: either the literal string `"my_customer"` (Google's documented alias that
  resolves to "the customer that owns the impersonated admin's domain" — avoids needing an
  extra `customers.get` round trip or a separate `admin.directory.customer.readonly` scope) or
  an explicit Workspace customer ID (`C0xxxxxxx`) if the integration needs to target a specific
  customer distinct from the impersonated admin's own domain.

### `secret` JSON shape (stored encrypted via `integrationCredentials.js`, AES-256-GCM)

The connector stores the fields it actually needs out of the downloaded service-account JSON
key (not the whole file, to avoid persisting unused fields like `private_key_id` /
`auth_uri` long-term, though the UI may accept a paste of the full JSON and extract these):

```json
{
  "clientEmail": "prism-connector@customer-project.iam.gserviceaccount.com",
  "privateKey": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
}
```

## 3. API Reference

| API | Base URL | Version | Purpose |
|---|---|---|---|
| Admin SDK Directory API | `https://admin.googleapis.com/admin/directory/v1` | v1 | Users, groups, group members, domains, ChromeOS/mobile devices, org units, OAuth tokens (`users/{userKey}/tokens`) |
| Admin SDK Reports API | `https://admin.googleapis.com/admin/reports/v1` | v1 | `activities.list` audit/usage events — `applicationName` values relevant here: `login` (2SV/sign-in events), `admin` (admin console changes), `token` (OAuth app grants/revocations), `drive` (external sharing events) |
| Chrome Policy API | `https://chromepolicy.googleapis.com/v1` | v1 | `customers.policies:resolve` and `customers.policies.orgunits:batchInherit` for resolved ChromeOS/Chrome browser policy values by org unit |

**Pagination**: Directory API list endpoints (`users.list`, `groups.list`, `members.list`,
`chromeosdevices.list`, `mobiledevices.list`) return `nextPageToken`; pass it back as the
`pageToken` query param until absent. `maxResults` defaults to 100 (max 500 for most Directory
list endpoints). Reports API `activities.list` uses the same `pageToken`/`nextPageToken`
convention with `maxResults` defaulting to 1000. Chrome Policy API's `resolve` method paginates
via `pageToken`/`nextPageToken` on `PolicyTargetKey` batches (query up to 200 policy schemas per
call).

**Rate limits / quotas**: Admin SDK (Directory + Reports share one quota bucket) defaults to
2,400 queries/minute per impersonated user per GCP project, with additional narrower limits on
specific write operations (not used by this read-only connector). The API returns HTTP 403/429
on quota exhaustion; Google's guidance is exponential backoff (1s, 2s, 4s, 8s, 16s + jitter).
Chrome Policy API enforces its own default quota (documented as configurable per-project via
Cloud Console > APIs & Services > Chrome Policy API > Quotas) — treat 429s from it the same way.
Given customer domains can have thousands of users/devices, `runTests()` should paginate
incrementally rather than materializing the full user list before running checks, mirroring how
`github`'s `buildClients` pre-fetches (there `octokit.paginate` over an org's repos, a much
smaller collection) — for Google Workspace, prefer per-check pagination over a single upfront
full-directory fetch.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `google_workspace.security.two_step_verification_enforced` | 2-Step Verification is enforced for all users | critical | A.9.4.2 | Checks the domain-wide 2-Step Verification enforcement policy is turned on (`isEnforcedIn2Sv`/enrollment status on the Directory API user resource) so all users, not just enrolled volunteers, must use 2SV. | Enable 2-Step Verification enforcement under Admin Console > Security > Authentication > 2-Step Verification, and set an enforcement date for all organizational units. |
| `google_workspace.admin.super_admin_role_reviewed` | Super admin role is assigned to a minimal, reviewed set of users | high | A.9.2.3 | Checks the count and identities of users holding the Super Admin (or other highly-privileged delegated admin) role, flagging accounts beyond an expected small set. | Remove Super Admin from accounts that don't require it day-to-day; use delegated admin roles scoped to the minimum privileges needed instead, under Admin Console > Account > Admin roles. |
| `google_workspace.oauth.third_party_app_risk_reviewed` | Third-party OAuth app authorizations are reviewed and restricted | high | A.9.4.1 | Checks installed/authorized third-party OAuth applications (via `users.tokens.list` and Reports API `token` events) against an allowed-scopes or allowed-app baseline, flagging apps granted high-risk scopes (e.g. full Drive/Gmail access) that aren't allowlisted. | Review and revoke risky app authorizations under Admin Console > Security > API Controls > App access control, and restrict future installs to allowlisted/internally-reviewed apps. |
| `google_workspace.groups.privileged_group_membership_reviewed` | Privileged groups have at least one owner | medium | A.9.2.2 | Checks groups matching a privileged-naming heuristic (admin, security, sudo, root, it-ops, helpdesk) have at least one OWNER-role member, flagging orphaned groups with no accountable owner. | Assign an OWNER-role member to any privileged group that lacks one, under Admin Console > Groups > select group > Members. |
| `google_workspace.drive.external_sharing_restricted` | Drive/Docs external sharing defaults are restricted | critical | A.8.2.3 | Checks the domain's default Drive sharing setting is not "Public on the web" or unrestricted "Anyone with the link", and that external sharing (if enabled) is limited to allowlisted domains. | Under Admin Console > Apps > Google Workspace > Drive and Docs > Sharing settings, restrict external sharing to specific trusted domains or disable link-sharing outside the organization by default. |
| `google_workspace.gmail.auto_forwarding_restricted` | Automatic email forwarding to external addresses is restricted | high | A.13.2.1 | Checks the Gmail auto-forwarding domain policy disallows forwarding to arbitrary external addresses (a common data-exfiltration and phishing-persistence vector), cross-referenced against Reports API `email_settings_changed`/forwarding events. | Under Admin Console > Apps > Google Workspace > Gmail > End User Access, disable "Automatic forwarding" or restrict it to internal/allowlisted domains. |
| `google_workspace.calendar.external_sharing_restricted` | Calendar external sharing default is restricted | medium | A.13.2.1 | Checks the domain default Calendar sharing setting does not expose free/busy plus event details to external/unauthenticated users by default. | Under Admin Console > Apps > Google Workspace > Calendar > Sharing settings, set the external sharing default to "Only free/busy information" or more restrictive. |
| `google_workspace.devices.chrome_policy_compliant` | Managed ChromeOS devices enforce baseline security policy | medium | A.6.2.1 | Checks resolved Chrome Policy API values for managed org units enforce baseline controls (screen lock timeout, forced re-enrollment, disk encryption where applicable) rather than leaving them unset/default. | Configure the relevant policy schemas (e.g. `chrome.users.ScreenlockPolicy`, `chrome.devices.DeviceReportingPolicy`) under Admin Console > Devices > Chrome > Settings for the affected organizational units. |
| `google_workspace.users.inactive_accounts_reviewed` | Suspended or long-inactive user accounts are reviewed | medium | A.9.2.6 | Checks for user accounts that are suspended-but-not-deleted past a retention threshold, or active accounts with no recent login activity (via Reports API `login` events / `lastLoginTime`), flagging stale accounts that retain access. | Offboard or fully remove accounts no longer needed, and investigate active accounts with no recent sign-in for compromise or abandonment. |
| `google_workspace.audit.log_retention_configured` | Admin and login audit logs are retained and actively flowing | high | A.12.4.1 | Checks Reports API `admin` and `login` application activity events are available and recent (data flowing within the expected window), evidencing audit logging hasn't silently stopped. | Investigate via Admin Console > Reporting > Audit and investigation if no recent activity is returned — this can indicate a licensing, retention, or API access change rather than genuine inactivity. |

## 5. Seed SQL (for `init.sql`)

```sql
-- ===== Google Workspace connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('google_workspace', 'Google Workspace', 'identity', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('google_workspace', 'google_workspace.security.two_step_verification_enforced', '2-Step Verification is enforced for all users', 'Checks the domain-wide 2-Step Verification enforcement policy is turned on so all users, not just enrolled volunteers, must use 2SV.', 'critical', 'Enable 2-Step Verification enforcement under Admin Console > Security > Authentication > 2-Step Verification, and set an enforcement date for all organizational units.'),
  ('google_workspace', 'google_workspace.admin.super_admin_role_reviewed', 'Super admin role is assigned to a minimal, reviewed set of users', 'Checks the count and identities of users holding the Super Admin (or other highly-privileged delegated admin) role, flagging accounts beyond an expected small set.', 'high', 'Remove Super Admin from accounts that don''t require it day-to-day; use delegated admin roles scoped to the minimum privileges needed instead, under Admin Console > Account > Admin roles.'),
  ('google_workspace', 'google_workspace.oauth.third_party_app_risk_reviewed', 'Third-party OAuth app authorizations are reviewed and restricted', 'Checks installed/authorized third-party OAuth applications against an allowed-scopes or allowed-app baseline, flagging apps granted high-risk scopes that aren''t allowlisted.', 'high', 'Review and revoke risky app authorizations under Admin Console > Security > API Controls > App access control, and restrict future installs to allowlisted/internally-reviewed apps.'),
  ('google_workspace', 'google_workspace.groups.privileged_group_membership_reviewed', 'Privileged groups have at least one owner', 'Checks groups matching a privileged-naming heuristic have at least one OWNER-role member, flagging orphaned groups with no accountable owner.', 'medium', 'Assign an OWNER-role member to any privileged group that lacks one, under Admin Console > Groups > select group > Members.'),
  ('google_workspace', 'google_workspace.drive.external_sharing_restricted', 'Drive/Docs external sharing defaults are restricted', 'Checks the domain default Drive sharing setting is not "Public on the web" or unrestricted "Anyone with the link", and that external sharing is limited to allowlisted domains.', 'critical', 'Under Admin Console > Apps > Google Workspace > Drive and Docs > Sharing settings, restrict external sharing to specific trusted domains or disable link-sharing outside the organization by default.'),
  ('google_workspace', 'google_workspace.gmail.auto_forwarding_restricted', 'Automatic email forwarding to external addresses is restricted', 'Checks the Gmail auto-forwarding domain policy disallows forwarding to arbitrary external addresses.', 'high', 'Under Admin Console > Apps > Google Workspace > Gmail > End User Access, disable "Automatic forwarding" or restrict it to internal/allowlisted domains.'),
  ('google_workspace', 'google_workspace.calendar.external_sharing_restricted', 'Calendar external sharing default is restricted', 'Checks the domain default Calendar sharing setting does not expose free/busy plus event details to external/unauthenticated users by default.', 'medium', 'Under Admin Console > Apps > Google Workspace > Calendar > Sharing settings, set the external sharing default to "Only free/busy information" or more restrictive.'),
  ('google_workspace', 'google_workspace.devices.chrome_policy_compliant', 'Managed ChromeOS devices enforce baseline security policy', 'Checks resolved Chrome Policy API values for managed org units enforce baseline controls rather than leaving them unset/default.', 'medium', 'Configure the relevant policy schemas under Admin Console > Devices > Chrome > Settings for the affected organizational units.'),
  ('google_workspace', 'google_workspace.users.inactive_accounts_reviewed', 'Suspended or long-inactive user accounts are reviewed', 'Checks for suspended-but-not-deleted accounts past a retention threshold, or active accounts with no recent login activity, flagging stale accounts that retain access.', 'medium', 'Offboard or fully remove accounts no longer needed, and investigate active accounts with no recent sign-in for compromise or abandonment.'),
  ('google_workspace', 'google_workspace.audit.log_retention_configured', 'Admin and login audit logs are retained and actively flowing', 'Checks Reports API admin and login application activity events are available and recent, evidencing audit logging hasn''t silently stopped.', 'high', 'Investigate via Admin Console > Reporting > Audit and investigation if no recent activity is returned.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('google_workspace.security.two_step_verification_enforced', 'A.9.4.2'),
  ('google_workspace.admin.super_admin_role_reviewed', 'A.9.2.3'),
  ('google_workspace.oauth.third_party_app_risk_reviewed', 'A.9.4.1'),
  ('google_workspace.groups.privileged_group_membership_reviewed', 'A.9.2.2'),
  ('google_workspace.drive.external_sharing_restricted', 'A.8.2.3'),
  ('google_workspace.gmail.auto_forwarding_restricted', 'A.13.2.1'),
  ('google_workspace.calendar.external_sharing_restricted', 'A.13.2.1'),
  ('google_workspace.devices.chrome_policy_compliant', 'A.6.2.1'),
  ('google_workspace.users.inactive_accounts_reviewed', 'A.9.2.6'),
  ('google_workspace.audit.log_retention_configured', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

### Suggested files

```
api/src/connectors/google_workspace/
  index.js               # key, tests[], testConnection(), runTests() — mirrors azure/github's index.js shape
  credentials.js          # resolveGoogleWorkspaceCredentials({ authType, config, secret }) -> { directory, reports, chromepolicy } clients
  tests/
    security.js           # two_step_verification_enforced
    admin.js               # super_admin_role_reviewed
    oauth.js                # third_party_app_risk_reviewed
    groups.js               # privileged_group_membership_reviewed
    drive.js                # external_sharing_restricted
    gmail.js                # auto_forwarding_restricted
    calendar.js             # external_sharing_restricted
    devices.js               # chrome_policy_compliant
    users.js                  # inactive_accounts_reviewed
    audit.js                   # log_retention_configured
```

### Node client library

Use the **`googleapis`** npm package (Google's official Node.js API client), specifically:
- `google.auth.JWT` (or `google-auth-library`'s `JWT` class directly) constructed with
  `{ email: secret.clientEmail, key: secret.privateKey, scopes: [...], subject: config.adminEmail }`
  — the `subject` field is what performs the domain-wide-delegation impersonation.
- `google.admin({ version: 'directory_v1', auth })` for the Directory API.
- `google.admin({ version: 'reports_v1', auth })` for the Reports API (same `admin` namespace,
  different API version string — do not confuse with a second package).
- `google.chromepolicy({ version: 'v1', auth })` for the Chrome Policy API.

`credentials.js` should follow the exact shape of `api/src/connectors/azure/credentials.js` and
`api/src/connectors/github/credentials.js` — validate `config.adminEmail`, `secret.clientEmail`,
`secret.privateKey` are present, throw a descriptive `Error` if not, then return ready-to-use
clients (not raw credentials) so `index.js`'s `buildClients()`-equivalent step stays thin, e.g.:

```js
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.security",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.mobile.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/chrome.management.policy.readonly",
];

export async function resolveGoogleWorkspaceCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported Google Workspace auth type: ${authType}`);
  if (!config.adminEmail) throw new Error("Google Workspace connection is missing config.adminEmail");
  if (!secret.clientEmail) throw new Error("Google Workspace connection is missing secret.clientEmail");
  if (!secret.privateKey) throw new Error("Google Workspace connection is missing secret.privateKey");

  const auth = new google.auth.JWT({
    email: secret.clientEmail,
    key: secret.privateKey,
    scopes: SCOPES,
    subject: config.adminEmail,
  });
  await auth.authorize(); // forces token mint — throws on bad key/unauthorized client ID/missing scope grant

  const customerId = config.customerId || "my_customer";
  return {
    directory: google.admin({ version: "directory_v1", auth }),
    reports: google.admin({ version: "reports_v1", auth }),
    chromepolicy: google.chromepolicy({ version: "v1", auth }),
    customerId,
  };
}
```

`testConnection()` should call `auth.authorize()` (or equivalently `directory.users.list({ customer: customerId, maxResults: 1 })`)
as the connectivity probe — this is Google Workspace's analog of AWS's STS `GetCallerIdentity`
and Azure's `resourceGroups.list().next()` probes already used in this codebase, and will throw
immediately if the Client ID wasn't authorized in the Admin Console, the scope list doesn't
match exactly, or the impersonated `adminEmail` doesn't exist/lacks privileges.

### Connector `key` for `registry.js`

```js
// api/src/connectors/registry.js
import * as google_workspace from "./google_workspace/index.js";

const connectors = { ..., [google_workspace.key]: google_workspace };
```

with `google_workspace/index.js` exporting `export const key = "google_workspace";` — matching
this document's `test_key` prefix and the `integrations.key` seed value above.
