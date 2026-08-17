import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiDownload } from "../api/client.js";
import { BarChart, DonutChart, StackedBarChart } from "../components/Charts.jsx";
import ExportMenu from "../components/ExportMenu.jsx";
import Logo from "../components/Logo";
import NotificationBell from "../components/NotificationBell.jsx";

const WIDGET_DEFS = [
  { id: "overall-completion", cls: "dash-card" },
  { id: "maturity-dist",      cls: "dash-card dash-card-wide" },
  { id: "module-bar",         cls: "dash-card dash-card-wide" },
  { id: "module-donuts",      cls: "",          style: { gridColumn: "1 / -1" } },
  { id: "answer-dist",        cls: "dash-card" },
  { id: "evidence-coverage",  cls: "dash-card dash-card-wide" },
  { id: "action-status",      cls: "dash-card" },
  { id: "evidence-requests",  cls: "dash-card" },
  { id: "evidence-vault",     cls: "dash-card" },
  { id: "score-eligible",     cls: "dash-card" },
  { id: "notes-coverage",     cls: "dash-card" },
  { id: "recently-reviewed",  cls: "dash-card dash-card-wide" },
  { id: "rejected-controls",  cls: "dash-card dash-card-wide" },
];
const DEFAULT_WIDGET_ORDER = WIDGET_DEFS.map(w => w.id);

export default function Dashboard({ token, user, company, onLogout, theme, onThemeToggle, isVerified }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState(null);
  const [moduleData, setModuleData] = useState(null);
  const [moduleError, setModuleError] = useState("");
  const [loadingModule, setLoadingModule] = useState(false);
  const [auditorNotesModal, setAuditorNotesModal] = useState(null);
  const auditorNotesRef = useRef("");
  const [reviewLockedOpen, setReviewLockedOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dashPriorityFilter, setDashPriorityFilter] = useState("");
  const [dashTagFilter, setDashTagFilter] = useState("");
  const [dashOwnerFilter, setDashOwnerFilter] = useState("");
  const [dashStatusFilter, setDashStatusFilter] = useState("");
  const [availableTags, setAvailableTags] = useState([]);
  const [availableOwners, setAvailableOwners] = useState([]);

  // Widget drag-and-drop order (persisted to localStorage)
  const [widgetOrder, setWidgetOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("prism-widget-order") || "null");
      if (!saved) return DEFAULT_WIDGET_ORDER;
      const merged = saved.filter(id => DEFAULT_WIDGET_ORDER.includes(id));
      DEFAULT_WIDGET_ORDER.forEach(id => { if (!merged.includes(id)) merged.push(id); });
      return merged;
    } catch { return DEFAULT_WIDGET_ORDER; }
  });
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dashMenuOpen, setDashMenuOpen] = useState(false);

  const saveOrder = (next) => {
    setWidgetOrder(next);
    try { localStorage.setItem("prism-widget-order", JSON.stringify(next)); } catch {}
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const next = [...widgetOrder];
    const fi = next.indexOf(dragId);
    const ti = next.indexOf(targetId);
    next.splice(fi, 1);
    next.splice(ti, 0, dragId);
    saveOrder(next);
    setDragId(null); setDragOverId(null);
  };

  const resetLayout = () => saveOrder(DEFAULT_WIDGET_ORDER);

  const generateMonthOptions = () => {
    const options = [];
    for (let year = new Date().getFullYear() + 1; year >= 2023; year--) {
      for (let month = 12; month >= 1; month--) {
        options.push(`${year}-${String(month).padStart(2, '0')}`);
      }
    }
    return options;
  };

  // Load filter options (tags, owners) from the sheet once on mount
  useEffect(() => {
    apiFetch("/api/questions", { token })
      .then(qs => {
        const tags = new Set();
        const owners = new Set();
        for (const q of qs || []) {
          if (q.tags) q.tags.split(",").forEach(t => { const s = t.trim(); if (s) tags.add(s); });
          if (q.defaultOwner || q.default_owner) owners.add(q.defaultOwner || q.default_owner);
        }
        setAvailableTags([...tags].sort());
        setAvailableOwners([...owners].sort());
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    let url = `/api/dashboard?month=${selectedMonth}`;
    if (dashPriorityFilter) url += `&priority=${encodeURIComponent(dashPriorityFilter)}`;
    if (dashTagFilter) url += `&tag=${encodeURIComponent(dashTagFilter)}`;
    if (dashOwnerFilter) url += `&owner=${encodeURIComponent(dashOwnerFilter)}`;
    if (dashStatusFilter) url += `&status=${encodeURIComponent(dashStatusFilter)}`;
    apiFetch(url, { token })
      .then(data => { if (active) { setStats(data); setLoading(false); } })
      .catch(err => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [token, selectedMonth, dashPriorityFilter, dashTagFilter, dashOwnerFilter, dashStatusFilter]);

  const isAdmin       = user?.role === "ADMIN";
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const isAuditor     = user?.role === "AUDITOR";

  const openModule = async (module) => {
    setSelectedModule(module);
    setModuleData(null);
    setModuleError("");
    setLoadingModule(true);
    try {
      const [questions, assessments, evidence] = await Promise.all([
        apiFetch(`/api/questions?moduleId=${encodeURIComponent(module.moduleId)}`, { token }),
        apiFetch(`/api/assessments?moduleId=${encodeURIComponent(module.moduleId)}&month=${selectedMonth}`, { token }),
        apiFetch(`/api/evidence?moduleId=${encodeURIComponent(module.moduleId)}&month=${selectedMonth}`, { token })
      ]);
      setModuleData({
        questions:   questions   || [],
        assessments: assessments || [],
        evidence:    evidence    || [],
      });
    } catch (err) {
      setModuleError(err.message || "Failed to load module data");
    } finally {
      setLoadingModule(false);
    }
  };

  const closeModule = () => {
    setSelectedModule(null);
    setModuleData(null);
    setModuleError("");
  };

  const promptAuditorApproval = (assessmentId, status) => {
    auditorNotesRef.current = "";
    setAuditorNotesModal({ assessmentId, status });
  };

  const confirmAuditorApproval = async () => {
    const { assessmentId, status } = auditorNotesModal;
    const notes = auditorNotesRef.current;
    setAuditorNotesModal(null);
    await updateAssessmentStatus(assessmentId, status, notes);
  };

  const updateAssessmentStatus = async (assessmentId, status, auditorNotes) => {
    const moduleId = selectedModule?.moduleId;
    try {
      const response = await apiFetch(`/api/assessments/${assessmentId}`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          reviewStatus: status,
          auditedBy: user?.email,
          auditorNotes: auditorNotes || undefined
        })
      });

      if (!response) throw new Error("Failed to update assessment");

      const [questions, assessments, evidence] = await Promise.all([
        apiFetch(`/api/questions?moduleId=${encodeURIComponent(moduleId)}`, { token }),
        apiFetch(`/api/assessments?moduleId=${encodeURIComponent(moduleId)}&month=${selectedMonth}`, { token }),
        apiFetch(`/api/evidence?moduleId=${encodeURIComponent(moduleId)}&month=${selectedMonth}`, { token })
      ]);
      setModuleData({
        questions:   questions   || [],
        assessments: assessments || [],
        evidence:    evidence    || []
      });

      const dashData = await apiFetch(`/api/dashboard?month=${selectedMonth}`, { token });
      setStats(dashData);
    } catch (err) {
      setError(err.message);
    }
  };

  const viewEvidence = async (id, filename) => {
    try {
      const endpoint = isAuditor ? `/api/evidence/${id}/view` : `/api/evidence/${id}/download`;
      const res = await fetch(apiDownload(endpoint), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(`Error viewing file: ${e.message}`);
      setError(e.message || "Failed to view file");
    }
  };

  const renderWidget = (id) => {
    if (!stats) return null;

    switch (id) {

      case "overall-completion":
        return (
          <>
            <div className="dash-card-title">Overall completion</div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val">{stats.overall.total}</div>
                <div className="dash-kpi-label">Total</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--amber)" }}>{stats.overall.assessed}</div>
                <div className="dash-kpi-label">Assessed</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--green)" }}>{stats.overall.finished}</div>
                <div className="dash-kpi-label">Finished</div>
              </div>
            </div>
            <DonutChart
              size={130}
              segments={[
                { label: "Finished",    value: stats.overall.finished, color: "var(--green)" },
                { label: "In progress", value: Math.max(0, stats.overall.assessed - stats.overall.finished), color: "var(--amber)" },
                { label: "Not started", value: Math.max(0, stats.overall.total - Math.max(stats.overall.assessed, stats.overall.finished)), color: "var(--bg4)" }
              ]}
            />
          </>
        );

      case "maturity-dist": {
        const md = stats.maturityDistribution || {};
        const levels = [
          { key: "l1", label: "L1 — Ad-hoc",     color: "var(--red)" },
          { key: "l2", label: "L2 — Repeatable",  color: "var(--amber)" },
          { key: "l3", label: "L3 — Defined",     color: "var(--teal)" },
          { key: "l4", label: "L4 — Managed",     color: "var(--accent2)" },
          { key: "l5", label: "L5 — Optimised",   color: "var(--green)" },
        ];
        const total = levels.reduce((s, l) => s + (md[l.key] || 0), 0);
        return (
          <>
            <div className="dash-card-title">Maturity Distribution</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              {levels.map(({ key, label, color }) => {
                const val = md[key] || 0;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 120, fontSize: 12, color: "var(--text2)", flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1, background: "var(--bg4)", borderRadius: 4, height: 10, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
                    </div>
                    <div style={{ width: 40, fontSize: 12, color: "var(--text2)", textAlign: "right", flexShrink: 0 }}>{val}</div>
                  </div>
                );
              })}
              {total === 0 && (
                <p className="muted" style={{ marginTop: 4 }}>No assessments recorded for this period.</p>
              )}
            </div>
          </>
        );
      }

      case "module-bar":
        return (
          <>
            <div className="dash-card-title">Per-module completion</div>
            <div className="chart-legend-row">
              <span className="chart-legend-dot" style={{ background: "var(--green)" }} />
              <span style={{ fontSize: 11, color: "var(--text2)" }}>Finished</span>
              <span className="chart-legend-dot" style={{ background: "var(--amber)", marginLeft: 12 }} />
              <span style={{ fontSize: 11, color: "var(--text2)" }}>Assessed</span>
            </div>
            <StackedBarChart
              data={stats.moduleCompletion.map(m => ({
                label: m.moduleId,
                finished: m.finished,
                assessed: m.assessed,
                total: m.total
              }))}
            />
          </>
        );

      case "module-donuts":
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 20 }}>
            {stats.moduleCompletion.map((module, idx) => {
              const assessedNotFinished = Math.max(0, module.assessed - module.finished);
              const notStarted = Math.max(0, module.total - Math.max(module.assessed, module.finished));
              return (
                <div
                  key={idx}
                  className="dash-card"
                  style={{ cursor: "pointer", margin: 0 }}
                  onClick={() => openModule(module)}
                >
                  <div className="dash-card-title">{module.moduleId}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14, lineHeight: 1.4 }}>
                    {module.name}
                  </div>
                  <DonutChart
                    size={110}
                    segments={[
                      { label: "Finished",    value: module.finished,         color: "var(--green)" },
                      { label: "In progress", value: assessedNotFinished,     color: "var(--amber)" },
                      { label: "Not started", value: notStarted,              color: "var(--bg4)" }
                    ]}
                  />
                  <div style={{ marginTop: 12, fontSize: 11, color: "var(--text3)", textAlign: "center" }}>
                    {module.finished} / {module.total} completed
                  </div>
                </div>
              );
            })}
          </div>
        );

      case "answer-dist":
        return (
          <>
            <div className="dash-card-title">Answer distribution</div>
            <DonutChart
              size={130}
              segments={[
                { label: "Implemented",        value: stats.answerDistribution.find(a => a.answer === "IMPLEMENTED")?.count || 0,           color: "var(--green)" },
                { label: "Not Implemented",    value: stats.answerDistribution.find(a => a.answer === "NOT_IMPLEMENTED")?.count || 0,       color: "var(--red)" },
                { label: "Partial",            value: stats.answerDistribution.find(a => a.answer === "PARTIALLY_IMPLEMENTED")?.count || 0, color: "var(--amber)" },
                { label: "Planned",            value: stats.answerDistribution.find(a => a.answer === "PLANNED")?.count || 0,               color: "var(--blue, #3b82f6)" },
                { label: "Not Applicable",     value: stats.answerDistribution.find(a => a.answer === "NOT_APPLICABLE")?.count || 0,        color: "var(--text3)" }
              ]}
            />
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text3)", textAlign: "center" }}>
              {stats.overall.assessed} assessments completed
            </div>
          </>
        );

      case "evidence-coverage":
        return (
          <>
            <div className="dash-card-title">Evidence coverage</div>
            <BarChart
              data={stats.evidenceCoverage.map(e => ({ label: e.moduleId, value: e.covered, total: e.total }))}
              valueKey="value"
              labelKey="label"
              color="var(--teal)"
              maxValue={Math.max(...stats.evidenceCoverage.map(e => e.total), 1)}
            />
          </>
        );

      case "action-status":
        return (
          <>
            <div className="dash-card-title">Action status</div>
            {stats.actionStatus.length === 0 ? (
              <p className="muted" style={{ marginTop: 8 }}>No actions recorded.</p>
            ) : (
              <BarChart
                data={stats.actionStatus.map(a => ({ label: a.status || "OPEN", value: a.count }))}
                valueKey="value"
                labelKey="label"
                color="var(--accent)"
              />
            )}
          </>
        );

      case "evidence-requests":
        if (!stats.requestMetrics) return null;
        return (
          <div onClick={() => navigate("/requests")} style={{ height: "100%", cursor: "pointer" }}>
            <div className="dash-card-title">Evidence Requests</div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--accent)" }}>{stats.requestMetrics.open}</div>
                <div className="dash-kpi-label">Open</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--red)" }}>{stats.requestMetrics.overdue}</div>
                <div className="dash-kpi-label">Overdue</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--green)" }}>{stats.requestMetrics.completed}</div>
                <div className="dash-kpi-label">Completed</div>
              </div>
            </div>
            {stats.requestMetrics.byUser?.length > 0 && (
              <div style={{ marginTop: 10, borderTop: "1px solid var(--border2)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>By Assignee</div>
                {stats.requestMetrics.byUser.map((u, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>{u.name}</span>
                    <span style={{ color: "var(--text3)", fontWeight: 600, flexShrink: 0 }}>{u.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case "evidence-vault":
        if (!stats.vaultMetrics) return null;
        return (
          <div onClick={() => navigate("/vault")} style={{ height: "100%", cursor: "pointer" }}>
            <div className="dash-card-title">Evidence Vault</div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--teal)" }}>{stats.vaultMetrics.totalVersions}</div>
                <div className="dash-kpi-label">Total Versions</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--accent)" }}>{stats.vaultMetrics.updatedThisMonth}</div>
                <div className="dash-kpi-label">Updated This Month</div>
              </div>
            </div>
            {stats.vaultMetrics.latestModifiedTitle && (
              <div style={{ marginTop: 10, borderTop: "1px solid var(--border2)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Last Modified</div>
                <div style={{ fontSize: 12, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stats.vaultMetrics.latestModifiedTitle}</div>
                {stats.vaultMetrics.latestModifiedAt && (
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                    {new Date(stats.vaultMetrics.latestModifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case "score-eligible":
        if (stats.scoreEligible === undefined) return null;
        return (
          <>
            <div className="dash-card-title">Score-Eligible Controls</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
              <DonutChart
                segments={[
                  { label: "Eligible", value: stats.scoreEligible.count, color: "var(--green)" },
                  { label: "Other",    value: Math.max(0, stats.scoreEligible.total - stats.scoreEligible.count), color: "var(--bg4)" }
                ]}
                size={80}
              />
              <div>
                <div className="dash-kpi-val" style={{ color: "var(--green)" }}>{stats.scoreEligible.count}</div>
                <div className="dash-kpi-label">of {stats.scoreEligible.total} controls</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
                  {stats.scoreEligible.total > 0
                    ? `${Math.round((stats.scoreEligible.count / stats.scoreEligible.total) * 100)}% eligible`
                    : "No controls yet"}
                </div>
              </div>
            </div>
          </>
        );

      case "notes-coverage":
        if (!stats.notesMetrics) return null;
        return (
          <>
            <div className="dash-card-title">Notes coverage</div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--teal)" }}>{stats.notesMetrics.withNotes}</div>
                <div className="dash-kpi-label">📝 Internal Notes</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--amber)" }}>{stats.notesMetrics.withReviewerNotes}</div>
                <div className="dash-kpi-label">👁 Reviewer Notes</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--text3)" }}>{stats.notesMetrics.withoutAnyNotes}</div>
                <div className="dash-kpi-label">No Notes</div>
              </div>
            </div>
          </>
        );

      case "recently-reviewed": {
        const items = stats.recentlyReviewed || [];
        if (items.length === 0) return null;
        const fmtTime = (iso) => {
          if (!iso) return "";
          const diff = Date.now() - new Date(iso).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        };
        return (
          <>
            <div className="dash-card-title">Recent Reviews</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {items.map(item => {
                const approved = item.reviewStatus === "FINISHED";
                return (
                  <div key={item.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 10px", borderRadius: 7,
                    background: approved ? "rgba(34,197,94,0.06)" : "rgba(245,158,11,0.06)",
                    border: `1px solid ${approved ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)"}`,
                  }}>
                    <span style={{ fontSize: 13, flexShrink: 0, color: approved ? "var(--green)" : "var(--amber)" }}>
                      {approved ? "✓" : "✗"}
                    </span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent2)", flexShrink: 0, fontWeight: 700 }}>
                      {item.questId}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.controlArea || item.moduleId}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0, whiteSpace: "nowrap" }}>
                      {item.reviewedBy?.split("@")[0]}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0, whiteSpace: "nowrap" }}>
                      {fmtTime(item.reviewedAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        );
      }

      case "rejected-controls": {
        const items = stats.rejectedControls || [];
        const fmtTime = (iso) => {
          if (!iso) return "";
          const diff = Date.now() - new Date(iso).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        };
        return (
          <>
            <div className="dash-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Rejected Controls
              {items.length > 0 && (
                <span style={{
                  background: "var(--red, #ef4444)", color: "#fff",
                  borderRadius: 10, minWidth: 20, height: 20, padding: "0 6px",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>{items.length}</span>
              )}
            </div>
            {items.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, color: "var(--green)" }}>
                <span style={{ fontSize: 16 }}>✓</span>
                <span style={{ fontSize: 13 }}>No rejected controls</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {items.map(item => {
                  const byAuditor = item.auditorNotes && item.auditorNotes.trim();
                  const rejectorEmail = byAuditor ? item.auditedBy : item.reviewedBy;
                  const rejectorLabel = byAuditor ? "Auditor" : "Reviewer";
                  const reason = byAuditor ? item.auditorNotes : item.reviewerNotes;
                  const rejectedAt = byAuditor ? item.auditedAt : item.reviewedAt;
                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: "10px 12px", borderRadius: 8,
                        background: "rgba(239,68,68,0.05)",
                        border: "1px solid rgba(239,68,68,0.18)",
                        cursor: "pointer",
                      }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/tracker?quest=${encodeURIComponent(item.questId)}`); }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: reason ? 5 : 0 }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--red, #ef4444)", fontWeight: 700, flexShrink: 0 }}>
                          ✗ {item.questId}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {item.controlArea}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0, background: "var(--bg4)", padding: "2px 6px", borderRadius: 4 }}>
                          {rejectorLabel}
                        </span>
                        {rejectedAt && (
                          <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0, whiteSpace: "nowrap" }}>
                            {fmtTime(rejectedAt)}
                          </span>
                        )}
                      </div>
                      {reason && (
                        <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>
                          <span style={{ color: "var(--text3)", fontSize: 11 }}>
                            {rejectorEmail?.split("@")[0] || rejectorLabel}:{" "}
                          </span>
                          {reason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="dash-shell fade-in" id="print-area">
      <div className="dash-header no-print">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ height: 48, overflow: "hidden", display: "flex", alignItems: "center" }}>
            <Logo style={{ height: 68, display: "block", transform: "scale(0.85)", transformOrigin: "center center" }} />
          </div>
          {company?.name && <div className="dash-sub" style={{ fontSize: 14, color: "var(--text2)" }}>{company.name}</div>}
        </div>
        <div className="dash-header-actions">
          {/* Month */}
          <select className="month-selector" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
            {generateMonthOptions().map(month => (
              <option key={month} value={month}>
                {new Date(month + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
              </option>
            ))}
          </select>
          {/* Filters */}
          <select className="month-selector" value={dashStatusFilter} onChange={(e) => setDashStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="IMPLEMENTED">Implemented</option>
            <option value="PARTIALLY_IMPLEMENTED">Partially Implemented</option>
            <option value="PLANNED">Planned</option>
            <option value="NOT_IMPLEMENTED">Not Implemented</option>
            <option value="NOT_APPLICABLE">Not Applicable</option>
          </select>
          <select className="month-selector" value={dashPriorityFilter} onChange={(e) => setDashPriorityFilter(e.target.value)}>
            <option value="">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          {availableOwners.length > 0 && (
            <select className="month-selector" value={dashOwnerFilter} onChange={(e) => setDashOwnerFilter(e.target.value)}>
              <option value="">All Owners</option>
              {availableOwners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {availableTags.length > 0 && (
            <select className="month-selector" value={dashTagFilter} onChange={(e) => setDashTagFilter(e.target.value)}>
              <option value="">All Tags</option>
              {availableTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {/* Core actions */}
          <NotificationBell token={token} />
          {!isAuditor && <button className="btn btn-ghost" onClick={() => navigate("/tracker")}>Tracker</button>}
          {stats && <ExportMenu stats={stats} company={company} />}
          {/* ⋮ overflow menu */}
          <div style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              style={{ padding: "6px 10px", fontSize: 18, lineHeight: 1 }}
              onClick={() => setDashMenuOpen(v => !v)}
              title="More"
            >⋮</button>
            {dashMenuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 1999 }} onClick={() => setDashMenuOpen(false)} />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 2000,
                  background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.18)", minWidth: 160, padding: "6px 0",
                }}>
                  {isAdmin && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/admin"); }}>Admin</button>}
                  {isAdmin && isVerified !== false && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/auditors"); }}>Auditors</button>}
                  {isLeadOrAdmin && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); isVerified === false ? setReviewLockedOpen(true) : navigate("/review"); }}>Review</button>}
                  {isLeadOrAdmin && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/settings/integrations"); }}>Integrations</button>}
                  <div style={{ height: 1, background: "var(--border2)", margin: "4px 0" }} />
                  <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); resetLayout(); }}>⊞ Reset Layout</button>
                  <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); onThemeToggle(); }}>{theme === "dark" ? "☀ Light mode" : "☾ Dark mode"}</button>
                  <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13, color: "var(--red, #ef4444)" }} onClick={() => { setDashMenuOpen(false); onLogout(); }}>Logout</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {(dashPriorityFilter || dashTagFilter || dashOwnerFilter || dashStatusFilter) && !loading && (
        <div style={{
          margin: "0 28px 16px",
          padding: "8px 14px",
          background: "rgba(99,102,241,0.08)",
          border: "1px solid rgba(99,102,241,0.25)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: "var(--text2)",
        }}>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>Filtered:</span>
          {dashStatusFilter && <span>Status: <strong>{dashStatusFilter.replace(/_/g, " ")}</strong></span>}
          {dashPriorityFilter && <span>Priority: <strong>{dashPriorityFilter}</strong></span>}
          {dashOwnerFilter && <span>Owner: <strong>{dashOwnerFilter}</strong></span>}
          {dashTagFilter && <span>Tag: <strong>{dashTagFilter}</strong></span>}
          {stats?.overall?.total === 0 && (
            <span style={{ color: "var(--red, #ef4444)", marginLeft: 4 }}>— no questions match this filter</span>
          )}
          <button
            onClick={() => { setDashTagFilter(""); setDashPriorityFilter(""); setDashOwnerFilter(""); setDashStatusFilter(""); }}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 13 }}
          >
            ✕ Clear filters
          </button>
        </div>
      )}
      {error && <div className="error-text" style={{ padding: "0 28px 16px" }}>{error}</div>}

      {loading ? (
        <div className="tracker-loading">
          <div className="loading-spinner" />
          <p>Loading dashboard…</p>
        </div>
      ) : stats ? (
        <div className="dash-grid">
          {widgetOrder.map(id => {
            const def = WIDGET_DEFS.find(w => w.id === id);
            if (!def) return null;
            const content = renderWidget(id);
            if (content === null) return null;
            const isDragging = dragId === id;
            const isOver    = dragOverId === id;
            return (
              <div
                key={id}
                className={def.cls}
                style={{
                  ...(def.style || {}),
                  opacity:    isDragging ? 0.35 : 1,
                  outline:    isOver ? "2px solid var(--accent)" : undefined,
                  outlineOffset: 2,
                  cursor:     "grab",
                  transition: "opacity 0.15s",
                  userSelect: "none",
                }}
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(id); }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverId(id); }}
                onDrop={(e) => handleDrop(e, id)}
                onDragEnd={() => { setDragId(null); setDragOverId(null); }}
              >
                {content}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Module Detail Modal */}
      {selectedModule && (
        <div className="modal-overlay" onClick={closeModule}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <div className="module-modal-header">
              <div>
                <div className="module-modal-title">{selectedModule.moduleId}</div>
                <div className="module-modal-subtitle">{selectedModule.name}</div>
              </div>
              <button className="modal-close" onClick={closeModule}>×</button>
            </div>

            <div className="module-modal-content">
              {loadingModule ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
                  <div className="loading-spinner" />
                  <p style={{ marginTop: 16 }}>Loading module data...</p>
                </div>
              ) : moduleError ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
                  <p style={{ fontWeight: 600 }}>Failed to load module</p>
                  <p style={{ fontSize: 13, marginTop: 8, color: "var(--text2)" }}>{moduleError}</p>
                </div>
              ) : moduleData && moduleData.questions.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 14 }}>
                  No questions found for this module.
                </div>
              ) : moduleData ? (
                <div className="quest-details-list">
                  {moduleData.questions
                    .filter(q => {
                      if (dashPriorityFilter && q.priority !== dashPriorityFilter) return false;
                      if (dashTagFilter) {
                        const qTags = (q.tags || '').split(',').map(t => t.trim());
                        if (!qTags.includes(dashTagFilter)) return false;
                      }
                      return true;
                    })
                    .map(q => {
                      const qId = q.questId || q.quest_id;
                      const assessment = (moduleData.assessments || []).find(a =>
                        (a.questId || a.quest_id) === qId
                      );
                      const ev = (moduleData.evidence || []).filter(e => e.questId === q.questId);
                      const statusColor = assessment?.review_status === "FINISHED" || assessment?.reviewStatus === "FINISHED"
                        ? "var(--green)"
                        : assessment ? "var(--amber)" : "var(--text3)";

                      return (
                        <div key={q.questId || q.quest_id} className="quest-detail-item">
                          <div className="quest-detail-header">
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                                {q.questId || q.quest_id}: {q.controlArea || q.control_area}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                                {q.baselineQuestion || q.baseline_question}
                              </div>
                              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                                {q.priority && (
                                  <span className={`priority-badge priority-${(q.priority || '').toLowerCase()}`}>
                                    {q.priority}
                                  </span>
                                )}
                                {(q.tags || '').split(',').filter(t => t.trim()).map(tag => (
                                  <span key={tag.trim()} className="tag-badge">{tag.trim()}</span>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              {assessment && (
                                <>
                                  <div className="quest-badge" style={{ background: statusColor }}>
                                    {assessment.answer}
                                  </div>
                                  <div className="quest-maturity">
                                    L{assessment.currentLevel || assessment.current_level}
                                  </div>
                                  {assessment.comments && (
                                    <span title={assessment.comments.slice(0, 100)} style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border2)", cursor: "default" }}>📝 Notes</span>
                                  )}
                                  {(assessment.reviewerNotes || assessment.reviewer_notes) && (
                                    <span title={(assessment.reviewerNotes || assessment.reviewer_notes).slice(0, 100)} style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "var(--bg4)", color: "var(--amber)", border: "1px solid var(--border2)", cursor: "default" }}>👁 Review</span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {assessment && (
                            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text3)" }}>
                              <div><strong>Status:</strong> {assessment.reviewStatus || assessment.review_status}</div>
                              {assessment.comments && (
                                <div style={{ marginTop: 4 }}><strong>Internal Notes:</strong> {assessment.comments}</div>
                              )}
                              {(assessment.reviewedBy || assessment.reviewed_by) && (
                                <div style={{ marginTop: 4 }}>
                                  <strong>Reviewed by:</strong> {assessment.reviewedBy || assessment.reviewed_by}
                                  {(assessment.reviewedAt || assessment.reviewed_at) && (
                                    <span style={{ marginLeft: 6 }}>
                                      on {new Date(assessment.reviewedAt || assessment.reviewed_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {(assessment.reviewerNotes || assessment.reviewer_notes) && (
                                <div style={{ marginTop: 4, color: "var(--amber)" }}>
                                  <strong>Reviewer Notes:</strong> {assessment.reviewerNotes || assessment.reviewer_notes}
                                </div>
                              )}
                              {(assessment.auditedBy || assessment.audited_by) && (
                                <div style={{ marginTop: 4 }}>
                                  <strong>Audited by:</strong> {assessment.auditedBy || assessment.audited_by}
                                  {(assessment.auditedAt || assessment.audited_at) && (
                                    <span style={{ marginLeft: 6 }}>
                                      on {new Date(assessment.auditedAt || assessment.audited_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {(assessment.auditorNotes || assessment.auditor_notes) && (
                                <div style={{ marginTop: 4, color: "var(--amber)" }}>
                                  <strong>Auditor notes:</strong> {assessment.auditorNotes || assessment.auditor_notes}
                                </div>
                              )}
                            </div>
                          )}

                          {ev.length > 0 && (
                            <div className="evidence-list-modal">
                              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6, fontWeight: 600, textTransform: "uppercase" }}>
                                Evidence ({ev.length})
                              </div>
                              {ev.map(e => (
                                <div key={e.id} className="evidence-item-modal">
                                  <span style={{ flex: 1, fontSize: 12 }}>
                                    {e.evidenceName || e.evidence_name}
                                  </span>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    {(e.filePath || e.file_path) && (
                                      <button
                                        className="btn-compact"
                                        onClick={() => viewEvidence(e.id, e.evidenceName || e.evidence_name)}
                                      >
                                        View File
                                      </button>
                                    )}
                                    {(e.evidenceLink || e.evidence_link) && (
                                      <a
                                        href={e.evidenceLink || e.evidence_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-compact"
                                      >
                                        View Link
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {isAuditor && assessment && ["Submitted", "FINISHED"].includes(assessment.reviewStatus || assessment.review_status) && (
                            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                              <button
                                className="btn btn-primary"
                                style={{ flex: 1, fontSize: 11, padding: "6px 12px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  promptAuditorApproval(assessment.id, "FINISHED");
                                }}
                              >
                                ✓ {(assessment.reviewStatus || assessment.review_status) === "FINISHED" ? "Re-approve" : "Approve"}
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{ flex: 1, fontSize: 11, padding: "6px 12px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  promptAuditorApproval(assessment.id, "WIP");
                                }}
                              >
                                ✗ Reject
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Review locked modal (unverified accounts) */}
      {reviewLockedOpen && (
        <div className="modal-overlay" onClick={() => setReviewLockedOpen(false)}>
          <div className="module-modal" style={{ maxWidth: 420, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16, marginTop: 8 }}>🔒</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>Review Workflow Locked</h2>
            <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6, marginBottom: 20 }}>
              The review workflow is available after your account is verified by a platform administrator.
            </p>
            <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setReviewLockedOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Auditor notes modal */}
      {auditorNotesModal && (
        <div className="modal-overlay" onClick={() => setAuditorNotesModal(null)}>
          <div className="module-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">
                {auditorNotesModal.status === "FINISHED" ? "Approve assessment" : "Reject assessment"}
              </div>
              <button className="modal-close" onClick={() => setAuditorNotesModal(null)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "var(--text2)" }}>
                Notes for contributor (optional)
              </label>
              <textarea
                className="comments-textarea"
                rows={4}
                placeholder="Add feedback, comments, or instructions for the contributor..."
                onChange={e => { auditorNotesRef.current = e.target.value; }}
                style={{ width: "100%", marginBottom: 16 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn ${auditorNotesModal.status === "FINISHED" ? "btn-primary" : "btn-ghost"}`}
                  style={{ flex: 1 }}
                  onClick={confirmAuditorApproval}
                >
                  {auditorNotesModal.status === "FINISHED" ? "✓ Confirm Approval" : "✗ Confirm Rejection"}
                </button>
                <button className="btn btn-ghost" onClick={() => setAuditorNotesModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
