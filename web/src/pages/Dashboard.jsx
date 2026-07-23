import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiDownload } from "../api/client.js";
import { BarChart, DonutChart, StackedBarChart } from "../components/Charts.jsx";
import ExportMenu from "../components/ExportMenu.jsx";
import Logo from "../components/Logo";

export default function Dashboard({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState(null);
  const [moduleData, setModuleData] = useState(null);
  const [moduleError, setModuleError] = useState("");
  const [loadingModule, setLoadingModule] = useState(false);
  const [auditorNotesModal, setAuditorNotesModal] = useState(null); // { assessmentId, status }
  const auditorNotesRef = useRef("");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const generateMonthOptions = () => {
    const options = [];
    for (let year = 2026; year >= 2023; year--) {
      for (let month = 12; month >= 1; month--) {
        options.push(`${year}-${String(month).padStart(2, '0')}`);
      }
    }
    return options;
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch(`/api/dashboard?month=${selectedMonth}`, { token })
      .then(data => { if (active) { setStats(data); setLoading(false); } })
      .catch(err => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [token, selectedMonth]);

  const isAdmin       = user?.role === "ADMIN";
  const isLeadOrAdmin  = user?.role === "ADMIN" || user?.role === "LEAD";
  const isAuditor      = user?.role === "AUDITOR";

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

      if (!response) {
        throw new Error("Failed to update assessment");
      }

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
      alert(`Error: ${err.message}`);
      setError(err.message);
    }
  };

  const viewEvidence = async (id, filename) => {
    try {
      const res = await fetch(apiDownload(`/api/evidence/${id}/download`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) {
      alert(`Error viewing file: ${e.message}`);
      setError(e.message || "Failed to view file");
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
          <select 
            className="month-selector"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {generateMonthOptions().map(month => (
              <option key={month} value={month}>
                {new Date(month + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
          {isAdmin && <button className="btn btn-ghost" onClick={() => navigate("/admin")}>Admin</button>}
          {isAdmin && <button className="btn btn-ghost" onClick={() => navigate("/auditors")}>Auditors</button>}
          {isLeadOrAdmin && <button className="btn btn-ghost" onClick={() => navigate("/review")}>Review</button>}
          {!isAuditor && <button className="btn btn-ghost" onClick={() => navigate("/tracker")}>Tracker</button>}
          {stats && <ExportMenu stats={stats} />}
          <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {error && <div className="error-text" style={{ padding: "0 28px 16px" }}>{error}</div>}

      {loading ? (
        <div className="tracker-loading">
          <div className="loading-spinner" />
          <p>Loading dashboard…</p>
        </div>
      ) : stats ? (
        <div className="dash-grid">

          {/* 1. Overall completion */}
          <div className="dash-card">
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
                { label: "Finished", value: stats.overall.finished, color: "var(--green)" },
                { label: "In progress", value: Math.max(0, stats.overall.assessed - stats.overall.finished), color: "var(--amber)" },
                { label: "Not started", value: Math.max(0, stats.overall.total - Math.max(stats.overall.assessed, stats.overall.finished)), color: "var(--bg4)" }
              ]}
            />
          </div>

          <div className="dash-card dash-card-wide">
            <div className="dash-card-title">Maturity Distribution</div>
            {(() => {
              const md = stats.maturityDistribution || {};
              const levels = [
                { key: "l1", label: "L1 — Ad-hoc",      color: "var(--red)" },
                { key: "l2", label: "L2 — Repeatable",  color: "var(--amber)" },
                { key: "l3", label: "L3 — Defined",     color: "var(--teal)" },
                { key: "l4", label: "L4 — Managed",     color: "var(--accent2)" },
                { key: "l5", label: "L5 — Optimised",   color: "var(--green)" },
              ];
              const total = levels.reduce((s, l) => s + (md[l.key] || 0), 0);
              return (
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
              );
            })()}
          </div>

          {/* 2. Per-module completion */}
          <div className="dash-card dash-card-wide">
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
          </div>

          {/* Per-module completion percentage donut charts */}
          {stats.moduleCompletion.map((module, idx) => {
            const finishedPct = module.total > 0 ? Math.round((module.finished / module.total) * 100) : 0;
            const assessedNotFinished = Math.max(0, module.assessed - module.finished);
            const notStarted = Math.max(0, module.total - Math.max(module.assessed, module.finished));
            
            return (
              <div key={idx} className="dash-card" style={{ cursor: "pointer" }} onClick={() => openModule(module)}>
                <div className="dash-card-title">{module.moduleId}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14, lineHeight: 1.4 }}>
                  {module.name}
                </div>
                <DonutChart
                  size={110}
                  segments={[
                    { label: "Finished", value: module.finished, color: "var(--green)" },
                    { label: "In progress", value: assessedNotFinished, color: "var(--amber)" },
                    { label: "Not started", value: notStarted, color: "var(--bg4)" }
                  ]}
                />
                <div style={{ marginTop: 12, fontSize: 11, color: "var(--text3)", textAlign: "center" }}>
                  {module.finished} / {module.total} completed
                </div>
              </div>
            );
          })}

          {/* 3. Risk distribution */}
          <div className="dash-card">
            <div className="dash-card-title">Answer distribution</div>
            <DonutChart
              size={130}
              segments={[
                { label: "YES", value: stats.answerDistribution.find(a => a.answer === "YES")?.count || 0, color: "var(--green)" },
                { label: "NO", value: stats.answerDistribution.find(a => a.answer === "NO")?.count || 0, color: "var(--red)" },
                { label: "WIP", value: stats.answerDistribution.find(a => a.answer === "WIP")?.count || 0, color: "var(--amber)" }
              ]}
            />
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text3)", textAlign: "center" }}>
              {stats.overall.assessed} assessments completed
            </div>
          </div>

          {/* 4. Evidence coverage */}
          <div className="dash-card dash-card-wide">
            <div className="dash-card-title">Evidence coverage</div>
            <BarChart
              data={stats.evidenceCoverage.map(e => ({ label: e.moduleId, value: e.covered, total: e.total }))}
              valueKey="value"
              labelKey="label"
              color="var(--teal)"
              maxValue={Math.max(...stats.evidenceCoverage.map(e => e.total), 1)}
            />
          </div>

          {/* 5. Action status */}
          <div className="dash-card">
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
          </div>

        </div>
      ) : null}

      {/* Floating Module Detail Window */}
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
                  {moduleData.questions.map(q => {
                    const qId = q.questId || q.quest_id;
                    const assessment = (moduleData.assessments || []).find(a =>
                      (a.questId || a.quest_id) === qId
                    );
                    const ev = (moduleData.evidence || []).filter(e =>
                      e.questId === q.questId
                    );
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
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {assessment && (
                              <>
                                <div className="quest-badge" style={{ background: statusColor }}>
                                  {assessment.answer}
                                </div>
                                <div className="quest-maturity">
                                  L{assessment.currentLevel || assessment.current_level}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {assessment && (
                          <div style={{ marginTop: 12, fontSize: 12, color: "var(--text3)" }}>
                            <div><strong>Status:</strong> {assessment.reviewStatus || assessment.review_status}</div>
                            {assessment.comments && (
                              <div style={{ marginTop: 4 }}><strong>Comments:</strong> {assessment.comments}</div>
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
                                <strong>Reviewer notes:</strong> {assessment.reviewerNotes || assessment.reviewer_notes}
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
