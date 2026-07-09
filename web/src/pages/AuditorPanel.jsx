import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";

const fmt       = (d) => d ? new Date(d).toLocaleDateString() : "—";
const isoDate   = (d) => new Date(d).toISOString().slice(0, 10);
const today     = () => isoDate(Date.now());

const UNITS = [
  { value: "days",   label: "days" },
  { value: "weeks",  label: "weeks" },
  { value: "months", label: "months" }
];

function addDuration(startIso, amount, unit) {
  const d = new Date(startIso);
  const n = parseInt(amount) || 0;
  if (unit === "days")   d.setDate(d.getDate() + n);
  if (unit === "weeks")  d.setDate(d.getDate() + n * 7);
  if (unit === "months") d.setMonth(d.getMonth() + n);
  return isoDate(d);
}

function durationLabel(startIso, expiryIso) {
  const ms   = new Date(expiryIso) - new Date(startIso);
  const days = Math.round(ms / 86400000);
  if (days % 30 === 0 && days >= 30) return `${days / 30} month${days / 30 !== 1 ? "s" : ""}`;
  if (days % 7  === 0 && days >= 7)  return `${days / 7} week${days / 7 !== 1 ? "s" : ""}`;
  return `${days} day${days !== 1 ? "s" : ""}`;
}

function DurationPicker({ startDate, value, unit, onChange }) {
  const expiry = addDuration(startDate, value, unit);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="number" min="1" max="365" required
          value={value}
          onChange={e => onChange({ value: e.target.value, unit })}
          style={{
            width: 72, padding: "9px 10px",
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: 6, color: "var(--text)", fontSize: 14,
            fontFamily: "var(--mono)"
          }}
        />
        <select
          value={unit}
          onChange={e => onChange({ value, unit: e.target.value })}
          style={{
            flex: 1, padding: "9px 10px",
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: 6, color: "var(--text)", fontSize: 14,
            fontFamily: "var(--sans)"
          }}
        >
          {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>
        expires {fmt(expiry)} &nbsp;·&nbsp; {durationLabel(startDate, expiry)}
      </div>
    </div>
  );
}

function ReactivateModal({ auditor, onConfirm, onClose }) {
  const [dur, setDur] = useState({ value: "14", unit: "days" });
  const start  = today();
  const expiry = addDuration(start, dur.value, dur.unit);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Reactivate auditor</div>
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 16 }}>
          {auditor.email}
        </div>
        <div className="form-group">
          <label>New active period</label>
          <DurationPicker startDate={start} value={dur.value} unit={dur.unit} onChange={setDur} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button className="btn btn-primary" onClick={() => onConfirm(expiry)}>Reactivate</button>
          <button className="btn btn-ghost"   onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function AuditorPanel({ token, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const [auditors,  setAuditors]  = useState([]);
  const [logs,      setLogs]      = useState([]);
  const [logTotal,  setLogTotal]  = useState(0);
  const [tab,       setTab]       = useState("auditors");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(true);
  const [reactivating, setReactivating] = useState(null); // auditor object | null

  const [form, setForm] = useState({
    email:     "",
    password:  "",
    startDate: today(),
    dur:       { value: "14", unit: "days" }
  });
  const [creating, setCreating] = useState(false);

  const loadAuditors = useCallback(async () => {
    const data = await apiFetch("/api/auditors", { token });
    setAuditors(data || []);
  }, [token]);

  const loadLogs = useCallback(async () => {
    const data = await apiFetch("/api/auditors/logs?limit=100", { token });
    setLogs(data.logs || []);
    setLogTotal(data.total || 0);
  }, [token]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAuditors(), loadLogs()])
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadAuditors, loadLogs]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    const expiryDate = addDuration(form.startDate, form.dur.value, form.dur.unit);
    try {
      await apiFetch("/api/auditors", {
        token, method: "POST",
        body: JSON.stringify({ email: form.email, password: form.password, startDate: form.startDate, expiryDate })
      });
      setForm({ email: "", password: "", startDate: today(), dur: { value: "14", unit: "days" } });
      await loadAuditors();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (id) => {
    if (!window.confirm("Deactivate this auditor?")) return;
    try {
      await apiFetch(`/api/auditors/${id}`, { token, method: "PUT", body: JSON.stringify({ active: false }) });
      await Promise.all([loadAuditors(), loadLogs()]);
    } catch (err) { setError(err.message); }
  };

  const handleReactivateConfirm = async (expiryDate) => {
    try {
      await apiFetch(`/api/auditors/${reactivating.id}`, {
        token, method: "PUT",
        body: JSON.stringify({ active: true, expiryDate })
      });
      setReactivating(null);
      await Promise.all([loadAuditors(), loadLogs()]);
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Permanently delete this auditor account?")) return;
    try {
      await apiFetch(`/api/auditors/${id}`, { token, method: "DELETE" });
      await Promise.all([loadAuditors(), loadLogs()]);
    } catch (err) { setError(err.message); }
  };

  const statusOf = (a) => {
    if (!a.active) return { text: "Inactive", color: "var(--red)" };
    if (new Date(a.expiryDate) < new Date()) return { text: "Expired", color: "var(--amber)" };
    return { text: "Active", color: "var(--green)" };
  };

  const actionColor = (action) => {
    if (action.includes("DELETE") || action.includes("DEACTIVATED")) return "var(--red)";
    if (action.includes("EXPIRED"))  return "var(--amber)";
    if (action.includes("CREATED"))  return "var(--green)";
    return "var(--accent2)";
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      {reactivating && (
        <ReactivateModal
          auditor={reactivating}
          onConfirm={handleReactivateConfirm}
          onClose={() => setReactivating(null)}
        />
      )}

      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Auditor management</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/admin")}>Admin</button>
            <button className="btn btn-ghost" onClick={() => navigate("/tracker")}>Tracker</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 20, borderBottom: "1px solid var(--border)" }}>
          {["auditors", "logs"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 16px", fontSize: 13, fontWeight: 500,
              color: tab === t ? "var(--accent2)" : "var(--text2)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              fontFamily: "var(--sans)"
            }}>
              {t === "auditors" ? `Auditors (${auditors.length})` : `Audit log (${logTotal})`}
            </button>
          ))}
        </div>

        {/* ── AUDITORS TAB ── */}
        {tab === "auditors" && (
          <>
            <section className="admin-section">
              <h2>Create auditor account</h2>
              <form onSubmit={handleCreate}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email" required
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Temporary password</label>
                    <input
                      type="password" required minLength={8}
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Access starts</label>
                    <input
                      type="date" required
                      value={form.startDate}
                      onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Active period</label>
                    <DurationPicker
                      startDate={form.startDate}
                      value={form.dur.value}
                      unit={form.dur.unit}
                      onChange={dur => setForm(f => ({ ...f, dur }))}
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={creating} style={{ marginTop: 12 }}>
                  {creating ? "Creating…" : "Create auditor"}
                </button>
              </form>
            </section>

            <section className="admin-section">
              <h2>Auditor accounts</h2>
              <div className="admin-table">
                <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
                  <span>Email</span>
                  <span>Start</span>
                  <span>Expires</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {auditors.length === 0 && (
                  <div className="admin-row admin-row-empty"><span>No auditor accounts yet.</span></div>
                )}
                {auditors.map(a => {
                  const { text, color } = statusOf(a);
                  const isActive = a.active && new Date(a.expiryDate) >= new Date();
                  return (
                    <div key={a.id} className="admin-row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{a.email}</span>
                      <span style={{ fontSize: 12 }}>{fmt(a.startDate)}</span>
                      <span style={{ fontSize: 12 }}>
                        {fmt(a.expiryDate)}
                        <span style={{ display: "block", fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                          {durationLabel(a.startDate, a.expiryDate)}
                        </span>
                      </span>
                      <span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color,
                          background: `${color}18`, padding: "2px 8px",
                          borderRadius: 20, border: `1px solid ${color}40`
                        }}>
                          {text}
                        </span>
                      </span>
                      <span style={{ display: "flex", gap: 6 }}>
                        {isActive ? (
                          <button className="btn btn-ghost" onClick={() => handleDeactivate(a.id)}>Deactivate</button>
                        ) : (
                          <button className="btn btn-ghost" onClick={() => setReactivating(a)}>Reactivate</button>
                        )}
                        <button className="btn btn-ghost" style={{ color: "var(--red)" }} onClick={() => handleDelete(a.id)}>Delete</button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {/* ── AUDIT LOG TAB ── */}
        {tab === "logs" && (
          <section className="admin-section">
            <h2>Audit log</h2>
            <div className="admin-table">
              <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr" }}>
                <span>Email</span>
                <span>Action</span>
                <span>Resource</span>
                <span>IP</span>
                <span>Time</span>
              </div>
              {logs.length === 0 && (
                <div className="admin-row admin-row-empty"><span>No audit events yet.</span></div>
              )}
              {logs.map(log => (
                <div key={log.id} className="admin-row" style={{ gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{log.email || "—"}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, fontFamily: "var(--mono)",
                    color: actionColor(log.action), textTransform: "uppercase", letterSpacing: "0.04em"
                  }}>
                    {log.action}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text2)" }}>{log.resource || "—"}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)" }}>{log.ip || "—"}</span>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>{new Date(log.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
