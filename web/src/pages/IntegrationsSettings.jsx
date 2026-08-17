import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";

const STATUS_COLOR = {
  connected: "var(--green)",
  pending:   "var(--text3)",
  error:     "var(--red)",
  revoked:   "var(--text3)",
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

const TRUST_POLICY_TEMPLATE = (externalId) => JSON.stringify({
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { AWS: "<YOUR PRISM DEPLOYMENT'S AWS PRINCIPAL ARN — ask your Prism admin>" },
    Action: "sts:AssumeRole",
    Condition: { StringEquals: { "sts:ExternalId": externalId || "<external-id>" } }
  }]
}, null, 2);

function AddIntegrationWizard({ catalog, token, onClose, onCreated }) {
  const [step, setStep] = useState("pick"); // "pick" | "configure"
  const [provider, setProvider] = useState(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [roleArn, setRoleArn] = useState("");
  const [externalId, setExternalId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [authType, setAuthType] = useState("iam_role");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pickProvider = (p) => {
    setProvider(p);
    setAuthType(p.authType === "access_key" ? "access_key" : "iam_role");
    setStep("configure");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const config = authType === "iam_role" ? { region, roleArn } : { region };
      const secret = authType === "iam_role"
        ? { externalId }
        : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };

      const connection = await apiFetch("/api/integrations", {
        token, method: "POST",
        body: JSON.stringify({ integrationKey: provider.key, name, config })
      });

      const updated = await apiFetch(`/api/integrations/${connection.id}/credentials`, {
        token, method: "POST",
        body: JSON.stringify({ authType, secret })
      });

      onCreated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-title">Add Integration</div>

        {step === "pick" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {catalog.length === 0 && <p style={{ color: "var(--text3)" }}>No connectors available yet.</p>}
            {catalog.map(c => (
              <button
                key={c.key}
                className="btn btn-ghost"
                style={{ justifyContent: "flex-start", textAlign: "left" }}
                disabled={c.status !== "active"}
                onClick={() => pickProvider(c)}
              >
                {c.name} {c.status !== "active" && <span style={{ color: "var(--text3)", fontSize: 11 }}>({c.status})</span>}
              </button>
            ))}
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
          </div>
        )}

        {step === "configure" && (
          <form onSubmit={handleSubmit}>
            {error && <p className="error-text">{error}</p>}
            <div className="form-group">
              <label htmlFor="conn-name">Connection name</label>
              <input id="conn-name" required value={name} onChange={e => setName(e.target.value)} />
            </div>

            {provider.authType === "access_key" ? (
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

            <div className="form-group">
              <label htmlFor="conn-region">Region</label>
              <input id="conn-region" value={region} onChange={e => setRegion(e.target.value)} />
            </div>

            {authType === "iam_role" ? (
              <>
                <div className="form-group">
                  <label htmlFor="conn-role-arn">Role ARN</label>
                  <input id="conn-role-arn" required value={roleArn} onChange={e => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/prism-readonly" />
                </div>
                <div className="form-group">
                  <label htmlFor="conn-external-id">External ID</label>
                  <input id="conn-external-id" required value={externalId} onChange={e => setExternalId(e.target.value)} />
                </div>
                <details style={{ marginBottom: 12 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text2)" }}>Trust policy JSON</summary>
                  <pre style={{ fontSize: 11, overflowX: "auto", padding: 10, background: "var(--bg3)", borderRadius: 6 }}>
                    {TRUST_POLICY_TEMPLATE(externalId)}
                  </pre>
                </details>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label htmlFor="conn-access-key">Access key ID</label>
                  <input id="conn-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="conn-secret-key">Secret access key</label>
                  <input id="conn-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="conn-session-token">Session token (optional)</label>
                  <input id="conn-session-token" value={sessionToken} onChange={e => setSessionToken(e.target.value)} />
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Connecting…" : "Connect"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setStep("pick")}>Back</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function IntegrationsSettings({ token, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showWizard, setShowWizard] = useState(false);

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
    setShowWizard(false);
    await load();
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      {showWizard && (
        <AddIntegrationWizard
          catalog={catalog}
          token={token}
          onClose={() => setShowWizard(false)}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>Connections</h2>
            <button className="btn btn-primary" onClick={() => setShowWizard(true)}>+ Add Integration</button>
          </div>
          <div className="admin-table">
            <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
              <span>Name</span>
              <span>Provider</span>
              <span>Status</span>
              <span>Last run</span>
            </div>
            {connections.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No connections yet — add one to get started.</span></div>
            )}
            {connections.map(c => (
              <div
                key={c.id}
                className="admin-row"
                style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr", cursor: "pointer" }}
                onClick={() => navigate(`/settings/integrations/${c.id}`)}
              >
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{c.integrationKey}</span>
                <span><StatusPill status={c.status} /></span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : "Never"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-section">
          <h2>Available connectors</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {catalog.map(c => (
              <div key={c.key} className="card" style={{ padding: 16, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{c.category}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
