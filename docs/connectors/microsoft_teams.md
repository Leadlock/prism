# Microsoft Teams Connector (proposed)

Status: design spec, not yet implemented. Follows the existing connector pattern (see
`api/src/connectors/purview/` for the plain-`fetch` + multi-resource-token shape this connector
should copy, and `docs/connectors/entra_id.md` for the shared Azure AD app registration this
connector reuses).

## 1. Overview

- **Connector key**: `microsoft_teams`
- **Category**: `collaboration` (free-text, no DB constraint — matches `microsoft_365`).
- **Audit scope**: Teams guest/external-access configuration (federation with other tenants and
  with unmanaged "Teams consumer" accounts), the Teams client's tenant-wide guest toggle and
  third-party cloud-storage integrations, and Teams tenant-wide policies (meeting and messaging
  policies, app permission policy) — i.e. exactly the "Users, guests, external access, policies"
  scope from the prioritization sheet.
- **Boundary vs. the other 4 Microsoft connectors in this group**:
  - **`microsoft_365`** (existing sibling doc) explicitly defers to this connector: its own
    Overview states *"this connector does not check Teams-specific settings (guest/external
    access, meeting/messaging policies) — that's entirely `microsoft_teams`'s job, even though
    'Teams' is nominally part of the Microsoft 365 suite."* That is a **full deferral, not a
    partial one** — `microsoft_365.md` proposes zero Teams-specific checks anywhere in its own
    Proposed Checks table, so there is no overlap to reconcile here.
  - **`entra_id`**: tenant-wide guest **account** lifecycle (creation, sign-in staleness,
    disable/removal — `entra_id.users.stale_guest_accounts_reviewed`) stays there, because it's a
    directory-level Entra ID B2B concern independent of any specific workload. This connector only
    owns the Teams-specific *capabilities* granted to those guest accounts once they exist
    (whether they can access the Teams client at all, what they can do in a meeting/chat) — a
    narrower, Teams-workload-scoped slice of the same broader "guest" topic.
  - **`microsoft_defender`** (this doc's sibling, below): device/endpoint threat data is entirely
    out of scope here, even though Teams meetings/chat are a common attack vector Defender alerts
    on.
  - **`azure`**: ARM-managed infrastructure is entirely out of scope here.
  - **`purview`** (existing connector): unified audit log, Data Map, and classification are out of
    scope here.

## 2. Authentication

- **`auth_type`**: `oauth2` — the same Azure AD app registration and client-credentials flow as
  `entra_id`/`microsoft_365`/`microsoft_defender` (see "Shared app registration" in
  `docs/connectors/entra_id.md`), extended with additional Graph application permissions **and**
  a one-time tenant-level enablement step that is genuinely different from anything the other
  three connectors need (see "Tenant Configuration Management enrollment" below).

### Setup steps

1. Reuse the shared app registration (or create one — see `entra_id.md` step 2) in
   **Microsoft Entra ID > App registrations**.
2. **API permissions > Add a permission > Microsoft Graph > Application permissions**, add:
   - `TeamSettings.Read.All` — per-team settings (member/guest permissions, messaging, fun
     settings) via `GET /teams/{id}`.
   - `TeamMember.Read.All` — team membership, including guest members, via
     `GET /teams/{id}/members`.
   - `TeamsAppInstallation.Read.All` — installed Teams apps per team/chat/user scope, used by the
     app-installation-hygiene angle of the app permission policy check.
   - `Organization.Read.All` — **this is the one permission that needs a correction against the
     original research brief.** The brief guessed `Policy.Read.All` for "Teams meeting/messaging
     policies via Graph beta." Verified against the current Microsoft Graph permissions reference
     and the "Supported Microsoft Teams resources for Tenant Configuration Management" doc:
     `Policy.Read.All` does not cover any Teams policy resource. The tenant-wide policy resources
     this connector needs — `federationConfiguration` (external access/guest federation),
     `clientConfiguration` (the Teams client's `AllowGuestUser` toggle and third-party storage
     integrations), `guestMeetingConfiguration`, `guestMessagingConfiguration`, `meetingPolicy`,
     `messagingPolicy`, and `appPermissionPolicy` — are all exposed through the newer **Tenant
     Configuration Management (TCM)** API surface in Microsoft Graph
     (`microsoft.graph.teamsAdministration` / UTCM namespace), and every one of those resource
     types documents its required Graph application permission as `Organization.Read.All` for
     read operations, not `Policy.Read.All`.
3. Select **Grant admin consent for `<tenant>`** for all four permissions above.
4. **Tenant Configuration Management enrollment (one-time, distinct from admin consent)**: per
   Microsoft's "Set up authentication for Tenant Configuration Management APIs" doc, the tenant
   must additionally add and enable a separate **TCM service principal** in the tenant before
   `Organization.Read.All` actually unlocks read access to the policy resources above — granting
   the permission on this connector's own app registration is not, by itself, sufficient. This is
   a real deviation from the "one app registration, N permission grants" story the rest of this
   connector group follows, and should be verified/walked through once against a real tenant
   before implementation, the same way `microsoft_365.md` flags verifying Exchange Online Admin
   API cmdlet coverage before assuming parity.
5. In Prism, create the `microsoft_teams` integration connection and enter the `config`/`secret`
   below (same triple as the other Microsoft connectors if the app registration is shared).

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

This connector calls **two** distinct shapes of the same Microsoft Graph audience (unlike
`microsoft_365`, both shapes share one token resource — there is no separate non-Graph API surface
here, unlike Defender):

| Surface | Base URL | API version | Used for |
|---|---|---|---|
| Graph core resources | `https://graph.microsoft.com/v1.0` | v1.0 | `TeamSettings.Read.All`/`TeamMember.Read.All`/`TeamsAppInstallation.Read.All`-backed checks |
| Tenant Configuration Management (TCM) | `https://graph.microsoft.com/beta` | beta | `federationConfiguration`, `clientConfiguration`, `guestMeetingConfiguration`, `guestMessagingConfiguration`, `meetingPolicy`, `messagingPolicy`, `appPermissionPolicy` reads |

- **Token acquisition**: `POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`,
  `grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default` — via the shared
  helper (see Implementation Notes), same as every other Graph-backed connector in this group.
  One token audience covers both surfaces above; there is no Defender-style dual-resource
  complication here.
- **TCM read shape — verify before implementing**: the TCM APIs are built around a **snapshot**
  job pattern (`configurationSnapshotJob` — create a snapshot job for the target resource types,
  poll it, then read the extracted current-state values) rather than a plain synchronous `GET`
  per resource. This is a materially different request shape than every other check in this
  connector group (create → poll → fetch, likely 2-3 HTTP round-trips per check group instead of
  one), and the precise request/response schema should be confirmed against the live `beta` TCM
  snapshot API reference before implementation — flagging this the same way `microsoft_365.md`
  flags verifying `Get-SafeLinksPolicy`/`Get-SafeAttachmentPolicy` REST parity rather than letting
  it be discovered mid-implementation.
- **Pagination**: the Graph core resources (`/teams`, `/teams/{id}/members`) follow the standard
  `@odata.nextLink` cursor — reuse the `entra_id` connector's shared `graphPaginate()` helper. TCM
  snapshot results return the current state of the requested resource types in a single job result
  payload and are not expected to need cursor pagination (a snapshot targets a bounded, tenant-wide
  set of policy objects, not a per-user or per-message collection) — confirm this once the TCM
  schema is reviewed.
- **Rate limiting**: Graph's standard per-app throttling applies to both surfaces — respect
  `429`/`Retry-After` with a single bounded retry, consistent with `describeGraphError()`.

## 4. Proposed Checks

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `microsoft_teams.externalaccess.federation_domains_restricted` | External domain federation is restricted, not fully open | critical | A.13.2.1 | Checks the tenant's Teams federation configuration (`federationConfiguration`, `CsTenantFederationConfiguration`) either has `AllowFederatedUsers: false`, or if enabled, defines an explicit `AllowedDomains` allowlist rather than allowing federation with every external domain. | Under Teams admin center > Users > External access, restrict external access to a defined list of allowed domains, or disable it entirely if not required for the business. |
| `microsoft_teams.externalaccess.consumer_teams_blocked` | Communication with unmanaged consumer Teams/Skype accounts is blocked | high | A.13.2.1 | Checks the federation configuration has `AllowTeamsConsumer` and `AllowTeamsConsumerInbound` both set to `false`, preventing tenant users from chatting/calling with personal (non-organizational) Microsoft accounts. | Disable "Teams accounts not managed by an organization" under Teams admin center > Users > External access. |
| `microsoft_teams.client.guest_access_reviewed` | The Teams client's tenant-wide guest access toggle is a reviewed, deliberate setting | high | A.9.2.6 | Checks the Teams client configuration (`clientConfiguration.AllowGuestUser`) is either `false`, or `true` with a documented business justification — this is the Teams-workload-specific toggle layered on top of the tenant's Entra ID guest account policy, not a duplicate of it. | If guest access to the Teams client isn't required, disable it under Teams admin center > Users > Guest access; if required, record the justification for audit evidence. |
| `microsoft_teams.client.unsanctioned_storage_providers_disabled` | Unsanctioned third-party cloud storage providers are disabled in the Teams client | medium | A.13.2.1 | Checks the Teams client configuration has none of `AllowBox`, `AllowDropBox`, `AllowGoogleDrive`, `AllowShareFile`, `AllowEgnyte` enabled unless explicitly approved, preventing users from attaching ungoverned external storage that bypasses SharePoint/OneDrive DLP controls. | Disable unapproved third-party storage providers under Teams admin center > Teams apps > Cloud storage options, retaining only providers with an approved DLP/data-residency review. |
| `microsoft_teams.guests.meeting_capabilities_restricted` | Guest meeting capabilities are limited to what's required | medium | A.9.4.1 | Checks the guest meeting configuration (`guestMeetingConfiguration`) has `AllowMeetNow: false` and `ScreenSharingMode` not set to `EntireScreen` for guests, limiting guest-initiated ad-hoc meetings and full-desktop screen sharing. | Restrict guest meeting capabilities under Teams admin center > Meetings > Guest meeting policy (or the equivalent `Set-CsTeamsGuestMeetingConfiguration` cmdlet). |
| `microsoft_teams.policies.meeting_anonymous_join_restricted` | The global meeting policy does not auto-admit anonymous or unknown external participants | critical | A.9.4.1 | Checks the global Teams meeting policy (`meetingPolicy`, `Get-CsTeamsMeetingPolicy -Identity Global`) has `AutoAdmittedUsers` set to something more restrictive than `Everyone`, and `AllowAnonymousUsersToJoinMeeting` is `false` unless anonymous join is a deliberate business requirement. | Set `AutoAdmittedUsers` to `EveryoneInCompany` or a more restrictive value, and disable anonymous meeting join under Teams admin center > Meetings > Meeting policies, unless externally-facing anonymous meetings are an intentional exception. |
| `microsoft_teams.policies.meeting_recording_retention_bounded` | Meeting recording retention is bounded, not set to never expire | medium | A.18.1.3 | Checks that where the global meeting policy allows cloud recording (`AllowCloudRecording: true`), `NewMeetingRecordingExpirationDays` is set to a finite value aligned with the organization's records retention policy, rather than `-1` (never expire). | Set `NewMeetingRecordingExpirationDays` under Teams admin center > Meetings > Meeting policies to a value consistent with the organization's data retention schedule. |
| `microsoft_teams.policies.thirdparty_app_installation_restricted` | Third-party Teams app installation is governed by an explicit allow-list | medium | A.12.5.1 | Checks the global Teams app permission policy (`appPermissionPolicy`) restricts the default/global catalog app types to a defined allow-list rather than permitting all third-party apps to be installed by any user. | Configure the global app permission policy under Teams admin center > Teams apps > Permission policies to allow only reviewed, approved third-party apps. |

## 5. Seed SQL

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('microsoft_teams', 'Microsoft Teams', 'collaboration', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('microsoft_teams', 'microsoft_teams.externalaccess.federation_domains_restricted', 'External domain federation is restricted, not fully open', 'Checks the tenant federation configuration either blocks external federation or restricts it to an explicit allowed-domains list.', 'critical', 'Restrict external access to a defined list of allowed domains, or disable it entirely, under Teams admin center > Users > External access.'),
  ('microsoft_teams', 'microsoft_teams.externalaccess.consumer_teams_blocked', 'Communication with unmanaged consumer Teams/Skype accounts is blocked', 'Checks federation with unmanaged personal Microsoft accounts is disabled tenant-wide.', 'high', 'Disable Teams accounts not managed by an organization under Teams admin center > Users > External access.'),
  ('microsoft_teams', 'microsoft_teams.client.guest_access_reviewed', 'The Teams client tenant-wide guest access toggle is a reviewed, deliberate setting', 'Checks the Teams client guest access setting is either disabled or explicitly documented as an approved exception.', 'high', 'Disable Teams client guest access if not required, or document the business justification for audit evidence.'),
  ('microsoft_teams', 'microsoft_teams.client.unsanctioned_storage_providers_disabled', 'Unsanctioned third-party cloud storage providers are disabled in the Teams client', 'Checks no unapproved third-party storage provider integration is enabled in the Teams client.', 'medium', 'Disable unapproved third-party storage providers under Teams admin center > Teams apps > Cloud storage options.'),
  ('microsoft_teams', 'microsoft_teams.guests.meeting_capabilities_restricted', 'Guest meeting capabilities are limited to what is required', 'Checks guest meeting configuration restricts ad-hoc meeting creation and full-screen sharing for guests.', 'medium', 'Restrict guest meeting capabilities under Teams admin center > Meetings > Guest meeting policy.'),
  ('microsoft_teams', 'microsoft_teams.policies.meeting_anonymous_join_restricted', 'The global meeting policy does not auto-admit anonymous or unknown external participants', 'Checks the global Teams meeting policy restricts automatic admission and disables anonymous join unless deliberately required.', 'critical', 'Restrict AutoAdmittedUsers and disable anonymous meeting join under Teams admin center > Meetings > Meeting policies.'),
  ('microsoft_teams', 'microsoft_teams.policies.meeting_recording_retention_bounded', 'Meeting recording retention is bounded, not set to never expire', 'Checks meeting recording expiration is set to a finite value where cloud recording is enabled.', 'medium', 'Set a finite recording expiration period under Teams admin center > Meetings > Meeting policies.'),
  ('microsoft_teams', 'microsoft_teams.policies.thirdparty_app_installation_restricted', 'Third-party Teams app installation is governed by an explicit allow-list', 'Checks the global Teams app permission policy restricts third-party app installation to an approved allow-list.', 'medium', 'Configure the global app permission policy to allow only reviewed, approved third-party apps.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('microsoft_teams.externalaccess.federation_domains_restricted', 'A.13.2.1'),
  ('microsoft_teams.externalaccess.consumer_teams_blocked', 'A.13.2.1'),
  ('microsoft_teams.client.guest_access_reviewed', 'A.9.2.6'),
  ('microsoft_teams.client.unsanctioned_storage_providers_disabled', 'A.13.2.1'),
  ('microsoft_teams.guests.meeting_capabilities_restricted', 'A.9.4.1'),
  ('microsoft_teams.policies.meeting_anonymous_join_restricted', 'A.9.4.1'),
  ('microsoft_teams.policies.meeting_recording_retention_bounded', 'A.18.1.3'),
  ('microsoft_teams.policies.thirdparty_app_installation_restricted', 'A.12.5.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 6. Implementation Notes

- **Connector key**: `microsoft_teams` — new entry in `api/src/connectors/registry.js`:
  `import * as microsoftTeams from "./microsoft_teams/index.js";` and add
  `[microsoftTeams.key]: microsoftTeams` to the `connectors` map.
- **Files to add**:
  - `api/src/connectors/microsoft_teams/credentials.js` — thin wrapper calling the **shared**
    `resolveMicrosoftGraphCredentials()` helper proposed in `entra_id.md` with
    `resource: "https://graph.microsoft.com"`. This connector does not need a second resource —
    both the v1.0 core resources and the beta TCM resources are the same Graph audience, unlike
    `microsoft_365`'s Exchange Online Admin API split or Defender's distinct token audience (see
    `microsoft_defender.md`).
  - `api/src/connectors/microsoft_teams/index.js` — `key`, `tests`, `testConnection` (probe
    `GET /teams?$top=1` — cheap, requires only `TeamSettings.Read.All`, analogous to `entra_id`'s
    `GET /organization` probe), `runTests`, `describeGraphError()` reusing the same shape as
    `entra_id`/`microsoft_365`.
  - `api/src/connectors/microsoft_teams/tests/externalAccess.js`,
    `tests/clientConfiguration.js`, `tests/meetingPolicies.js`, `tests/appPolicies.js` — one file
    per check group.
  - `api/src/connectors/microsoft_teams/tcmSnapshot.js` — small helper implementing the
    create-snapshot-job → poll → read-result flow described in API Reference, so every TCM-backed
    check file calls one shared function instead of reimplementing the async job polling loop
    four times.
- **Files to edit**: `init.sql` (append the seed blocks above), `api/src/connectors/registry.js`.
- **Shares the Microsoft Graph auth helper** proposed in `entra_id.md`
  (`resolveMicrosoftGraphCredentials()`) — do not add a second, parallel token-caching
  implementation here. This connector, `entra_id`, and `microsoft_365`'s Graph-facing half all
  request the same `https://graph.microsoft.com/.default` scope, so in principle a single cached
  token could even be shared across connectors within one `runTests` invocation if a future
  refactor wants to go further than per-connector caching — not required for this pass, just
  noted since it's a natural follow-on given how much of this token logic is now duplicated
  per-connector.
- **Verify before implementing**: (1) the exact TCM snapshot job request/response schema against
  the live `beta` TCM API reference — the create/poll/read shape described above is inferred from
  Microsoft's TCM overview docs, not confirmed against a working example; (2) that the tenant's
  TCM service principal enrollment (Authentication section, step 4) is a one-time tenant setup
  action Prism can document for the customer rather than something Prism itself needs to automate;
  if TCM access isn't available in a given tenant (e.g. licensing or preview-gating), the fallback
  is the `MicrosoftTeams` PowerShell module (`Connect-MicrosoftTeams` with app-only certificate
  auth) calling `Get-CsTenantFederationConfiguration`/`Get-CsTeamsMeetingPolicy`/
  `Get-CsTeamsMessagingPolicy`/`Get-CsTeamsClientConfiguration` directly — a real deviation from
  this connector's otherwise Graph-only shape, flagged here the same way `microsoft_365.md` flags
  its Exchange/Security & Compliance PowerShell fallback rather than letting it be discovered
  during implementation.
