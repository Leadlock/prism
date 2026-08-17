import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";

const SEVERITY_COLOR = {
  critical: "var(--red)",
  high:     "var(--red)",
  medium:   "var(--amber)",
  low:      "var(--text3)",
};

const STATUS_OPTIONS = ["open", "acknowledged", "resolved", "suppressed", "false_positive"];

function SeverityPill({ severity }) {
  const color = SEVERITY_COLOR[severity] || "var(--text3)";
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color, textTransform: "uppercase",
      background: `${color}18`, padding: "2px 8px", borderRadius: 20, border: `1px solid ${color}40`
    }}>
      {severity}
    </span>
  );
}

export default function Findings({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (severityFilter) params.set("severity", severityFilter);
    if (statusFilter) params.set("status", statusFilter);
    const qs = params.toString();
    const data = await apiFetch(`/api/findings${qs ? `?${qs}` : ""}`, { token });
    setFindings(data || []);
  }, [token, severityFilter, statusFilter]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  const handleStatusChange = async (findingId, status) => {
    setBusyId(findingId);
    setError("");
    try {
      await apiFetch(`/api/findings/${findingId}`, { token, method: "PUT", body: JSON.stringify({ status }) });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handlePromote = async (findingId) => {
    setBusyId(findingId);
    setError("");
    try {
      await apiFetch(`/api/findings/${findingId}/promote`, { token, method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Findings</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            {isLeadOrAdmin && <button className="btn btn-ghost" onClick={() => navigate("/settings/integrations")}>Integrations</button>}
            <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: "flex", gap: 12, marginTop: 16, marginBottom: 8 }}>
          <select className="month-selector" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="month-selector" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="admin-table">
          <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2.5fr 1fr 1fr 2fr" }}>
            <span>Finding</span>
            <span>Severity</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {findings.length === 0 && (
            <div className="admin-row admin-row-empty"><span>No findings match these filters.</span></div>
          )}
          {findings.map(f => (
            <div key={f.id} className="admin-row" style={{ gridTemplateColumns: "2.5fr 1fr 1fr 2fr" }}>
              <span>
                <div style={{ fontWeight: 600 }}>{f.title}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>{f.resourceId}</div>
              </span>
              <span><SeverityPill severity={f.severity} /></span>
              <span style={{ fontSize: 12 }}>{f.status}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {isLeadOrAdmin && f.status === "open" && (
                  <button className="btn btn-ghost" disabled={busyId === f.id} onClick={() => handleStatusChange(f.id, "acknowledged")}>Acknowledge</button>
                )}
                {isLeadOrAdmin && f.status !== "suppressed" && f.status !== "resolved" && (
                  <button className="btn btn-ghost" disabled={busyId === f.id} onClick={() => handleStatusChange(f.id, "suppressed")}>Suppress</button>
                )}
                {isLeadOrAdmin && !f.linkedActionId && (
                  <button className="btn btn-primary" disabled={busyId === f.id} onClick={() => handlePromote(f.id)}>Create Remediation Action</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
