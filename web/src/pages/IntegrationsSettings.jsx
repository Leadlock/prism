import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaAws, FaMicrosoft } from "react-icons/fa";
import { apiFetch } from "../api/client.js";
import CredentialFields from "../components/CredentialFields.jsx";

const STATUS_COLOR = {
  connected: "var(--green)",
  pending:   "var(--text3)",
  error:     "var(--red)",
  revoked:   "var(--text3)",
};

const PROVIDER_ICON = {
  aws: { Icon: FaAws, color: "#FF9900" },
  azure: { Icon: FaMicrosoft, color: "#0078D4" },
};

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
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authType, setAuthType] = useState(provider.authType);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Tracks the connection created by a prior (possibly failed) submit attempt,
  // so a retry after a credentials-step failure reuses it instead of creating
  // a second, orphaned, credential-less connection.
  const [createdConnection, setCreatedConnection] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const config = authType === "oauth2"
        ? { tenantId, subscriptionId }
        : authType === "iam_role" ? { region, roleArn } : { region };
      const secret = authType === "oauth2"
        ? { clientId, clientSecret }
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-title">Connect {provider.name}</div>

        <form onSubmit={handleSubmit}>
          {error && <p className="error-text">{error}</p>}
          <div className="form-group">
            <label htmlFor="conn-name">Connection name</label>
            <input id="conn-name" required value={name} onChange={e => setName(e.target.value)} placeholder={`My ${provider.name}`} />
          </div>

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

          {provider.key !== "azure" && (
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
              <AzureServicePrincipalWalkthrough
                token={token}
                tenantId={tenantId} setTenantId={setTenantId}
                subscriptionId={subscriptionId} setSubscriptionId={setSubscriptionId}
              />
              <CredentialFields
                authType="oauth2"
                clientId={clientId} setClientId={setClientId}
                clientSecret={clientSecret} setClientSecret={setClientSecret}
              />
            </>
          ) : (
            <CredentialFields
              authType={authType}
              accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
              secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
              sessionToken={sessionToken} setSessionToken={setSessionToken}
            />
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Connecting…" : "Connect"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function IntegrationsSettings({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const [catalog, setCatalog] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizardProvider, setWizardProvider] = useState(null);

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
            <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
              <span>Name</span>
              <span>Provider</span>
              <span>Status</span>
              <span>Last run</span>
              <span></span>
            </div>
            {connections.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No connections yet — pick a connector below to get started.</span></div>
            )}
            {connections.map(c => (
              <div
                key={c.id}
                className="admin-row"
                style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", cursor: "pointer" }}
                onClick={() => navigate(`/settings/integrations/${c.id}`)}
              >
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{c.integrationKey}</span>
                <span><StatusPill status={c.status} /></span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : "Never"}
                </span>
                <span>
                  {isLeadOrAdmin && c.status === "error" && (
                    <button className="btn btn-ghost" style={{ color: "var(--red)", fontSize: 12, padding: "4px 8px" }} onClick={(e) => handleDelete(e, c.id, c.name)}>Delete</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-section">
          <h2>Available connectors</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {catalog.map(c => {
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
                    {c.status === "active" ? c.category : `${c.category} · ${c.status.replace("_", " ")}`}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
