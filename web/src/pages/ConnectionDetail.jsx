import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";

const RUN_STATUS_COLOR = {
  success: "var(--green)",
  partial_failure: "var(--amber)",
  failed: "var(--red)",
  running: "var(--text3)",
};

function RotateCredentialModal({ connectionId, token, providerAuthType, onClose, onRotated }) {
  const [authType, setAuthType] = useState(providerAuthType || "iam_role");
  const [roleArn, setRoleArn] = useState("");
  const [externalId, setExternalId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const secret = authType === "iam_role"
        ? { externalId }
        : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };
      const updated = await apiFetch(`/api/integrations/${connectionId}/credentials`, {
        token, method: "POST",
        body: JSON.stringify({ authType, secret })
      });
      onRotated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Rotate credentials</div>
        <form onSubmit={handleSubmit}>
          {error && <p className="error-text">{error}</p>}
          {providerAuthType === "access_key" ? (
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
          {authType === "iam_role" ? (
            <div className="form-group">
              <label htmlFor="rotate-external-id">External ID</label>
              <input id="rotate-external-id" required value={externalId} onChange={e => setExternalId(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="rotate-access-key">Access key ID</label>
                <input id="rotate-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="rotate-secret-key">Secret access key</label>
                <input id="rotate-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="rotate-session-token">Session token (optional)</label>
                <input id="rotate-session-token" value={sessionToken} onChange={e => setSessionToken(e.target.value)} />
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Rotating…" : "Rotate"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ConnectionDetail({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const [connection, setConnection] = useState(null);
  const [runs, setRuns] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [showRotate, setShowRotate] = useState(false);

  const load = useCallback(async () => {
    const [connData, runsData, catalogData] = await Promise.all([
      apiFetch(`/api/integrations/${id}`, { token }),
      apiFetch(`/api/integrations/${id}/runs`, { token }),
      apiFetch(`/api/integrations/catalog`, { token }),
    ]);
    setConnection(connData);
    setRuns(runsData || []);
    setCatalog(catalogData || []);
  }, [token, id]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  const handleRunNow = async () => {
    setError("");
    setRunning(true);
    try {
      await apiFetch(`/api/integrations/${id}/run`, { token, method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm("Revoke this connection? Its credentials will be permanently shredded.")) return;
    try {
      await apiFetch(`/api/integrations/${id}`, { token, method: "DELETE" });
      navigate("/settings/integrations");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRotated = async () => {
    setShowRotate(false);
    try {
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  if (!connection) {
    return <div className="admin-container"><div className="admin-card"><p className="error-text">{error || "Connection not found"}</p></div></div>;
  }

  const matchingCatalogEntry = catalog.find(c => c.key === connection.integrationKey);

  return (
    <div className="admin-container">
      {showRotate && (
        <RotateCredentialModal
          connectionId={id}
          token={token}
          providerAuthType={matchingCatalogEntry?.authType}
          onClose={() => setShowRotate(false)}
          onRotated={handleRotated}
        />
      )}

      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Connection detail</p>
            <h1>{connection.name}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/settings/integrations")}>Back</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <section className="admin-section">
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Status</div>
              <div style={{ fontWeight: 600 }}>{connection.status}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Last run</div>
              <div style={{ fontWeight: 600 }}>
                {connection.lastRunAt ? new Date(connection.lastRunAt).toLocaleString() : "Never"}
                {connection.lastRunStatus && <span style={{ marginLeft: 6, color: RUN_STATUS_COLOR[connection.lastRunStatus] || "var(--text3)" }}>({connection.lastRunStatus})</span>}
              </div>
            </div>
          </div>
          {isLeadOrAdmin && (
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-primary" disabled={running} onClick={handleRunNow}>
                {running ? "Running…" : "Run Now"}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowRotate(true)}>Rotate credentials</button>
              <button className="btn btn-ghost" style={{ color: "var(--red)" }} onClick={handleRevoke}>Revoke</button>
            </div>
          )}
        </section>

        <section className="admin-section">
          <h2>Collection history</h2>
          <div className="admin-table">
            <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
              <span>Started</span>
              <span>Trigger</span>
              <span>Status</span>
              <span>Passed</span>
              <span>Failed</span>
            </div>
            {runs.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No collection runs yet.</span></div>
            )}
            {runs.map(r => (
              <div key={r.id} className="admin-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
                <span style={{ fontSize: 12 }}>{new Date(r.startedAt).toLocaleString()}</span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{r.triggerType}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: RUN_STATUS_COLOR[r.status] || "var(--text3)" }}>{r.status}</span>
                <span style={{ fontSize: 12, color: "var(--green)" }}>{r.testsPassed}</span>
                <span style={{ fontSize: 12, color: r.testsFailed > 0 ? "var(--red)" : "var(--text3)" }}>{r.testsFailed}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
