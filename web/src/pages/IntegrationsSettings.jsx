import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaAws, FaMicrosoft, FaGithub } from "react-icons/fa";
import { SiZoho, SiGoogle, SiGooglecloud } from "react-icons/si";
import { apiFetch } from "../api/client.js";
import CredentialFields from "../components/CredentialFields.jsx";
import GithubAppWalkthrough from "../components/GithubAppWalkthrough.jsx";

const STATUS_COLOR = {
  connected: "var(--green)",
  pending:   "var(--text3)",
  error:     "var(--red)",
  revoked:   "var(--text3)",
};

const PROVIDER_ICON = {
  aws: { Icon: FaAws, color: "#FF9900" },
  azure: { Icon: FaMicrosoft, color: "#0078D4" },
  github: { Icon: FaGithub, color: "#181717" },
  purview: { Icon: FaMicrosoft, color: "#8661C5" },
  zoho: { Icon: SiZoho, color: "#E61E25" },
  entra_id: { Icon: FaMicrosoft, color: "#0078D4" },
  microsoft_365: { Icon: FaMicrosoft, color: "#D83B01" },
  microsoft_teams: { Icon: FaMicrosoft, color: "#6264A7" },
  microsoft_defender: { Icon: FaMicrosoft, color: "#0D6EFD" },
  google_workspace: { Icon: SiGoogle, color: "#4285F4" },
  gcp: { Icon: SiGooglecloud, color: "#4285F4" },
};

// Display order for known categories; anything else falls back to
// alphabetical after these, so a new connector's category never needs a
// code change here to show up — it just lands at the end.
const CATEGORY_ORDER = ["cloud", "devops", "identity", "collaboration", "endpoint_security", "data_governance", "business_apps"];
const CATEGORY_LABEL = {
  cloud: "Cloud",
  devops: "DevOps",
  identity: "Identity",
  collaboration: "Collaboration",
  endpoint_security: "Endpoint Security",
  data_governance: "Data Governance",
  business_apps: "Business Apps",
};

function titleCase(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function groupCatalogByCategory(catalog) {
  const byCategory = new Map();
  for (const c of catalog) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }
  return [...byCategory.entries()].sort(([a], [b]) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function StatusPill({ status }) {
  const color = STATUS_COLOR[status] || "var(--text3)";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color,
      background: `${color}18`, padding: "2px 8px",
      borderRadius: 20, border: `1px solid ${color}40`
    }}>
      {status}
    </span>
  );
}

const CADENCE_OPTIONS = [6, 12, 24, 72, 168];

function randomExternalId() {
  return `prism-${crypto.randomUUID().slice(0, 8)}`;
}

function trustPolicyFor(principalArn, externalId) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { AWS: principalArn || "<ask your Prism administrator for this deployment's AWS principal ARN>" },
      Action: "sts:AssumeRole",
      Condition: { StringEquals: { "sts:ExternalId": externalId || "<external-id>" } }
    }]
  }, null, 2);
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={copy}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function JsonBlock({ label, json }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>{label}</span>
        <CopyButton text={json} />
      </div>
      <pre style={{ fontSize: 11, overflowX: "auto", padding: 10, background: "var(--bg3)", borderRadius: 6, margin: 0 }}>
        {json}
      </pre>
    </div>
  );
}

function AwsRoleWalkthrough({ token, roleArn, setRoleArn, externalId }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/aws/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const trustPolicy = trustPolicyFor(setupInfo?.principalArn, externalId);
  const permissionsPolicy = setupInfo?.permissionsPolicy ? JSON.stringify(setupInfo.permissionsPolicy, null, 2) : null;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In AWS IAM → Roles → Create role → <strong>Custom trust policy</strong>, paste the Trust Policy JSON below.</li>
        <li>On the permissions step, create/attach an inline policy using the Permissions Policy JSON below (grants read-only access only).</li>
        <li>Name the role (e.g. <code>prism-readonly</code>) and create it.</li>
        <li>Copy the role's ARN into the field below, then click Connect.</li>
      </ol>

      {setupInfo?.principalError && (
        <p className="error-text" style={{ fontSize: 12 }}>{setupInfo.principalError}</p>
      )}
      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <JsonBlock label="Trust policy JSON" json={trustPolicy} />
      {permissionsPolicy && <JsonBlock label="Permissions policy JSON (read-only)" json={permissionsPolicy} />}

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-role-arn">Role ARN <span style={{ color: "var(--text3)", fontWeight: 400 }}>(from step 4 above)</span></label>
        <input id="conn-role-arn" required value={roleArn} onChange={e => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/prism-readonly" />
      </div>
    </div>
  );
}

function AzureServicePrincipalWalkthrough({ token, tenantId, setTenantId, subscriptionId, setSubscriptionId }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/azure/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const roleDefinition = setupInfo?.roleDefinition ? JSON.stringify(setupInfo.roleDefinition, null, 2) : null;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In Microsoft Entra ID → App registrations → New registration. Name it (e.g. <code>prism-readonly</code>).</li>
        <li>Under Certificates &amp; secrets → New client secret. Copy the value immediately — it's shown only once.</li>
        <li>Copy the Application (client) ID and Directory (tenant) ID from the app's Overview page.</li>
        <li>In your Subscription → Access control (IAM) → Add role assignment, using the role definition JSON below (or the built-in Reader role for a quicker start), assigned to the app registration.</li>
        <li>Paste the Tenant ID, Subscription ID, Client ID, and Client Secret below, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {roleDefinition && <JsonBlock label="Role definition JSON" json={roleDefinition} />}

      <div className="form-group">
        <label htmlFor="conn-tenant-id">Tenant ID</label>
        <input id="conn-tenant-id" required value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-subscription-id">Subscription ID</label>
        <input id="conn-subscription-id" required value={subscriptionId} onChange={e => setSubscriptionId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
    </div>
  );
}

function ZohoWalkthrough({ token, dataCenter, setDataCenter, orgId, setOrgId }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");
  const [selectedProducts, setSelectedProducts] = useState(null); // null = not yet loaded

  useEffect(() => {
    apiFetch("/api/integrations/zoho/setup-info", { token })
      .then(info => {
        setSetupInfo(info);
        // Default all products selected
        setSelectedProducts(new Set(info.products.map(p => p.key)));
      })
      .catch(e => setSetupError(e.message));
  }, [token]);

  const toggleProduct = (productKey) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productKey)) next.delete(productKey);
      else next.add(productKey);
      return next;
    });
  };

  const scopeString = setupInfo && selectedProducts
    ? setupInfo.products
        .filter(p => selectedProducts.has(p.key))
        .flatMap(p => p.scopes)
        .join(",")
    : "";

  const apiConsoleUrl = dataCenter === "cloud.ca"
    ? "https://api-console.zohocloud.ca"
    : dataCenter === "com" || !dataCenter
      ? "https://api-console.zoho.com"
      : `https://api-console.zoho.${dataCenter}`;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Select your Zoho data center below — this must match the <code>zoho.&lt;tld&gt;</code> domain your org uses to sign in.</li>
        <li>Go to <strong><a href={apiConsoleUrl} target="_blank" rel="noreferrer">{apiConsoleUrl}</a></strong> as an org admin and create a new <strong>Self Client</strong> (or Server-based Application). You will receive a Client ID and Client Secret.</li>
        <li>In the client's <strong>Generate Code</strong> tab, paste the scope string below (select only the products Zoho has provisioned for your org), set the expiry, and generate a grant code.</li>
        <li>Immediately exchange the grant code for tokens:<br />
          <code style={{ fontSize: 10 }}>POST https://accounts.zoho.{'{'}dataCenter{'}'}/oauth/v2/token</code> with <code>grant_type=authorization_code</code>. The response contains an <strong>access_token</strong> and a <strong>refresh_token</strong> — copy the refresh token.
        </li>
        <li>Enter your Org ID (numeric, from the Zoho org settings), then paste the Client ID, Client Secret, and Refresh Token into the fields below and click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="zoho-dc">Data center</label>
        <select id="zoho-dc" value={dataCenter} onChange={e => setDataCenter(e.target.value)}
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg1)", color: "var(--text1)", fontSize: 13 }}>
          {(setupInfo?.dataCenters || []).map(dc => (
            <option key={dc.value} value={dc.value}>{dc.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="zoho-org-id">Org ID <span style={{ color: "var(--text3)", fontWeight: 400 }}>(numeric, from Zoho org settings)</span></label>
        <input id="zoho-org-id" value={orgId} onChange={e => setOrgId(e.target.value)} placeholder="60012345678" />
      </div>

      {setupInfo?.products && selectedProducts && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>
            Products to audit <span style={{ fontWeight: 400, color: "var(--text3)" }}>(uncheck products your org hasn't provisioned)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginBottom: 8 }}>
            {setupInfo.products.map(p => (
              <label key={p.key} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "var(--text2)" }}>
                <input type="checkbox" checked={selectedProducts.has(p.key)} onChange={() => toggleProduct(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Generated scope string (paste into Zoho API Console → Generate Code):</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <textarea
              readOnly
              value={scopeString}
              rows={3}
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text1)", resize: "vertical" }}
            />
            <CopyButton text={scopeString} />
          </div>
        </div>
      )}
    </div>
  );
}

function PurviewWalkthrough({ token, tenantId, setTenantId, purviewAccountName, setPurviewAccountName }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/purview/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const permissions = setupInfo?.permissions;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In Microsoft Entra ID → App registrations → New registration. Name it (e.g. <code>prism-readonly</code>), then under Certificates &amp; secrets → New client secret — copy the value immediately, it's shown only once.</li>
        <li>
          <strong>In the Purview governance portal</strong> (not Azure IAM — this is a separate, commonly-confused system) → Data Map → Collections → your root collection → Role assignments, grant the app registration both:
          {permissions?.purviewRbacRoles && (
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {permissions.purviewRbacRoles.map(r => (
                <li key={r.roleName}><strong>{r.roleName}</strong> ({r.scope}) — {r.note}</li>
              ))}
            </ul>
          )}
        </li>
        <li>
          Under the app registration's API permissions → Add a permission → Office 365 Management APIs → Application permissions, add:
          {permissions?.office365ManagementApiPermissions && (
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {permissions.office365ManagementApiPermissions.permissions.map(p => <li key={p}><code>{p}</code></li>)}
            </ul>
          )}
          then click <strong>Grant admin consent</strong> — {permissions?.office365ManagementApiPermissions?.note}
        </li>
        {permissions?.prerequisites?.map(p => <li key={p}>{p}</li>)}
        <li>Copy the Tenant ID (Overview page) and your Purview account name, plus the Client ID and Client Secret, into the fields below, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="conn-tenant-id">Tenant ID</label>
        <input id="conn-tenant-id" required value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-purview-account-name">Purview account name</label>
        <input id="conn-purview-account-name" required value={purviewAccountName} onChange={e => setPurviewAccountName(e.target.value)} placeholder="my-purview-account" />
      </div>
    </div>
  );
}

// Shared walkthrough for all four Microsoft connectors that share the same
// tenantId + clientId + clientSecret credential shape (Entra ID, M365, Teams, Defender).

const MS_CONNECTOR_NAME = {
  entra_id: "Microsoft Entra ID",
  microsoft_365: "Microsoft 365",
  microsoft_teams: "Microsoft Teams",
  microsoft_defender: "Microsoft Defender for Endpoint",
};

function MicrosoftWalkthrough({ providerKey, tenantId, setTenantId, token }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch(`/api/integrations/${providerKey}/setup-info`, { token })
      .then(info => setSetupInfo(info))
      .catch(e => setSetupError(e.message));
  }, [token, providerKey]);

  const p = setupInfo?.permissions;
  const name = MS_CONNECTOR_NAME[providerKey] || providerKey;
  const isDefender = providerKey === "microsoft_defender";

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect — {name}</div>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>
          In <strong>Microsoft Entra ID → App registrations → New registration</strong>, name it (e.g. <code>prism-compliance</code>).{" "}
          {p?.sharedAppNote && <span style={{ color: "var(--text3)" }}>{p.sharedAppNote}</span>}
        </li>
        <li>
          Under <strong>Certificates &amp; secrets → New client secret</strong> — copy the value immediately (shown only once).
          Note the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong> from the app's Overview page.
        </li>

        {/* Graph permissions (all connectors except Defender show this block) */}
        {p?.graphPermissions && (
          <li>
            <strong>API permissions → Add a permission → Microsoft Graph → Application permissions</strong>, add:
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {p.graphPermissions.map(({ permission, note }) => (
                <li key={permission}><code>{permission}</code>{note && <span style={{ color: "var(--text3)" }}> — {note}</span>}</li>
              ))}
            </ul>
          </li>
        )}

        {/* Exchange permission (M365 only) */}
        {p?.exchangePermission && (
          <li>
            <strong>API permissions → Add a permission → APIs my organization uses → {p.exchangePermission.resource} → Application permissions</strong>, add <code>{p.exchangePermission.permission}</code>.
            {" "}<span style={{ color: "var(--text3)" }}>{p.exchangePermission.note}</span>
          </li>
        )}

        {/* WindowsDefenderATP permissions (Defender only) */}
        {p?.windowsDefenderATPPermissions && (
          <li>
            <strong>API permissions → Add a permission → APIs my organization uses → WindowsDefenderATP → Application permissions</strong>, add:
            {p.resourceNote && <span style={{ color: "var(--text3)" }}> ({p.resourceNote})</span>}
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {p.windowsDefenderATPPermissions.map(({ permission, note }) => (
                <li key={permission}><code>{permission}</code>{note && <span style={{ color: "var(--text3)" }}> — {note}</span>}</li>
              ))}
            </ul>
          </li>
        )}

        {/* Admin consent */}
        <li>
          Click <strong>Grant admin consent for &lt;tenant&gt;</strong>.
          {p?.consentNote && <span style={{ color: "var(--text3)" }}> {p.consentNote}</span>}
        </li>

        {/* Entra role assignment (M365 only) */}
        {p?.entraRoleAssignment && (
          <li>
            <strong>Assign the <code>{p.entraRoleAssignment.role}</code> Entra ID role</strong> to the app's service principal.
            {" "}<span style={{ color: "var(--text3)" }}>{p.entraRoleAssignment.note}</span>
          </li>
        )}

        {/* TCM enrollment (Teams only) */}
        {p?.tcmNote && (
          <li>
            <strong>Enroll the TCM service principal</strong> (one-time tenant setup).{" "}
            <span style={{ color: "var(--text3)" }}>{p.tcmNote}</span>
          </li>
        )}

        {/* Defender token-audience note */}
        {p?.tokenAudienceNote && (
          <li style={{ color: "var(--text3)" }}><em>Note: {p.tokenAudienceNote}</em></li>
        )}

        <li>Paste the Tenant ID, Client ID, and Client Secret into the fields below and click Connect.</li>
      </ol>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-tenant-id">Tenant ID</label>
        <input id="conn-tenant-id" required value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000 or contoso.onmicrosoft.com" />
      </div>
    </div>
  );
}

function GoogleWorkspaceWalkthrough({
  token,
  adminEmail, setAdminEmail,
  customerId, setCustomerId,
  clientEmail, setClientEmail,
  privateKey, setPrivateKey,
}) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/google_workspace/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const scopeString = setupInfo?.scopes ? setupInfo.scopes.join(",") : "";

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>, create or choose a project, then enable the <strong>Admin SDK API</strong>, <strong>Chrome Policy API</strong>, and <strong>Cloud Identity API</strong> under APIs &amp; Services → Library.</li>
        <li>Under <strong>IAM &amp; Admin → Service Accounts → Create Service Account</strong>, no project IAM roles are needed. Note its email and, on its Details tab, its numeric <strong>Client ID</strong>.</li>
        <li>On that service account, enable <strong>Domain-wide Delegation</strong> (Advanced settings).</li>
        <li>Under <strong>Keys → Add Key → Create new key → JSON</strong>, download the key — you'll paste its <code>client_email</code> and <code>private_key</code> fields below.</li>
        <li>As a Workspace <strong>super admin</strong>, go to <strong>Admin Console → Security → API Controls → Domain-wide Delegation → Manage Domain Wide Delegation</strong>, and add the service account's numeric Client ID with the scope list below.</li>
        <li>Enter the admin's email (the account the service account impersonates), the service account's email and private key, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {scopeString && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>OAuth scope list (paste into Domain-wide Delegation):</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <textarea
              readOnly
              value={scopeString}
              rows={3}
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text1)", resize: "vertical" }}
            />
            <CopyButton text={scopeString} />
          </div>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="conn-admin-email">Admin email <span style={{ color: "var(--text3)", fontWeight: 400 }}>(impersonation target)</span></label>
        <input id="conn-admin-email" required type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@customer-domain.com" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-customer-id">Workspace customer ID <span style={{ color: "var(--text3)", fontWeight: 400 }}>(optional — defaults to the admin's own domain)</span></label>
        <input id="conn-customer-id" value={customerId} onChange={e => setCustomerId(e.target.value)} placeholder="C0xxxxxxx" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-client-email">Service account email</label>
        <input id="conn-client-email" required value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="prism-connector@my-project.iam.gserviceaccount.com" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-private-key">Private key <span style={{ color: "var(--text3)", fontWeight: 400 }}>(the JSON key's "private_key" field, including BEGIN/END lines)</span></label>
        <textarea
          id="conn-private-key" required value={privateKey} onChange={e => setPrivateKey(e.target.value)}
          rows={4} placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
          style={{ width: "100%", fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg1)", color: "var(--text1)", resize: "vertical" }}
        />
      </div>
    </div>
  );
}

function GcpWalkthrough({
  token,
  projectId, setProjectId,
  clientEmail, setClientEmail,
  privateKey, setPrivateKey,
}) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/gcp/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>, select the project to audit and enable the Compute Engine, Cloud SQL Admin, Cloud KMS, IAM, and Cloud Resource Manager APIs under APIs &amp; Services → Library.</li>
        <li>Under <strong>IAM &amp; Admin → Service Accounts → Create Service Account</strong>, create a service account (no domain-wide delegation needed for this connector).</li>
        <li>Under <strong>IAM &amp; Admin → IAM → Grant Access</strong>, grant the service account these roles:
          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            {(setupInfo?.roles || []).map(({ role, note }) => (
              <li key={role}><code>{role}</code>{note && <span style={{ color: "var(--text3)" }}> — {note}</span>}</li>
            ))}
          </ul>
        </li>
        <li>Under <strong>Keys → Add Key → Create new key → JSON</strong>, download the key — paste its <code>client_email</code> and <code>private_key</code> fields below.</li>
        <li>Enter the project ID, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="conn-project-id">Project ID</label>
        <input id="conn-project-id" required value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="my-gcp-project" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-gcp-client-email">Service account email</label>
        <input id="conn-gcp-client-email" required value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="prism-connector@my-gcp-project.iam.gserviceaccount.com" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-gcp-private-key">Private key <span style={{ color: "var(--text3)", fontWeight: 400 }}>(the JSON key's "private_key" field, including BEGIN/END lines)</span></label>
        <textarea
          id="conn-gcp-private-key" required value={privateKey} onChange={e => setPrivateKey(e.target.value)}
          rows={4} placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
          style={{ width: "100%", fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg1)", color: "var(--text1)", resize: "vertical" }}
        />
      </div>
    </div>
  );
}

function AddIntegrationWizard({ provider, token, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [roleArn, setRoleArn] = useState("");
  const [externalId] = useState(randomExternalId);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [purviewAccountName, setPurviewAccountName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  // Zoho-specific state
  const [dataCenter, setDataCenter] = useState("com");
  const [orgId, setOrgId] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  // Google Workspace-specific state (domain-wide delegation service account)
  const [adminEmail, setAdminEmail] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  // GCP-specific state (reuses clientEmail/privateKey above — same JSON-key
  // credential shape, just without domain-wide delegation)
  const [projectId, setProjectId] = useState("");
  const [authType, setAuthType] = useState(provider.authType);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Tracks the connection created by a prior (possibly failed) submit attempt,
  // so a retry after a credentials-step failure reuses it instead of creating
  // a second, orphaned, credential-less connection.
  const [createdConnection, setCreatedConnection] = useState(null);
  const [githubSetupStarted, setGithubSetupStarted] = useState(false);

  const handleStartGithubSetup = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let connection = createdConnection;
      if (!connection) {
        connection = await apiFetch("/api/integrations", {
          token, method: "POST",
          body: JSON.stringify({ integrationKey: provider.key, name, config: {} })
        });
        setCreatedConnection(connection);
      }
      setGithubSetupStarted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const config = authType === "oauth2"
        ? provider.key === "zoho"
          ? { dataCenter, orgId }
          : provider.key === "purview"
            ? { tenantId, purviewAccountName }
            : provider.key === "azure"
              ? { tenantId, subscriptionId }
              : provider.key === "google_workspace"
                ? { adminEmail, customerId: customerId || undefined }
                : provider.key === "gcp"
                  ? { projectId }
                  : { tenantId }
        : authType === "iam_role" ? { region, roleArn } : { region };
      const secret = authType === "oauth2"
        ? provider.key === "zoho"
          ? { clientId, clientSecret, refreshToken }
          : provider.key === "google_workspace" || provider.key === "gcp"
            ? { clientEmail, privateKey }
            : { clientId, clientSecret }
        : authType === "iam_role" ? { externalId } : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };

      let connection = createdConnection;
      if (!connection) {
        connection = await apiFetch("/api/integrations", {
          token, method: "POST",
          body: JSON.stringify({ integrationKey: provider.key, name, config })
        });
        setCreatedConnection(connection);
      }

      const updated = await apiFetch(`/api/integrations/${connection.id}/credentials`, {
        token, method: "POST",
        body: JSON.stringify({ authType, secret })
      });

      setCreatedConnection(null);
      onCreated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Once the GitHub connection exists, GithubAppWalkthrough renders its own
  // <form> that posts to github.com. Nesting that inside this wizard's form
  // would produce invalid (and Playwright-ambiguous) nested <form> elements,
  // so this outer wrapper degrades to a plain <div> at that point — by then
  // it has no submit button of its own anyway.
  const WizardFormTag = provider.key === "github" && githubSetupStarted ? "div" : "form";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-title">Connect {provider.name}</div>

        <WizardFormTag onSubmit={WizardFormTag === "form" ? (provider.key === "github" ? handleStartGithubSetup : handleSubmit) : undefined}>
          {error && <p className="error-text">{error}</p>}
          <div className="form-group">
            <label htmlFor="conn-name">Connection name</label>
            <input id="conn-name" required value={name} onChange={e => setName(e.target.value)} placeholder={`My ${provider.name}`} />
          </div>

          {provider.key === "github" ? (
            githubSetupStarted && createdConnection ? (
              <GithubAppWalkthrough connectionId={createdConnection.id} token={token} />
            ) : null
          ) : (
            <>
              {provider.key === "aws" ? (
                <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                  {["iam_role", "access_key"].map(t => (
                    <button type="button" key={t}
                      className="btn btn-ghost"
                      style={{ fontWeight: authType === t ? 700 : 400, borderBottom: authType === t ? "2px solid var(--accent)" : "none" }}
                      onClick={() => setAuthType(t)}
                    >
                      {t === "iam_role" ? "IAM Role" : "Access Keys"}
                    </button>
                  ))}
                </div>
              ) : null}

              {provider.key !== "azure" && provider.key !== "github" && provider.key !== "purview" && provider.key !== "zoho" && provider.key !== "google_workspace" && provider.key !== "gcp" &&
               !["entra_id", "microsoft_365", "microsoft_teams", "microsoft_defender"].includes(provider.key) && (
                <div className="form-group">
                  <label htmlFor="conn-region">Region</label>
                  <input id="conn-region" value={region} onChange={e => setRegion(e.target.value)} />
                </div>
              )}

              {authType === "iam_role" ? (
                provider.key === "aws" ? (
                  <AwsRoleWalkthrough token={token} roleArn={roleArn} setRoleArn={setRoleArn} externalId={externalId} />
                ) : (
                  <div className="form-group">
                    <label htmlFor="conn-role-arn">Role ARN</label>
                    <input id="conn-role-arn" required value={roleArn} onChange={e => setRoleArn(e.target.value)} />
                  </div>
                )
              ) : authType === "oauth2" ? (
                <>
                  {provider.key === "zoho" ? (
                    <ZohoWalkthrough
                      token={token}
                      dataCenter={dataCenter} setDataCenter={setDataCenter}
                      orgId={orgId} setOrgId={setOrgId}
                    />
                  ) : provider.key === "purview" ? (
                    <PurviewWalkthrough
                      token={token}
                      tenantId={tenantId} setTenantId={setTenantId}
                      purviewAccountName={purviewAccountName} setPurviewAccountName={setPurviewAccountName}
                    />
                  ) : ["entra_id", "microsoft_365", "microsoft_teams", "microsoft_defender"].includes(provider.key) ? (
                    <MicrosoftWalkthrough
                      providerKey={provider.key}
                      token={token}
                      tenantId={tenantId} setTenantId={setTenantId}
                    />
                  ) : provider.key === "google_workspace" ? (
                    <GoogleWorkspaceWalkthrough
                      token={token}
                      adminEmail={adminEmail} setAdminEmail={setAdminEmail}
                      customerId={customerId} setCustomerId={setCustomerId}
                      clientEmail={clientEmail} setClientEmail={setClientEmail}
                      privateKey={privateKey} setPrivateKey={setPrivateKey}
                    />
                  ) : provider.key === "gcp" ? (
                    <GcpWalkthrough
                      token={token}
                      projectId={projectId} setProjectId={setProjectId}
                      clientEmail={clientEmail} setClientEmail={setClientEmail}
                      privateKey={privateKey} setPrivateKey={setPrivateKey}
                    />
                  ) : (
                    <AzureServicePrincipalWalkthrough
                      token={token}
                      tenantId={tenantId} setTenantId={setTenantId}
                      subscriptionId={subscriptionId} setSubscriptionId={setSubscriptionId}
                    />
                  )}
                  {provider.key !== "google_workspace" && provider.key !== "gcp" && (
                    <CredentialFields
                      authType="oauth2"
                      clientId={clientId} setClientId={setClientId}
                      clientSecret={clientSecret} setClientSecret={setClientSecret}
                    />
                  )}
                  {provider.key === "zoho" && (
                    <div className="form-group">
                      <label htmlFor="conn-refresh-token">Refresh Token <span style={{ color: "var(--text3)", fontWeight: 400 }}>(from step 4 above)</span></label>
                      <input id="conn-refresh-token" required type="password" value={refreshToken} onChange={e => setRefreshToken(e.target.value)} placeholder="1000.yyyy…zzzz…" />
                    </div>
                  )}
                </>
              ) : (
                <CredentialFields
                  authType={authType}
                  accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
                  secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
                  sessionToken={sessionToken} setSessionToken={setSessionToken}
                />
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            {!(provider.key === "github" && githubSetupStarted) && (
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {provider.key === "github"
                  ? (submitting ? "Starting…" : "Start GitHub setup")
                  : (submitting ? "Connecting…" : "Connect")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={provider.key === "github" && githubSetupStarted ? () => onCreated(createdConnection) : onClose}
            >
              {provider.key === "github" && githubSetupStarted ? "Close" : "Cancel"}
            </button>
          </div>
        </WizardFormTag>
      </div>
    </div>
  );
}

export default function IntegrationsSettings({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const [catalog, setCatalog] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizardProvider, setWizardProvider] = useState(null);
  // Keyed by connection id — a schedule change on one row must not disable
  // or otherwise affect the controls on any other row.
  const [savingSchedule, setSavingSchedule] = useState({});

  const load = useCallback(async () => {
    const [catalogData, connData] = await Promise.all([
      apiFetch("/api/integrations/catalog", { token }),
      apiFetch("/api/integrations", { token }),
    ]);
    setCatalog(catalogData || []);
    setConnections(connData || []);
  }, [token]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const githubError = searchParams.get("githubError");
    if (githubError) {
      setError(githubError);
      navigate("/settings/integrations", { replace: true });
    }
    // Only ever meant to run once, reading whatever GitHub's redirect put on
    // the URL at load time — not on every searchParams identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreated = async () => {
    // The create+credentials steps already succeeded by the time this fires,
    // so close the wizard regardless of whether the post-create reload
    // succeeds — but surface a reload failure via the page's error banner
    // instead of letting it become an unhandled promise rejection.
    setWizardProvider(null);
    try {
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (e, connectionId, name) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${name}"? This failed connection attempt will be permanently removed.`)) return;
    try {
      await apiFetch(`/api/integrations/${connectionId}`, { token, method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  // The PATCH route requires both fields together, so every call sends the
  // connection's current value for whichever field didn't change alongside
  // the one that did.
  const handleScheduleChange = async (e, connectionId, patch) => {
    e.stopPropagation();
    setError("");
    setSavingSchedule(s => ({ ...s, [connectionId]: true }));
    try {
      const updated = await apiFetch(`/api/integrations/${connectionId}/schedule`, {
        token, method: "PATCH",
        body: JSON.stringify(patch)
      });
      setConnections(cs => cs.map(c => c.id === connectionId ? updated : c));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSchedule(s => ({ ...s, [connectionId]: false }));
    }
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      {wizardProvider && (
        <AddIntegrationWizard
          provider={wizardProvider}
          token={token}
          onClose={() => setWizardProvider(null)}
          onCreated={handleCreated}
        />
      )}

      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Settings — Integrations</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/findings")}>Findings</button>
            <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <section className="admin-section">
          <h2>Connections</h2>
          <div className="admin-table">
            <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr" }}>
              <span>Name</span>
              <span>Provider</span>
              <span>Status</span>
              <span>Last run</span>
              <span>Cadence</span>
              <span>Auto-collect</span>
              <span></span>
            </div>
            {connections.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No connections yet — pick a connector below to get started.</span></div>
            )}
            {connections.map(c => {
              const cadence = c.collectionFrequencyHours ?? 24;
              const autoCollect = c.autoCollectEnabled ?? true;
              const savingThis = !!savingSchedule[c.id];
              return (
                <div
                  key={c.id}
                  className="admin-row"
                  style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr", cursor: "pointer" }}
                  onClick={() => navigate(`/settings/integrations/${c.id}`)}
                >
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{c.integrationKey}</span>
                  <span><StatusPill status={c.status} /></span>
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>
                    {c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : "Never"}
                  </span>
                  <span onClick={e => e.stopPropagation()}>
                    <select
                      aria-label="Collection cadence"
                      value={cadence}
                      disabled={!isLeadOrAdmin || savingThis}
                      style={{ fontSize: 12 }}
                      onChange={(e) => handleScheduleChange(e, c.id, {
                        collectionFrequencyHours: Number(e.target.value),
                        autoCollectEnabled: autoCollect,
                      })}
                    >
                      {CADENCE_OPTIONS.map(h => <option key={h} value={h}>Every {h}h</option>)}
                    </select>
                  </span>
                  <span onClick={e => e.stopPropagation()}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, cursor: isLeadOrAdmin ? "pointer" : "default" }}>
                      <input
                        type="checkbox"
                        aria-label="Auto-collect enabled"
                        checked={autoCollect}
                        disabled={!isLeadOrAdmin || savingThis}
                        onChange={(e) => handleScheduleChange(e, c.id, {
                          collectionFrequencyHours: cadence,
                          autoCollectEnabled: e.target.checked,
                        })}
                      />
                      Auto
                    </label>
                  </span>
                  <span>
                    {isLeadOrAdmin && c.status === "error" && (
                      <button className="btn btn-ghost" style={{ color: "var(--red)", fontSize: 12, padding: "4px 8px" }} onClick={(e) => handleDelete(e, c.id, c.name)}>Delete</button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="admin-section">
          <h2>Available connectors</h2>
          {groupCatalogByCategory(catalog).map(([category, providers]) => (
            <div key={category} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
                {CATEGORY_LABEL[category] || titleCase(category)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {providers.map(c => {
                  const iconEntry = PROVIDER_ICON[c.key];
                  const clickable = isLeadOrAdmin && c.status === "active";
                  return (
                    <div
                      key={c.key}
                      className="card"
                      title={c.name}
                      style={{
                        padding: 20, minWidth: 160, display: "flex", flexDirection: "column",
                        alignItems: "center", gap: 8, cursor: clickable ? "pointer" : "default",
                        opacity: c.status === "active" ? 1 : 0.5,
                      }}
                      onClick={() => clickable && setWizardProvider(c)}
                    >
                      {iconEntry
                        ? <iconEntry.Icon size={36} color={iconEntry.color} aria-label={c.name} />
                        : <div style={{ fontWeight: 600 }}>{c.name}</div>}
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>
                        {c.status === "active" ? c.name : `${c.name} · ${c.status.replace("_", " ")}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
