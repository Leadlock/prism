# Zoho Connector

## 1. Overview

- **Integration key:** `zoho`
- **Category:** `business_apps`
- **Auth type:** `oauth2`

Zoho is not one API — it's a suite of ~40 independently-versioned products (CRM, Books, People, WorkDrive, Desk, Mail, Vault, Projects, Analytics, Creator, Sign, Expense, Recruit, Directory, Cliq, Inventory, Payroll, ...), each with its own REST API, its own base domain, and its own OAuth2 scope namespace. The saving grace: **all of them sit behind one shared Zoho Accounts identity/OAuth layer**, and Zoho explicitly supports registering a single OAuth2 client ("self client" or server-based application) in the API Console and requesting scopes across as many products as the customer has provisioned, in one comma-separated scope string, in one grant.

So this is **one Prism integration (`zoho`) with one auth/setup flow**, not fourteen separate integrations. A single `integration_connections` row + one set of encrypted credentials in `integration_credentials` (client ID, client secret, refresh token) drives every per-product check. Per-product differences (base URL, scope names, response shape) live entirely inside the connector's `tests/<product>.js` files and a small per-product API-client map — not in a second auth flow.

**Region matters.** Zoho runs fully independent regional data centers (DCs); a customer's entire org — accounts, API domain, and data — lives in exactly one DC and is invisible from the others. The OAuth client, the accounts (token) domain, and every product's API domain must all agree on the same DC, or every call fails with `INVALID_OAUTH_TOKEN` / `WRONG_DC` style errors even with valid credentials. This is why `config.dataCenter` (see below) is a required field, not an optional nicety — it changes every URL the connector calls.

## 2. Authentication (shared, once)

`auth_type: oauth2`. Zoho's self-client / server-based-application flow is the right shape for a headless backend integration like Prism's collection runner — there's no interactive end user to redirect through a browser consent screen on every token refresh; the customer performs one manual grant during setup, and Prism refreshes silently forever after.

### 2.1 Setup steps (performed once, per customer, in the Zoho API Console)

1. **Determine the customer's data center.** Ask which `zoho.<tld>` domain they log into (e.g. `zoho.com`, `zoho.eu`, `zoho.in`, `zoho.com.au`, `zoho.com.cn`, `zoho.jp`). This fixes `config.dataCenter` for the rest of setup — the accounts console, scope grant, and every subsequent API call all happen against that DC only.
2. Go to **api-console.zoho.com** (or the DC-specific console, e.g. `api-console.zoho.eu`) while signed in as an org admin, and create a new client of type **"Self Client"** (for pure server-to-server access) or **"Server-based Application"** (if you'd rather do a one-time interactive OAuth redirect during onboarding — functionally equivalent once you have a refresh token). Either way you get one **Client ID** and **Client Secret** shared by every product below.
3. In the client's **Generate Code** tab, enter the **comma-separated scope list** covering every product the customer wants Prism to audit (see per-product scope tables below — e.g. `ZohoCRM.settings.READ,ZohoBooks.settings.READ,ZohoPeople.forms.READ,WorkDrive.team.READ,...`). Only request scopes for products actually in use; Zoho's console will reject scopes for products the org hasn't provisioned.
4. Set the grant/authorization code expiry (Zoho allows up to 10 minutes) and generate the code. Immediately exchange it (within that window) for tokens:
   ```
   POST https://accounts.zoho.<dataCenter>/oauth/v2/token
     grant_type=authorization_code
     client_id={clientId}
     client_secret={clientSecret}
     redirect_uri={redirect_uri used at registration, e.g. https://localhost}
     code={grant token from step 3}
   ```
   The response contains `access_token` (short-lived, ~1 hour) and, critically, `refresh_token` — which does **not** expire on its own and is the only credential Prism persists long-term.
5. Store `refreshToken` (plus `clientId`/`clientSecret`) as the connection's encrypted `secret`, and `dataCenter` (plus `orgId`, see below) as its plaintext `config`. Prism's collection runner exchanges the refresh token for a fresh access token before each run (or on 401) via the same `/oauth/v2/token` endpoint with `grant_type=refresh_token`.
6. If the customer later wants Prism to check an additional Zoho product, repeat step 3 only — generate a new grant code adding that product's scopes to the existing self-client, exchange it, and the *same* refresh token is extended to cover the new scopes (Zoho unions scopes granted to a client across grants for the same client/user). No new client, no new integration row.
7. **Multi-DC orgs:** if the customer's Zoho org itself spans multiple DCs (rare — this is a distinct Zoho "Multi-DC" org feature, not the same thing as picking one DC above), the self-client must have Multi-DC enabled in the console and Prism would need one `config.dataCenter` per sub-org; treat this as an edge case, not the default path.

### 2.2 `config` shape

```json
{
  "dataCenter": "com",
  "orgId": "60012345678"
}
```

- `dataCenter` — one of `"com"` (US), `"eu"`, `"in"`, `"com.au"`, `"com.cn"`, `"jp"`, or `"cloud.ca"` (Canada uses `zohocloud.ca` for accounts but `zohoapis.ca` for APIs — see the domain table below). Drives every accounts/API base URL the connector builds.
- `orgId` — the Zoho Org/Portal ID (numeric). Several product APIs (Books, Desk, Projects, Recruit) require this in every request path or header (e.g. Books' `organization_id` query param) since one login can belong to multiple Zoho organizations.

### 2.3 `secret` shape

```json
{
  "clientId": "1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "clientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "refreshToken": "1000.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
}
```

Same shape regardless of which Zoho products are enabled — the scopes baked into `refreshToken` (server-side, at Zoho) determine what the connector can actually call, not anything in this payload.

## 3. API Reference (shared)

### 3.1 Data-center domain table

| Data center | `config.dataCenter` | Accounts / token domain | Generic API domain |
|---|---|---|---|
| United States | `com` | `accounts.zoho.com` | `www.zohoapis.com` |
| Europe | `eu` | `accounts.zoho.eu` | `www.zohoapis.eu` |
| India | `in` | `accounts.zoho.in` | `www.zohoapis.in` |
| Australia | `com.au` | `accounts.zoho.com.au` | `www.zohoapis.com.au` |
| China | `com.cn` | `accounts.zoho.com.cn` | `www.zohoapis.com.cn` |
| Japan | `jp` | `accounts.zoho.jp` | `www.zohoapis.jp` |
| Canada | `cloud.ca` | `accounts.zohocloud.ca` | `www.zohoapis.ca` |

Individual products largely follow `https://<product>.zoho.<dataCenter>/...` (e.g. `desk.zoho.com`, `books.zoho.com`, `people.zoho.com`, `sign.zoho.com`, `projects.zoho.com`) rather than the generic `zohoapis` domain used by CRM/WorkDrive/Analytics-style module APIs — the per-product sections below note the actual base path each check needs. Always build the base URL from `config.dataCenter`, never hardcode `.com`.

### 3.2 Token refresh flow

```
POST https://accounts.zoho.{dataCenter}/oauth/v2/token
  grant_type=refresh_token
  client_id={secret.clientId}
  client_secret={secret.clientSecret}
  refresh_token={secret.refreshToken}
```
Returns a new `access_token` (no new refresh token — the original keeps working indefinitely until the customer revokes it in the Zoho API Console or changes their password). Every product API call authenticates with `Authorization: Zoho-oauthtoken {access_token}` (note: **not** the `Bearer` scheme most other connectors use).

### 3.3 Rate limits

Zoho enforces **per-organization, per-product, rolling-24-hour API call/credit caps** — this is not a single account-wide limit, and it varies by product and by the customer's plan/edition within that product. For example, CRM meters most calls as 1 "credit" (bulk/convert-style calls cost more) with the daily credit pool scaling by edition and license count; Inventory caps range from 1,000/day (Free) to 75,000/day (Premium); other products (Books, Desk, Recruit, etc.) each publish their own per-plan daily ceiling. A run that fans out across many products/records can hit **a different limit per product in the same run** — the connector's `runTests()` must catch a 429 (or the product-specific `error.code` for a quota breach, typically surfaced as HTTP 429 with a `Retry-After` header) per-product and continue with the remaining checks rather than aborting the whole run, similar to how `describeGithubError` isolates GitHub's rate-limit case in `api/src/connectors/github/index.js`.

## 4. Per-product checks (Tier 1 — full detail)

Each row becomes one `automated_tests` seed row (`test_key`, `title`, `severity_default`, `description`, `remediation_guidance`) plus one `test_control_mappings` row (`iso_reference`).

### 4.1 Zoho Directory

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.directory.mfa_enforced` | Multi-factor authentication is enforced org-wide | critical | A.9.4.2 | Checks the Directory org-wide security policy requires MFA for all users. | Enable and enforce a multi-factor authentication policy under Zoho Directory > Security > Multi-factor Authentication, and remove any per-user exemptions. |
| `zoho.directory.sso_enforced` | Single sign-on is enforced for all applications | high | A.9.2.1 | Checks that SSO is configured as the required sign-in method rather than optional, so credentials aren't scattered across individually-authenticated apps. | Set the org's authentication policy to require SSO sign-in and disable direct password login where the identity provider supports it. |
| `zoho.directory.inactive_user_review` | Inactive or terminated users are deprovisioned | medium | A.9.2.6 | Flags Directory user accounts with no sign-in activity for 90+ days that are still marked active. | Suspend or delete the account in Zoho Directory, and confirm it is also removed from any per-product group/role assignments. |

### 4.2 Zoho CRM

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.crm.mfa_enforced` | CRM users have multi-factor authentication enabled | critical | A.9.4.2 | Checks every active CRM user has MFA enabled (directly or via the org-wide security policy). | Enforce MFA for the CRM application under Setup > Security Control > Two-Factor Authentication. |
| `zoho.crm.data_sharing_rules_restricted` | Data sharing rules do not grant org-wide read/write | high | A.13.1.1 | Checks CRM's data-sharing settings for any module are not set to "Public Read/Write" or broader than required. | Tighten the module's sharing rule under Setup > Data Sharing Settings to the narrowest role/territory grouping that meets the business need. |
| `zoho.crm.audit_log_enabled` | Audit log tracking is enabled | medium | A.12.4.1 | Checks CRM's audit log feature is turned on and retaining events. | Enable Audit Log under Setup > Security Control > Audit Log. |

### 4.3 Zoho Books

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.books.user_role_review` | User roles follow least privilege | medium | A.9.2.2 | Checks no non-admin Books user is assigned the built-in Admin role without a documented business justification. | Reassign the user to a custom role scoped to only the modules/permissions their job requires. |
| `zoho.books.two_factor_auth_enforced` | Two-factor authentication is enforced | critical | A.9.4.2 | Checks the organization's Books security policy requires 2FA for all users. | Enable "Enforce two-factor authentication" under Settings > Users & Roles > Security. |
| `zoho.books.audit_trail_enabled` | Audit trail is enabled and retained | medium | A.12.4.1 | Checks the Books audit trail feature is active and its retention meets the org's evidence-retention policy. | Enable Audit Trail under Settings > Preferences > Audit Trail and confirm retention duration. |

### 4.4 Zoho People

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.people.data_access_review` | Employee data access is restricted by role | high | A.9.1.1 | Checks People's form/module permissions restrict full-employee-database visibility to HR-admin roles only. | Adjust form permissions under Settings > Access Permissions so only HR admin roles can view records outside their own reporting hierarchy. |
| `zoho.people.sensitive_field_encryption` | Sensitive HR fields are access-restricted | high | A.8.2.3 | Checks fields holding government ID numbers, bank details, and salary data are field-level restricted to authorized roles. | Apply field-level permission restrictions on sensitive fields under the form's field settings. |
| `zoho.people.admin_role_review` | Admin role assignment is minimized | medium | A.9.2.3 | Checks the count of users with full People admin privileges is limited to designated HR/IT administrators. | Remove admin privileges from users who do not require org-wide People administration and reassign a scoped role instead. |

### 4.5 Zoho WorkDrive

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.workdrive.external_sharing_restricted` | External sharing is restricted at the team level | critical | A.13.2.1 | Checks the team/org sharing policy blocks or requires approval for sharing files/folders outside the organization. | Disable open external sharing under Team Settings > Security, or require admin approval for external shares. |
| `zoho.workdrive.link_sharing_password_protected` | Public share links require a password and expiry | high | A.9.4.1 | Checks public/anyone-with-link shares have a password and an expiration date set rather than standing open indefinitely. | Edit the share link to require a password and set an expiration date, or disable public link sharing entirely for sensitive folders. |
| `zoho.workdrive.admin_activity_log_enabled` | Admin activity logging is enabled | medium | A.12.4.1 | Checks WorkDrive's admin audit log is enabled for the team. | Enable activity logging under Admin Console > Audit. |

### 4.6 Zoho Desk

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.desk.agent_role_audit` | Agent roles follow least privilege | medium | A.9.2.3 | Checks no agent is assigned an Administrator profile without documented justification. | Reassign the agent to a Light Agent or custom profile scoped to only the permissions their job requires. |
| `zoho.desk.customer_data_field_restricted` | Customer PII fields are profile-restricted | high | A.9.4.1 | Checks fields containing customer PII (e.g. government ID, payment references) are restricted from profiles that don't need them. | Apply field-level permissions restricting the field to profiles that require it for ticket resolution. |
| `zoho.desk.ticket_access_control_enabled` | Ticket access control (team/department scoping) is enabled | medium | A.9.1.2 | Checks tickets are scoped to departments/teams rather than visible org-wide to every agent. | Enable department-based ticket access control under Setup > Developer Space > Access Control. |

### 4.7 Zoho Mail

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.mail.forwarding_restricted` | Auto-forwarding to external domains is restricted | high | A.13.2.3 | Checks org mail policy blocks or requires admin approval for automatic forwarding rules that send mail to external domains. | Disable unrestricted auto-forwarding under Mail Admin Console > Policy Controls, or require admin approval for external forwarding rules. |
| `zoho.mail.two_factor_auth_enforced` | Two-factor authentication is enforced for mailboxes | critical | A.9.4.2 | Checks the organization's mail security policy requires 2FA for all mailbox logins. | Enforce TFA under Mail Admin Console > Security > Two-Factor Authentication. |
| `zoho.mail.spam_phishing_filters_enabled` | Spam and phishing filters are enabled | medium | A.12.2.1 | Checks organization-level spam/phishing filtering policies are active for all mailboxes. | Enable and tune spam/phishing filter policies under Mail Admin Console > Security > Email Security. |

### 4.8 Zoho Vault

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.vault.secret_sharing_policy` | Secret sharing outside designated chambers is restricted | high | A.9.4.1 | Checks Vault's sharing policy prevents individual secrets from being shared directly with users outside their assigned chamber/group. | Restrict secret sharing under Vault Admin Console > Policies to chamber/group-based sharing only. |
| `zoho.vault.password_policy_strength` | Vault-generated/stored passwords meet minimum strength policy | high | A.9.4.3 | Checks the organization's password policy (used by Vault's generator and strength scoring) enforces a minimum length and complexity. | Configure the password policy under Vault Admin Console > Password Policy to require 14+ characters with mixed character classes. |
| `zoho.vault.access_log_review` | Vault access logs are enabled and retained | medium | A.12.4.1 | Checks Vault's audit/access log is enabled and retention meets the org's evidence policy. | Enable audit logging under Vault Admin Console > Reports > Audit Trail. |

### 4.9 Zoho Projects

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.projects.external_user_review` | External/client users have scoped project access | medium | A.9.1.1 | Checks client/external users are only added to the specific projects they need rather than the whole portal. | Remove the external user from projects outside their engagement and confirm client-user role restricts admin functions. |
| `zoho.projects.client_portal_access_restricted` | Client portal access is restricted to intended projects | medium | A.9.4.1 | Checks the client portal's visibility settings don't expose other clients' projects or tasks. | Restrict the client portal's project visibility under Project Settings > Client Users. |
| `zoho.projects.role_based_permissions_enforced` | Role-based permissions are enforced per project | medium | A.9.2.3 | Checks project roles (Manager/Employee/Client) are used to gate task, budget, and document permissions rather than granting everyone Manager. | Reassign users with unnecessary Manager-level project roles to Employee or a scoped custom role. |

### 4.10 Zoho Analytics

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.analytics.data_sharing_review` | Workspace/view sharing is scoped to intended users | high | A.13.2.1 | Checks workspaces and views are not shared with "Everyone in the organization" or broader than the reporting requirement. | Edit the workspace/view's sharing settings to specific users or groups instead of organization-wide sharing. |
| `zoho.analytics.public_view_link_restricted` | Public/embedded view links are disabled or reviewed | critical | A.9.4.1 | Checks published public view/embed links (which require no authentication) are disabled, or if in use, contain no sensitive data. | Disable public publishing for the view, or remove sensitive columns/rows from the underlying query before re-publishing. |
| `zoho.analytics.workspace_permission_review` | Workspace admin/owner assignment is minimized | medium | A.9.2.3 | Checks the number of users with workspace Admin/Owner permission is limited to designated report administrators. | Downgrade unnecessary Admin/Owner permissions to Designer or Viewer as appropriate. |

### 4.11 Zoho Creator

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.creator.app_permission_review` | App-level permissions follow least privilege | medium | A.9.2.3 | Checks custom applications restrict Admin/Developer permission to the users who build/maintain the app. | Adjust the app's user permissions under App Settings > Users & Permissions to remove unnecessary Developer/Admin access. |
| `zoho.creator.public_form_data_exposure` | Public forms do not expose sensitive existing records | critical | A.13.2.1 | Checks public-facing forms/pages don't embed reports or lookups that leak other users' submitted data to anonymous visitors. | Remove the exposed report/lookup field from the public form, or move it behind an authenticated (employee/portal) form instead. |
| `zoho.creator.deluge_script_access_review` | Custom (Deluge) script edit access is restricted | medium | A.14.2.5 | Checks only designated developers can edit an application's workflow/Deluge scripts, since scripts can read or exfiltrate any data the app touches. | Restrict script edit permission under App Settings > Users & Permissions to the app's designated developer role. |

### 4.12 Zoho Sign

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.sign.audit_trail_enabled` | Document audit trail is enabled | high | A.12.4.1 | Checks every completed document retains its full signing audit trail (timestamps, IP, authentication method per signer). | Enable "Include Audit Trail" in the organization's default document settings under Sign Settings > Preferences. |
| `zoho.sign.template_access_restricted` | Template access is restricted to authorized users | medium | A.9.4.1 | Checks shared templates are limited to the users/groups who need to send from them, not the whole organization. | Edit template sharing under Templates > Manage Access to remove unnecessary users/groups. |
| `zoho.sign.completed_document_retention` | Completed document retention meets policy | medium | A.18.1.3 | Checks completed/signed documents are retained for at least the organization's required evidence retention period before any auto-deletion. | Adjust the document retention/auto-delete setting under Sign Settings to meet the required retention period. |

### 4.13 Zoho Expense

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.expense.approval_policy_enforced` | Expense approval requires a separate approver | medium | A.6.1.2 | Checks the approval workflow requires an approver other than the report submitter (no self-approval). | Configure the approval workflow under Settings > Approvals to require a manager/finance approver distinct from the submitter. |
| `zoho.expense.receipt_data_retention` | Receipt/expense data retention meets policy | medium | A.18.1.3 | Checks expense records and attached receipts are retained for at least the organization's required financial/evidence retention period. | Adjust the data retention setting under Settings > Preferences to meet the required retention period. |
| `zoho.expense.card_data_masking` | Corporate card numbers are masked | high | A.8.2.3 | Checks corporate card feed data displays only masked/last-4 card numbers, not full PANs, in reports and exports. | Confirm the card feed integration is configured to store/display masked card numbers only, per the provider's masking option. |

### 4.14 Zoho Recruit

| test_key | title | severity_default | iso_reference | description | remediation_guidance |
|---|---|---|---|---|---|
| `zoho.recruit.candidate_data_access_review` | Candidate data access is restricted by role | high | A.9.1.1 | Checks candidate records (including resumes and contact PII) are visible only to recruiters/hiring managers assigned to that requisition, not all users. | Adjust the module's sharing rules under Setup > Data Sharing Settings so candidate visibility follows requisition assignment. |
| `zoho.recruit.data_retention_policy_configured` | Candidate data retention/deletion policy is configured | medium | A.18.1.3 | Checks a candidate data retention (and right-to-erasure) policy is configured, since unsuccessful-candidate PII has a legal retention ceiling under most privacy regimes. | Configure a data retention policy under Setup > Data Administration > Data Retention Policy specifying an auto-purge or review window. |
| `zoho.recruit.job_posting_visibility_review` | Job posting visibility matches intended audience | low | A.13.2.1 | Checks job postings marked internal-only are not also published to public/external career-site channels. | Edit the job opening's posting visibility under the Job Opening record to remove unintended public channels. |

## 5. Tier 2 products (brief — build later)

These either duplicate a Tier 1 product at greater depth, or are genuinely new products not yet covered. All would use the same shared `zoho` OAuth client/config — no new auth work, just new `tests/<product>.js` files and scope grants.

**Deeper checks for already-covered Tier 1 products** (add later, same connector/product file):
- **Zoho Mail** — per-mailbox forwarding rule inventory (not just the org policy), DKIM/DMARC/SPF enforcement on the org's sending domains, mailbox delegation/alias audit.
- **Zoho Projects** — time-tracking data access scoping, Blueprint (workflow automation) permission review, task-attachment external-share audit.
- **Zoho Analytics** — row-level security (data restriction) rule coverage per workspace, scheduled-export destination allowlist review.
- **Zoho Creator** — API/webhook integration credential rotation, form submission rate/abuse limits, custom function (Deluge) outbound-connection allowlist.
- **Zoho Sign** — bulk-send recipient domain allowlist, in-person signing device/session audit, legality/consent disclosure configuration per region.
- **Zoho Vault** — chamber-level MFA-to-unlock enforcement, secret rotation age, break-glass/emergency-access account audit.
- **Zoho Expense** — multi-currency policy enforcement, mileage/per-diem rate-limit compliance, duplicate-receipt detection coverage.
- **Zoho Recruit** — interview panel data-access scoping, assessment/test-result PII handling, third-party job-board data-sharing agreement tracking.

**Genuinely new products** (need their own `tests/<product>.js`, own scope grant, but same connector):
- **Cliq** — org-wide external guest access policy, message/file retention settings, integration/webhook allowlist audit.
- **Inventory** — warehouse user access scoping, API-per-day plan-limit monitoring, multi-currency/tax data integrity checks.
- **Payroll** — employee bank/PII field access restriction, statutory compliance report generation audit, payroll approval segregation of duties.
- **Contracts** — contract repository access scoping, clause-library edit permission audit, e-signature integration (Sign) linkage verification.
- **Meeting** — recording storage/retention policy, guest/external participant access controls, webinar registration data handling.
- **Forms** — public form PII field exposure (same class of check as Creator's), submission notification recipient audit, spam/CAPTCHA protection enabled.
- **Survey** — respondent anonymity/PII collection review, survey sharing/access scope, response data export access audit.
- **Campaigns** — recipient list consent/opt-in tracking, unsubscribe compliance, sender domain authentication (SPF/DKIM/DMARC).
- **SalesIQ** — visitor chat transcript retention and access scope, operator permission audit, embedded-widget domain allowlist.
- **Marketing Automation** — consent/opt-in tracking parity with Campaigns, lead-scoring data access scope, workflow data-export audit.
- **Flow** — third-party connection credential inventory and scope minimization per flow, flow execution log retention.
- **RPA** — bot credential storage/rotation audit, bot execution log retention, unattended-bot access scoping.
- **DataPrep** — dataset access scoping, PII/sensitive-column detection coverage, export destination audit.
- **Sprints** — team/board access scoping, integration credential audit (mirrors Projects' Tier 2 notes).

## 6. Seed SQL

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('zoho', 'Zoho', 'business_apps', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('zoho', 'zoho.directory.mfa_enforced', 'Multi-factor authentication is enforced org-wide', 'Checks the Directory org-wide security policy requires MFA for all users.', 'critical', 'Enable and enforce a multi-factor authentication policy under Zoho Directory > Security > Multi-factor Authentication, and remove any per-user exemptions.'),
  ('zoho', 'zoho.directory.sso_enforced', 'Single sign-on is enforced for all applications', 'Checks that SSO is configured as the required sign-in method rather than optional, so credentials aren''t scattered across individually-authenticated apps.', 'high', 'Set the org''s authentication policy to require SSO sign-in and disable direct password login where the identity provider supports it.'),
  ('zoho', 'zoho.directory.inactive_user_review', 'Inactive or terminated users are deprovisioned', 'Flags Directory user accounts with no sign-in activity for 90+ days that are still marked active.', 'medium', 'Suspend or delete the account in Zoho Directory, and confirm it is also removed from any per-product group/role assignments.'),

  ('zoho', 'zoho.crm.mfa_enforced', 'CRM users have multi-factor authentication enabled', 'Checks every active CRM user has MFA enabled (directly or via the org-wide security policy).', 'critical', 'Enforce MFA for the CRM application under Setup > Security Control > Two-Factor Authentication.'),
  ('zoho', 'zoho.crm.data_sharing_rules_restricted', 'Data sharing rules do not grant org-wide read/write', 'Checks CRM''s data-sharing settings for any module are not set to "Public Read/Write" or broader than required.', 'high', 'Tighten the module''s sharing rule under Setup > Data Sharing Settings to the narrowest role/territory grouping that meets the business need.'),
  ('zoho', 'zoho.crm.audit_log_enabled', 'Audit log tracking is enabled', 'Checks CRM''s audit log feature is turned on and retaining events.', 'medium', 'Enable Audit Log under Setup > Security Control > Audit Log.'),

  ('zoho', 'zoho.books.user_role_review', 'User roles follow least privilege', 'Checks no non-admin Books user is assigned the built-in Admin role without a documented business justification.', 'medium', 'Reassign the user to a custom role scoped to only the modules/permissions their job requires.'),
  ('zoho', 'zoho.books.two_factor_auth_enforced', 'Two-factor authentication is enforced', 'Checks the organization''s Books security policy requires 2FA for all users.', 'critical', 'Enable "Enforce two-factor authentication" under Settings > Users & Roles > Security.'),
  ('zoho', 'zoho.books.audit_trail_enabled', 'Audit trail is enabled and retained', 'Checks the Books audit trail feature is active and its retention meets the org''s evidence-retention policy.', 'medium', 'Enable Audit Trail under Settings > Preferences > Audit Trail and confirm retention duration.'),

  ('zoho', 'zoho.people.data_access_review', 'Employee data access is restricted by role', 'Checks People''s form/module permissions restrict full-employee-database visibility to HR-admin roles only.', 'high', 'Adjust form permissions under Settings > Access Permissions so only HR admin roles can view records outside their own reporting hierarchy.'),
  ('zoho', 'zoho.people.sensitive_field_encryption', 'Sensitive HR fields are access-restricted', 'Checks fields holding government ID numbers, bank details, and salary data are field-level restricted to authorized roles.', 'high', 'Apply field-level permission restrictions on sensitive fields under the form''s field settings.'),
  ('zoho', 'zoho.people.admin_role_review', 'Admin role assignment is minimized', 'Checks the count of users with full People admin privileges is limited to designated HR/IT administrators.', 'medium', 'Remove admin privileges from users who do not require org-wide People administration and reassign a scoped role instead.'),

  ('zoho', 'zoho.workdrive.external_sharing_restricted', 'External sharing is restricted at the team level', 'Checks the team/org sharing policy blocks or requires approval for sharing files/folders outside the organization.', 'critical', 'Disable open external sharing under Team Settings > Security, or require admin approval for external shares.'),
  ('zoho', 'zoho.workdrive.link_sharing_password_protected', 'Public share links require a password and expiry', 'Checks public/anyone-with-link shares have a password and an expiration date set rather than standing open indefinitely.', 'high', 'Edit the share link to require a password and set an expiration date, or disable public link sharing entirely for sensitive folders.'),
  ('zoho', 'zoho.workdrive.admin_activity_log_enabled', 'Admin activity logging is enabled', 'Checks WorkDrive''s admin audit log is enabled for the team.', 'medium', 'Enable activity logging under Admin Console > Audit.'),

  ('zoho', 'zoho.desk.agent_role_audit', 'Agent roles follow least privilege', 'Checks no agent is assigned an Administrator profile without documented justification.', 'medium', 'Reassign the agent to a Light Agent or custom profile scoped to only the permissions their job requires.'),
  ('zoho', 'zoho.desk.customer_data_field_restricted', 'Customer PII fields are profile-restricted', 'Checks fields containing customer PII (e.g. government ID, payment references) are restricted from profiles that don''t need them.', 'high', 'Apply field-level permissions restricting the field to profiles that require it for ticket resolution.'),
  ('zoho', 'zoho.desk.ticket_access_control_enabled', 'Ticket access control (team/department scoping) is enabled', 'Checks tickets are scoped to departments/teams rather than visible org-wide to every agent.', 'medium', 'Enable department-based ticket access control under Setup > Developer Space > Access Control.'),

  ('zoho', 'zoho.mail.forwarding_restricted', 'Auto-forwarding to external domains is restricted', 'Checks org mail policy blocks or requires admin approval for automatic forwarding rules that send mail to external domains.', 'high', 'Disable unrestricted auto-forwarding under Mail Admin Console > Policy Controls, or require admin approval for external forwarding rules.'),
  ('zoho', 'zoho.mail.two_factor_auth_enforced', 'Two-factor authentication is enforced for mailboxes', 'Checks the organization''s mail security policy requires 2FA for all mailbox logins.', 'critical', 'Enforce TFA under Mail Admin Console > Security > Two-Factor Authentication.'),
  ('zoho', 'zoho.mail.spam_phishing_filters_enabled', 'Spam and phishing filters are enabled', 'Checks organization-level spam/phishing filtering policies are active for all mailboxes.', 'medium', 'Enable and tune spam/phishing filter policies under Mail Admin Console > Security > Email Security.'),

  ('zoho', 'zoho.vault.secret_sharing_policy', 'Secret sharing outside designated chambers is restricted', 'Checks Vault''s sharing policy prevents individual secrets from being shared directly with users outside their assigned chamber/group.', 'high', 'Restrict secret sharing under Vault Admin Console > Policies to chamber/group-based sharing only.'),
  ('zoho', 'zoho.vault.password_policy_strength', 'Vault-generated/stored passwords meet minimum strength policy', 'Checks the organization''s password policy (used by Vault''s generator and strength scoring) enforces a minimum length and complexity.', 'high', 'Configure the password policy under Vault Admin Console > Password Policy to require 14+ characters with mixed character classes.'),
  ('zoho', 'zoho.vault.access_log_review', 'Vault access logs are enabled and retained', 'Checks Vault''s audit/access log is enabled and retention meets the org''s evidence policy.', 'medium', 'Enable audit logging under Vault Admin Console > Reports > Audit Trail.'),

  ('zoho', 'zoho.projects.external_user_review', 'External/client users have scoped project access', 'Checks client/external users are only added to the specific projects they need rather than the whole portal.', 'medium', 'Remove the external user from projects outside their engagement and confirm client-user role restricts admin functions.'),
  ('zoho', 'zoho.projects.client_portal_access_restricted', 'Client portal access is restricted to intended projects', 'Checks the client portal''s visibility settings don''t expose other clients'' projects or tasks.', 'medium', 'Restrict the client portal''s project visibility under Project Settings > Client Users.'),
  ('zoho', 'zoho.projects.role_based_permissions_enforced', 'Role-based permissions are enforced per project', 'Checks project roles (Manager/Employee/Client) are used to gate task, budget, and document permissions rather than granting everyone Manager.', 'medium', 'Reassign users with unnecessary Manager-level project roles to Employee or a scoped custom role.'),

  ('zoho', 'zoho.analytics.data_sharing_review', 'Workspace/view sharing is scoped to intended users', 'Checks workspaces and views are not shared with "Everyone in the organization" or broader than the reporting requirement.', 'high', 'Edit the workspace/view''s sharing settings to specific users or groups instead of organization-wide sharing.'),
  ('zoho', 'zoho.analytics.public_view_link_restricted', 'Public/embedded view links are disabled or reviewed', 'Checks published public view/embed links (which require no authentication) are disabled, or if in use, contain no sensitive data.', 'critical', 'Disable public publishing for the view, or remove sensitive columns/rows from the underlying query before re-publishing.'),
  ('zoho', 'zoho.analytics.workspace_permission_review', 'Workspace admin/owner assignment is minimized', 'Checks the number of users with workspace Admin/Owner permission is limited to designated report administrators.', 'medium', 'Downgrade unnecessary Admin/Owner permissions to Designer or Viewer as appropriate.'),

  ('zoho', 'zoho.creator.app_permission_review', 'App-level permissions follow least privilege', 'Checks custom applications restrict Admin/Developer permission to the users who build/maintain the app.', 'medium', 'Adjust the app''s user permissions under App Settings > Users & Permissions to remove unnecessary Developer/Admin access.'),
  ('zoho', 'zoho.creator.public_form_data_exposure', 'Public forms do not expose sensitive existing records', 'Checks public-facing forms/pages don''t embed reports or lookups that leak other users'' submitted data to anonymous visitors.', 'critical', 'Remove the exposed report/lookup field from the public form, or move it behind an authenticated (employee/portal) form instead.'),
  ('zoho', 'zoho.creator.deluge_script_access_review', 'Custom (Deluge) script edit access is restricted', 'Checks only designated developers can edit an application''s workflow/Deluge scripts, since scripts can read or exfiltrate any data the app touches.', 'medium', 'Restrict script edit permission under App Settings > Users & Permissions to the app''s designated developer role.'),

  ('zoho', 'zoho.sign.audit_trail_enabled', 'Document audit trail is enabled', 'Checks every completed document retains its full signing audit trail (timestamps, IP, authentication method per signer).', 'high', 'Enable "Include Audit Trail" in the organization''s default document settings under Sign Settings > Preferences.'),
  ('zoho', 'zoho.sign.template_access_restricted', 'Template access is restricted to authorized users', 'Checks shared templates are limited to the users/groups who need to send from them, not the whole organization.', 'medium', 'Edit template sharing under Templates > Manage Access to remove unnecessary users/groups.'),
  ('zoho', 'zoho.sign.completed_document_retention', 'Completed document retention meets policy', 'Checks completed/signed documents are retained for at least the organization''s required evidence retention period before any auto-deletion.', 'medium', 'Adjust the document retention/auto-delete setting under Sign Settings to meet the required retention period.'),

  ('zoho', 'zoho.expense.approval_policy_enforced', 'Expense approval requires a separate approver', 'Checks the approval workflow requires an approver other than the report submitter (no self-approval).', 'medium', 'Configure the approval workflow under Settings > Approvals to require a manager/finance approver distinct from the submitter.'),
  ('zoho', 'zoho.expense.receipt_data_retention', 'Receipt/expense data retention meets policy', 'Checks expense records and attached receipts are retained for at least the organization''s required financial/evidence retention period.', 'medium', 'Adjust the data retention setting under Settings > Preferences to meet the required retention period.'),
  ('zoho', 'zoho.expense.card_data_masking', 'Corporate card numbers are masked', 'Checks corporate card feed data displays only masked/last-4 card numbers, not full PANs, in reports and exports.', 'high', 'Confirm the card feed integration is configured to store/display masked card numbers only, per the provider''s masking option.'),

  ('zoho', 'zoho.recruit.candidate_data_access_review', 'Candidate data access is restricted by role', 'Checks candidate records (including resumes and contact PII) are visible only to recruiters/hiring managers assigned to that requisition, not all users.', 'high', 'Adjust the module''s sharing rules under Setup > Data Sharing Settings so candidate visibility follows requisition assignment.'),
  ('zoho', 'zoho.recruit.data_retention_policy_configured', 'Candidate data retention/deletion policy is configured', 'Checks a candidate data retention (and right-to-erasure) policy is configured, since unsuccessful-candidate PII has a legal retention ceiling under most privacy regimes.', 'medium', 'Configure a data retention policy under Setup > Data Administration > Data Retention Policy specifying an auto-purge or review window.'),
  ('zoho', 'zoho.recruit.job_posting_visibility_review', 'Job posting visibility matches intended audience', 'Checks job postings marked internal-only are not also published to public/external career-site channels.', 'low', 'Edit the job opening''s posting visibility under the Job Opening record to remove unintended public channels.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('zoho.directory.mfa_enforced', 'A.9.4.2'),
  ('zoho.directory.sso_enforced', 'A.9.2.1'),
  ('zoho.directory.inactive_user_review', 'A.9.2.6'),
  ('zoho.crm.mfa_enforced', 'A.9.4.2'),
  ('zoho.crm.data_sharing_rules_restricted', 'A.13.1.1'),
  ('zoho.crm.audit_log_enabled', 'A.12.4.1'),
  ('zoho.books.user_role_review', 'A.9.2.2'),
  ('zoho.books.two_factor_auth_enforced', 'A.9.4.2'),
  ('zoho.books.audit_trail_enabled', 'A.12.4.1'),
  ('zoho.people.data_access_review', 'A.9.1.1'),
  ('zoho.people.sensitive_field_encryption', 'A.8.2.3'),
  ('zoho.people.admin_role_review', 'A.9.2.3'),
  ('zoho.workdrive.external_sharing_restricted', 'A.13.2.1'),
  ('zoho.workdrive.link_sharing_password_protected', 'A.9.4.1'),
  ('zoho.workdrive.admin_activity_log_enabled', 'A.12.4.1'),
  ('zoho.desk.agent_role_audit', 'A.9.2.3'),
  ('zoho.desk.customer_data_field_restricted', 'A.9.4.1'),
  ('zoho.desk.ticket_access_control_enabled', 'A.9.1.2'),
  ('zoho.mail.forwarding_restricted', 'A.13.2.3'),
  ('zoho.mail.two_factor_auth_enforced', 'A.9.4.2'),
  ('zoho.mail.spam_phishing_filters_enabled', 'A.12.2.1'),
  ('zoho.vault.secret_sharing_policy', 'A.9.4.1'),
  ('zoho.vault.password_policy_strength', 'A.9.4.3'),
  ('zoho.vault.access_log_review', 'A.12.4.1'),
  ('zoho.projects.external_user_review', 'A.9.1.1'),
  ('zoho.projects.client_portal_access_restricted', 'A.9.4.1'),
  ('zoho.projects.role_based_permissions_enforced', 'A.9.2.3'),
  ('zoho.analytics.data_sharing_review', 'A.13.2.1'),
  ('zoho.analytics.public_view_link_restricted', 'A.9.4.1'),
  ('zoho.analytics.workspace_permission_review', 'A.9.2.3'),
  ('zoho.creator.app_permission_review', 'A.9.2.3'),
  ('zoho.creator.public_form_data_exposure', 'A.13.2.1'),
  ('zoho.creator.deluge_script_access_review', 'A.14.2.5'),
  ('zoho.sign.audit_trail_enabled', 'A.12.4.1'),
  ('zoho.sign.template_access_restricted', 'A.9.4.1'),
  ('zoho.sign.completed_document_retention', 'A.18.1.3'),
  ('zoho.expense.approval_policy_enforced', 'A.6.1.2'),
  ('zoho.expense.receipt_data_retention', 'A.18.1.3'),
  ('zoho.expense.card_data_masking', 'A.8.2.3'),
  ('zoho.recruit.candidate_data_access_review', 'A.9.1.1'),
  ('zoho.recruit.data_retention_policy_configured', 'A.18.1.3'),
  ('zoho.recruit.job_posting_visibility_review', 'A.13.2.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

## 7. Implementation notes

Follow the existing connector shape (`api/src/connectors/azure/index.js` is the closest structural match: OAuth2, one shared credential resolver, per-domain SDK/API clients assembled in `buildClients()`, `describe*Error()` for surfacing provider-specific error detail).

- `api/src/connectors/zoho/credentials.js` — `resolveZohoCredentials({ authType, config, secret })`: validates `config.dataCenter`, exchanges `secret.refreshToken` for a fresh access token via `POST https://accounts.zoho.{dataCenter}/oauth/v2/token` (cache the access token in-memory for the run's duration — it's valid ~1 hour, comfortably longer than one collection run), and returns a small authenticated fetch helper (base URL resolution per product + the `Zoho-oauthtoken` auth header) rather than a per-product SDK, since Zoho doesn't ship a unified Node SDK across products the way Azure's `@azure/arm-*` packages do.
- `api/src/connectors/zoho/index.js` — `export const key = "zoho"`; `tests = [...directoryTests, ...crmTests, ...booksTests, ...peopleTests, ...workdriveTests, ...deskTests, ...mailTests, ...vaultTests, ...projectsTests, ...analyticsTests, ...creatorTests, ...signTests, ...expenseTests, ...recruitTests]`; `testConnection()` should hit the cheapest possible authenticated call per grant — e.g. CRM's `GET /crm/v6/org` or Directory's org-info endpoint — and return `{ ok: true, externalAccountId: config.orgId }`; `runTests()` mirrors the azure/github pattern but should run each product's tests in its own try/catch so one product's scope gap or rate-limit hit (see 3.3) doesn't abort tests for the other 13 products in the same run.
- `api/src/connectors/zoho/tests/directory.js`, `crm.js`, `books.js`, `people.js`, `workdrive.js`, `desk.js`, `mail.js`, `vault.js`, `projects.js`, `analytics.js`, `creator.js`, `sign.js`, `expense.js`, `recruit.js` — one file per Tier 1 product, each exporting an array of check objects (`{ key, title, severityDefault, isoReferences, run(clients) }`) matching the pattern in `api/src/connectors/azure/tests/*.js`.
- `api/src/connectors/registry.js` — add `import * as zoho from "./zoho/index.js";` and include `[zoho.key]: zoho` in the `connectors` map, same as the existing four entries.
- Since `integrations.auth_type` is `CHECK`-constrained to `('iam_role', 'access_key', 'oauth2', 'api_key')`, `zoho` uses `'oauth2'` — no schema change needed.
