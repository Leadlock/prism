import { Router } from "express";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { query, mapRow, mapRows } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sanitiseFields } from "../utils/sanitise.js";
import { storeCredential, revokeCredentials, getActiveCredential } from "../db/integrationCredentials.js";
import { getConnector } from "../connectors/registry.js";
import { runCollection } from "../utils/collectionRunner.js";
import { signGithubAppState, verifyGithubAppState } from "../utils/githubAppState.js";

const router = Router();

// The exact read-only permissions the AWS connector's checks call —
// kept in lockstep with connectors/aws/tests/*.js so the policy handed to
// customers never grants more (or less) than the code uses.
const AWS_READ_ONLY_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PrismReadOnlyEvidenceCollection",
      Effect: "Allow",
      Action: [
        // IAM
        "iam:ListUsers",
        "iam:ListMFADevices",
        "iam:ListAccessKeys",
        "iam:GetAccountPasswordPolicy",
        "iam:GenerateCredentialReport",
        "iam:GetCredentialReport",
        "iam:ListGroups",
        "iam:ListGroupPolicies",
        "iam:ListUserPolicies",
        "iam:ListAttachedUserPolicies",
        "iam:ListAttachedGroupPolicies",
        // CloudTrail
        "cloudtrail:DescribeTrails",
        "cloudtrail:GetTrailStatus",
        "cloudtrail:GetEventSelectors",
        // AWS Config
        "config:DescribeConfigurationRecorders",
        "config:DescribeConfigurationRecorderStatus",
        "config:DescribeConfigRules",
        "config:DescribeComplianceByConfigRule",
        "config:GetComplianceDetailsByConfigRule",
        // S3
        "s3:ListAllMyBuckets",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketLogging",
        // EC2 / VPC
        "ec2:DescribeSecurityGroups",
        "ec2:GetEbsEncryptionByDefault",
        "ec2:DescribeVpcs",
        "ec2:DescribeFlowLogs",
        // RDS
        "rds:DescribeDBInstances",
        // Lambda
        "lambda:ListFunctions",
        "lambda:GetFunctionUrlConfig",
        "lambda:GetPolicy",
        "lambda:GetFunction",
        // DynamoDB
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        // KMS
        "kms:ListKeys",
        "kms:DescribeKey",
        "kms:GetKeyRotationStatus",
        "kms:GetKeyPolicy",
        // CloudWatch / CloudWatch Logs
        "cloudwatch:DescribeAlarms",
        "logs:DescribeLogGroups",
        // WAFv2
        "wafv2:ListWebACLs",
        "wafv2:GetWebACL",
        "wafv2:ListResourcesForWebACL",
        "wafv2:GetLoggingConfiguration",
        // Secrets Manager
        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret",
        // GuardDuty
        "guardduty:ListDetectors",
        "guardduty:GetDetector",
        "guardduty:ListFindings",
        "guardduty:GetFindings",
        // Security Hub
        "securityhub:DescribeHub",
        "securityhub:GetEnabledStandards",
        "securityhub:GetFindings",
        // ECR
        "ecr:DescribeRepositories",
        "ecr:GetRepositoryPolicy",
        "ecr:DescribeImageScanFindings",
        // ECS
        "ecs:ListClusters",
        "ecs:DescribeClusters",
        "ecs:ListTaskDefinitions",
        "ecs:DescribeTaskDefinition",
      ],
      Resource: "*",
    },
  ],
};

// Shaped for the Azure Portal's "Create a custom role" > Start from JSON flow
// (and the ARM REST API directly) — NOT the Azure CLI/PowerShell shape, which
// uses top-level PascalCase Name/Actions/AssignableScopes instead of a nested
// "properties" object. Pasting the CLI shape into the Portal's JSON editor
// fails with "Properties not found", since the Portal is how most customers
// actually create the role.
const AZURE_READ_ONLY_ROLE_DEFINITION = {
  properties: {
    roleName: "Prism Read-Only Evidence Collection",
    description: "Least-privilege read access for Prism's automated ISO 27001 evidence collection.",
    assignableScopes: ["/subscriptions/<subscription-id>"],
    permissions: [
      {
        actions: [
          "Microsoft.Storage/storageAccounts/read",
          "Microsoft.Network/networkSecurityGroups/read",
          "Microsoft.Insights/diagnosticSettings/read",
          "Microsoft.Security/pricings/read",
          "Microsoft.Resources/subscriptions/resourceGroups/read",
        ],
        notActions: [],
        dataActions: [],
        notDataActions: [],
      },
    ],
  },
};

// Kept in lockstep with exactly what connectors/purview's checks actually call
// (tests/datamap.js needs Data Reader for entity/classification/search reads
// and Data Source Administrator for /datasources scan-history reads; tests/audit.js
// needs the three Office 365 Management API application permissions below).
// Both Purview roles are assigned in the Purview governance portal's collection
// Role assignments tab — this is a DIFFERENT system from Azure IAM/RBAC, the most
// common point of confusion for customers who already set up the Azure connector.
const PURVIEW_REQUIRED_PERMISSIONS = {
  purviewRbacRoles: [
    {
      roleName: "Data Reader",
      scope: "Root collection (recommended) or a narrower collection — API calls are scoped to whatever collection the role is assigned on",
      note: "Grants read access to catalog entities, classifications, and search — used by the Data Map classification/sensitivity-label checks.",
    },
    {
      roleName: "Data Source Administrator",
      scope: "Root collection (recommended) or a narrower collection",
      note: "Grants read access to registered data sources and scan run history — used by the scan-recency and scan-schedule checks.",
    },
  ],
  office365ManagementApiPermissions: {
    type: "Application permissions (not Delegated) — require tenant admin consent",
    permissions: ["ActivityFeed.Read", "ActivityFeed.ReadDlp", "ServiceHealth.Read"],
    note: "Granted under the app registration's API permissions > Office 365 Management APIs, then 'Grant admin consent'. Requires a Global Administrator or Privileged Role Administrator to consent.",
  },
  prerequisites: [
    "Unified audit logging must be turned on in Microsoft Purview > Audit before the audit subscriptions will return data (Purview portal > Audit > 'Start recording user and admin activity'; can take up to 60 minutes to take effect).",
  ],
};

// Kept in lockstep with exactly what connectors/github/index.js's testConnection
// and connectors/github/tests/{access,security}.js's checks actually call, same
// "policy in code = policy in docs" discipline as AWS_READ_ONLY_POLICY /
// AZURE_READ_ONLY_ROLE_DEFINITION. No webhook events are consumed in Phase 1,
// so hook_attributes.active is explicitly false rather than standing up a
// receiver Prism doesn't use yet.
function buildGithubAppManifest({ companyName }) {
  const baseUrl = process.env.API_URL || "http://localhost:4000";
  return {
    name: `Prism Evidence Collection - ${companyName}`.slice(0, 34),
    url: baseUrl,
    redirect_url: `${baseUrl}/api/integrations/github/manifest-callback`,
    setup_url: `${baseUrl}/api/integrations/github/install-callback`,
    hook_attributes: { url: baseUrl, active: false },
    public: false,
    default_permissions: {
      organization_administration: "read",
      administration: "read",
      metadata: "read",
    },
  };
}

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM integration_connections WHERE company_id = $1 AND status != 'revoked' ORDER BY created_at DESC`,
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.get("/catalog", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(`SELECT * FROM integrations WHERE status != 'coming_soon' ORDER BY name`);
  res.json(mapRows(result));
}));

// GET /api/integrations/aws/setup-info — the exact trust-policy principal Prism's
// own backend runs as (via STS), plus the least-privilege permissions policy the
// connector needs, so a customer's IAM role works on the first try.
router.get("/aws/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  let principalArn = null;
  let principalError = null;
  try {
    const sts = new STSClient({ region: process.env.AWS_REGION || "us-east-1" });
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    principalArn = identity.Arn;
  } catch (err) {
    console.error("aws/setup-info: failed to resolve Prism's AWS principal ARN:", err.message);
    principalError = "This Prism deployment has no AWS credentials configured, so the trust policy's principal can't be resolved automatically. Ask your Prism administrator for the AWS principal ARN Prism runs as, or connect using static access keys instead.";
  }
  res.json({ principalArn, principalError, permissionsPolicy: AWS_READ_ONLY_POLICY });
}));

router.get("/azure/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ roleDefinition: AZURE_READ_ONLY_ROLE_DEFINITION });
}));

router.get("/purview/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: PURVIEW_REQUIRED_PERMISSIONS });
}));

// ── Microsoft connector setup-info ──────────────────────────────────────────
// All four Microsoft connectors share the same tenantId + clientId + clientSecret
// credential shape. Each setup-info endpoint returns the connector-specific list
// of API permissions the customer must grant, plus any connector-specific notes
// (extra consent steps, Entra role assignments, TCM enrollment, etc.).
// Kept in code next to the routes so any permission change is a visible diff.

const ENTRA_ID_PERMISSIONS = {
  graphPermissions: [
    { permission: "User.Read.All", note: "Read guest accounts and sign-in activity for staleness checks." },
    { permission: "RoleManagement.Read.Directory", note: "Read directory role assignments — narrower than Directory.Read.All." },
    { permission: "Policy.Read.All", note: "Read Conditional Access policies and authentication methods policy." },
    { permission: "Policy.Read.AuthenticationMethod", note: "Read the tenant-level authentication methods policy (SMS/voice/FIDO2 enablement)." },
    { permission: "Application.Read.All", note: "Read app registrations, service principals, and their permission grants and credential expiry." },
    { permission: "AuditLog.Read.All", note: "Read sign-in and directory audit logs, and user.signInActivity for staleness data." },
  ],
  consentNote: "All permissions are Microsoft Graph Application permissions — select Grant admin consent after adding them.",
  sharedAppNote: "If you already set up an app registration for another Prism Microsoft connector (M365, Teams, Defender), add these permissions to that same app registration instead of creating a new one.",
};

const M365_PERMISSIONS = {
  graphPermissions: [
    { permission: "SharePointTenantSettings.Read.All", note: "Tenant-level SharePoint/OneDrive external sharing settings." },
    { permission: "DeviceManagementManagedDevices.Read.All", note: "Intune managed device compliance state." },
    { permission: "DeviceManagementConfiguration.Read.All", note: "Intune device compliance policies and their platform assignments." },
  ],
  exchangePermission: {
    resource: "Office 365 Exchange Online",
    permission: "Exchange.ManageAsApp",
    note: "Find this under API permissions → Add a permission → APIs my organization uses → search 'Office 365 Exchange Online'. This resource does not appear in the default list.",
  },
  entraRoleAssignment: {
    role: "Global Reader",
    note: "Exchange Online's own RBAC also gates what a token can read — holding Exchange.ManageAsApp alone is not sufficient. In Entra ID → Roles and administrators → Global Reader → Add assignments, add the app's service principal.",
  },
  consentNote: "Grant admin consent separately for each resource (Microsoft Graph and Office 365 Exchange Online — they appear as separate rows in the Permissions page).",
  sharedAppNote: "If you already set up an app registration for another Prism Microsoft connector, add these permissions to that same app registration.",
};

const TEAMS_PERMISSIONS = {
  graphPermissions: [
    { permission: "TeamSettings.Read.All", note: "Per-team settings via GET /teams/{id}." },
    { permission: "TeamMember.Read.All", note: "Team membership including guest members." },
    { permission: "TeamsAppInstallation.Read.All", note: "Installed Teams apps per team/chat/user scope." },
    { permission: "Organization.Read.All", note: "Required for all Tenant Configuration Management (TCM) policy reads — federation config, client config, meeting/messaging/app policies. NOT Policy.Read.All." },
  ],
  tcmNote: "After granting admin consent, the tenant's TCM service principal must also be enrolled (one-time setup). See Microsoft's 'Set up authentication for Tenant Configuration Management APIs' doc. This is separate from admin consent and required before Organization.Read.All unlocks policy reads.",
  consentNote: "All permissions are Microsoft Graph Application permissions — select Grant admin consent after adding them.",
  sharedAppNote: "If you already set up an app registration for another Prism Microsoft connector, add these permissions to that same app registration.",
};

const DEFENDER_PERMISSIONS = {
  windowsDefenderATPPermissions: [
    { permission: "Machine.Read.All", note: "Device/machine inventory — GET /api/machines." },
    { permission: "Vulnerability.Read.All", note: "Discovered vulnerabilities per device." },
    { permission: "SecurityRecommendation.Read.All", note: "Security recommendations — GET /api/recommendations." },
    { permission: "Alert.Read.All", note: "Alerts — GET /api/alerts. If this is rejected in practice, fall back to Alert.ReadWrite.All (a documented Microsoft permission inconsistency)." },
  ],
  resourceNote: "Add these under API permissions → Add a permission → APIs my organization uses → search 'WindowsDefenderATP'. This is the internal name for the Defender for Endpoint API — it does not appear in the default Microsoft APIs tab.",
  consentNote: "Grant admin consent for WindowsDefenderATP separately from Microsoft Graph — they are different API resources and each requires its own consent grant.",
  tokenAudienceNote: "Defender for Endpoint tokens must be requested for resource https://api.securitycenter.microsoft.com even though API calls go to https://api.security.microsoft.com — these are two different strings. Prism handles this automatically; it is noted here only if you are troubleshooting 403 errors.",
  sharedAppNote: "If you already set up an app registration for another Prism Microsoft connector, add these WindowsDefenderATP permissions to that same app registration.",
};

router.get("/entra_id/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: ENTRA_ID_PERMISSIONS });
}));

router.get("/microsoft_365/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: M365_PERMISSIONS });
}));

router.get("/microsoft_teams/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: TEAMS_PERMISSIONS });
}));

router.get("/microsoft_defender/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: DEFENDER_PERMISSIONS });
}));

// Data-center domain table for the Zoho wizard UI dropdown, and per-product
// OAuth2 scope lists for the scope checklist. Kept in code (not DB) because
// they're tightly coupled to what the connector actually calls — any new product
// added to the connector should add its scopes here at the same time.
const ZOHO_DATA_CENTERS = [
  { label: "United States (zoho.com)", value: "com" },
  { label: "Europe (zoho.eu)", value: "eu" },
  { label: "India (zoho.in)", value: "in" },
  { label: "Australia (zoho.com.au)", value: "com.au" },
  { label: "China (zoho.com.cn)", value: "com.cn" },
  { label: "Japan (zoho.jp)", value: "jp" },
  { label: "Canada (zohocloud.ca)", value: "cloud.ca" },
];

const ZOHO_PRODUCTS = [
  { key: "directory", label: "Zoho Directory", scopes: ["ZohoDirectory.org.READ", "ZohoDirectory.users.READ"] },
  { key: "crm", label: "Zoho CRM", scopes: ["ZohoCRM.users.READ", "ZohoCRM.settings.READ"] },
  { key: "books", label: "Zoho Books", scopes: ["ZohoBooks.settings.READ", "ZohoBooks.contacts.READ"] },
  { key: "people", label: "Zoho People", scopes: ["ZohoPeople.forms.READ", "ZohoPeople.roles.READ"] },
  { key: "workdrive", label: "Zoho WorkDrive", scopes: ["WorkDrive.team.READ", "WorkDrive.organization.READ"] },
  { key: "desk", label: "Zoho Desk", scopes: ["Desk.agents.READ", "Desk.tickets.READ", "Desk.settings.READ"] },
  { key: "mail", label: "Zoho Mail", scopes: ["ZohoMail.organization.READ", "ZohoMail.settings.READ"] },
  { key: "vault", label: "Zoho Vault", scopes: ["ZohoVault.secrets.READ", "ZohoVault.settings.READ"] },
  { key: "projects", label: "Zoho Projects", scopes: ["ZohoProjects.portals.READ", "ZohoProjects.projects.READ", "ZohoProjects.users.READ"] },
  { key: "analytics", label: "Zoho Analytics", scopes: ["ZohoAnalytics.data.READ", "ZohoAnalytics.metadata.READ"] },
  { key: "creator", label: "Zoho Creator", scopes: ["ZohoCreator.meta.READ", "ZohoCreator.data.READ"] },
  { key: "sign", label: "Zoho Sign", scopes: ["ZohoSign.documents.READ", "ZohoSign.templates.READ"] },
  { key: "expense", label: "Zoho Expense", scopes: ["ZohoExpense.settings.READ", "ZohoExpense.reports.READ"] },
  { key: "recruit", label: "Zoho Recruit", scopes: ["ZohoRecruit.settings.READ", "ZohoRecruit.modules.READ"] },
];

router.get("/zoho/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ dataCenters: ZOHO_DATA_CENTERS, products: ZOHO_PRODUCTS });
}));

// Kept in lockstep with connectors/google_workspace/credentials.js's SCOPES
// array (not imported from it, matching this file's existing convention of
// duplicating connector permission lists in code — see AZURE_READ_ONLY_ROLE_DEFINITION
// above) — any scope added to one must be added to the other, or domain-wide
// delegation authorization in the customer's Admin Console won't match what
// the connector actually requests at token-mint time.
const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.security",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.mobile.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/chrome.management.policy.readonly",
  "https://www.googleapis.com/auth/cloud-identity.policies.readonly",
];

router.get("/google_workspace/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ scopes: GOOGLE_WORKSPACE_SCOPES });
}));

// GCP's service account authenticates directly (no domain-wide delegation/
// impersonation, unlike google_workspace) and is authorized via ordinary
// Cloud IAM role bindings on the project — Viewer covers most reads (incl.
// resourcemanager.projects.getIamPolicy), but IAM-specific reads like
// iam.serviceAccountKeys.list are deliberately excluded from Viewer, hence
// the second role. Kept in code next to the route, same convention as
// AZURE_READ_ONLY_ROLE_DEFINITION above.
const GCP_RECOMMENDED_ROLES = [
  { role: "roles/viewer", note: "Broad read access across Compute Engine, Cloud SQL, Cloud Storage, Cloud KMS, and Resource Manager." },
  { role: "roles/iam.securityReviewer", note: "Read access to service account keys and IAM policies — not included in the basic Viewer role." },
];

router.get("/gcp/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ roles: GCP_RECOMMENDED_ROLES });
}));

router.get("/:id/github/setup-info", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  const state = signGithubAppState({ connectionId, companyId: req.user.companyId });
  const manifest = buildGithubAppManifest({ companyName: req.user.company?.name || "Prism" });
  res.json({ manifest, state });
}));

// Hit directly by the customer's browser via GitHub's redirect after they
// create the App from the manifest — there is no Prism session at this
// point, so authorization is entirely the signed `state` token, verified
// before any database access.
router.get("/github/manifest-callback", asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  const webUrl = (process.env.WEB_URL || "https://prism.askthechamp.com").replace(/\/$/, "");

  let stateData;
  try {
    stateData = verifyGithubAppState(state);
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent(err.message)}`);
  }
  const { connectionId, companyId } = stateData;

  const connResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, companyId]
  );
  if (!mapRow(connResult)) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent("Connection not found")}`);
  }

  let appData;
  try {
    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status} exchanging the manifest code`);
    appData = await response.json();
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await revokeCredentials(connectionId, companyId);
  await storeCredential({
    connectionId, companyId, authType: "oauth2",
    secret: { appId: String(appData.id), privateKey: appData.pem },
  });
  // No authenticated user exists on a GitHub-initiated redirect — userId: null
  // is a legitimate value here, same as other automated, non-user-attributed
  // audit events already written by this codebase (e.g. evidence auto-collection).
  await writeAuditLog({ userId: null, companyId, action: "CREDENTIAL_STORED", resource: "integration_credentials", detail: { connectionId, authType: "oauth2", via: "github_manifest_flow" } });

  // `slug`/`html_url` are part of GitHub's App resource shape by convention
  // (not independently confirmed via context7 in this planning pass, see the
  // plan header's Spec section) — fall back to constructing the install URL
  // from `slug` alone if `html_url` is ever absent.
  // Re-sign a fresh state token rather than reusing the one verified above —
  // its 15-minute clock started at setup-info time and has to survive reading
  // setup-info, creating the App on github.com, this manifest-conversion
  // redirect, AND the admin clicking through to install. Re-minting here gives
  // the install leg its own full window instead of inheriting whatever's left.
  const installState = signGithubAppState({ connectionId, companyId });
  const installUrl = appData.html_url ? `${appData.html_url}/installations/new` : `https://github.com/apps/${appData.slug}/installations/new`;
  res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubInstallUrl=${encodeURIComponent(`${installUrl}?state=${installState}`)}`);
}));

// Also unauthenticated, for the same reason as manifest-callback above —
// this is GitHub's own redirect after the admin installs the App, carrying
// only `installation_id`. That alone doesn't tell us the org login the
// connector's testConnection/runTests need, so this route resolves it via
// an App-level (JWT, not installation-token) lookup first.
router.get("/github/install-callback", asyncHandler(async (req, res) => {
  const installationId = parseInt(req.query.installation_id);
  const { state } = req.query;
  const webUrl = (process.env.WEB_URL || "https://prism.askthechamp.com").replace(/\/$/, "");

  let stateData;
  try {
    stateData = verifyGithubAppState(state);
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent(err.message)}`);
  }
  const { connectionId, companyId } = stateData;

  const connResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, companyId]
  );
  if (!mapRow(connResult)) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent("Connection not found")}`);
  }

  const credential = await getActiveCredential(connectionId, companyId);
  if (!credential) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent("Create the GitHub App before installing it")}`);
  }

  let org;
  try {
    const appAuth = createAppAuth({ appId: credential.secret.appId, privateKey: credential.secret.privateKey });
    const { token: appJwt } = await appAuth({ type: "app" });
    const appOctokit = new Octokit({ auth: appJwt });
    const { data: installation } = await appOctokit.rest.apps.getInstallation({ installation_id: installationId });
    org = installation.account.login;
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await query(
    `UPDATE integration_connections SET config = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
    [JSON.stringify({ installationId, org }), connectionId, companyId]
  );

  const connector = getConnector("github");
  try {
    const testResult = await connector.testConnection({ authType: "oauth2", config: { installationId, org }, secret: credential.secret });
    await query(
      `UPDATE integration_connections SET status = 'connected', external_account_id = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [testResult.externalAccountId || null, connectionId, companyId]
    );
  } catch (err) {
    await query(`UPDATE integration_connections SET status = 'error', updated_at = NOW() WHERE id = $1 AND company_id = $2`, [connectionId, companyId]);
    await writeAuditLog({ userId: null, companyId, action: "CONNECTION_TEST_FAILED", resource: "integration_connections", detail: { connectionId, error: err.message } });
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await writeAuditLog({ userId: null, companyId, action: "CONNECTION_INSTALLED", resource: "integration_connections", detail: { connectionId, installationId, org } });
  res.redirect(`${webUrl}/settings/integrations/${connectionId}`);
}));

router.get("/:id", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT ic.*, cred.auth_type
     FROM integration_connections ic
     LEFT JOIN LATERAL (
       SELECT auth_type FROM integration_credentials
       WHERE connection_id = ic.id AND company_id = ic.company_id AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1
     ) cred ON true
     WHERE ic.id = $1 AND ic.company_id = $2`,
    [parseInt(req.params.id), req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });
  res.json(connection);
}));

router.get("/:id/runs", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const connResult = await query(
    `SELECT id FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  if (connResult.rows.length === 0) return res.status(404).json({ error: "Connection not found" });

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const result = await query(
    `SELECT * FROM evidence_collection_runs WHERE connection_id = $1 AND company_id = $2 ORDER BY started_at DESC LIMIT $3`,
    [connectionId, req.user.companyId, limit]
  );
  res.json(mapRows(result));
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { integrationKey, name, config } = sanitiseFields(req.body, { name: "text" });
  if (!integrationKey || !name) {
    return res.status(400).json({ error: "integrationKey and name are required" });
  }
  const result = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name, config, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.companyId, integrationKey, name, JSON.stringify(config || {}), req.user.userId]
  );
  const connection = mapRow(result);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_CREATED", resource: "integration_connections", detail: { connectionId: connection.id, integrationKey } });
  res.status(201).json(connection);
}));

router.post("/:id/credentials", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  const { authType, secret } = req.body;
  if (!authType || !secret) {
    return res.status(400).json({ error: "authType and secret are required" });
  }

  await revokeCredentials(connectionId, req.user.companyId);
  await storeCredential({ connectionId, companyId: req.user.companyId, authType, secret });

  const connector = getConnector(connection.integrationKey);
  try {
    const testResult = await connector.testConnection({ authType, config: connection.config, secret });
    await query(
      `UPDATE integration_connections SET status = 'connected', external_account_id = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [testResult.externalAccountId || null, connectionId, req.user.companyId]
    );
  } catch (err) {
    await query(`UPDATE integration_connections SET status = 'error', updated_at = NOW() WHERE id = $1 AND company_id = $2`, [connectionId, req.user.companyId]);
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_TEST_FAILED", resource: "integration_connections", detail: { connectionId, error: err.message } });
    return res.status(400).json({ error: `Connection test failed: ${err.message}` });
  }

  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CREDENTIAL_STORED", resource: "integration_credentials", detail: { connectionId, authType } });

  const updated = await query(`SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`, [connectionId, req.user.companyId]);
  res.json(mapRow(updated));
}));

router.post("/:id/run", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  try {
    const run = await runCollection({ connectionId, companyId: req.user.companyId, triggeredBy: req.user.userId, triggerType: "manual" });
    res.json(run);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
}));

router.patch("/:id/schedule", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const { collectionFrequencyHours, autoCollectEnabled } = req.body;

  if (!Number.isInteger(collectionFrequencyHours) || collectionFrequencyHours <= 0) {
    return res.status(400).json({ error: "collectionFrequencyHours must be a positive integer" });
  }
  if (typeof autoCollectEnabled !== "boolean") {
    return res.status(400).json({ error: "autoCollectEnabled must be a boolean" });
  }

  const result = await query(
    `UPDATE integration_connections
     SET collection_frequency_hours = $1, auto_collect_enabled = $2, updated_at = NOW()
     WHERE id = $3 AND company_id = $4
     RETURNING *`,
    [collectionFrequencyHours, autoCollectEnabled, connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_SCHEDULE_UPDATED", resource: "integration_connections", detail: { connectionId, collectionFrequencyHours, autoCollectEnabled } });

  res.json(connection);
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const existing = await query(
    `SELECT ic.status,
            EXISTS (
              SELECT 1 FROM evidence_collection_runs r
              WHERE r.connection_id = ic.id AND r.status IN ('success', 'partial_failure')
            ) AS ever_collected
       FROM integration_connections ic
       WHERE ic.id = $1 AND ic.company_id = $2`,
    [connectionId, req.user.companyId]
  );
  if (existing.rowCount === 0) return res.status(404).json({ error: "Connection not found" });

  // A connection that never successfully connected never held a working
  // credential worth crypto-shredding for audit purposes — hard-delete it
  // (cascades to credentials/runs/findings) instead of leaving a dead
  // "revoked" row behind. A connection that did connect gets the existing
  // soft-revoke treatment, preserving its audit trail. `status === 'error'`
  // alone isn't a reliable proxy for "never connected" — collectionRunner
  // flips a previously-connected connection to 'error' on any later failed
  // run too, so this also requires that no run of that connection ever
  // completed (successfully or partially) before hard-deleting.
  if (existing.rows[0].status === "error" && !existing.rows[0].ever_collected) {
    await query(`DELETE FROM integration_connections WHERE id = $1 AND company_id = $2`, [connectionId, req.user.companyId]);
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_DELETED", resource: "integration_connections", detail: { connectionId } });
    return res.status(204).send();
  }

  await query(
    `UPDATE integration_connections SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  await revokeCredentials(connectionId, req.user.companyId);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_REVOKED", resource: "integration_connections", detail: { connectionId } });

  res.status(204).send();
}));

export default router;
