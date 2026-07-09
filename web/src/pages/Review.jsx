import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiDownload } from "../api/client.js";

export default function Review({ token, user, onLogout, theme, onThemeToggle }) {
  const [assessments, setAssessments] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [error, setError] = useState("");
  const [notesModal, setNotesModal] = useState(null); // { id, status, notes }
  const notesRef = useRef("");

  const load = useCallback(async () => {
    try {
      const [qs, as, ev] = await Promise.all([
        apiFetch("/api/questions", { token }),
        apiFetch("/api/assessments", { token }),
        apiFetch("/api/evidence", { token })
      ]);
      setQuestions(qs || []);
      setAssessments((as || []).filter(a => (a.reviewStatus || a.review_status) === "Submitted"));
      setEvidence(ev || []);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const downloadEvidence = async (id, filename) => {
    try {
      const res = await fetch(apiDownload(`/api/evidence/${id}/download`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "evidence";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || "Download failed");
    }
  };

  const isReviewer = user?.role === "ADMIN" || user?.role === "LEAD";

  const promptUpdateAssessment = (id, status) => {
    notesRef.current = "";
    setNotesModal({ id, status, notes: "" });
  };

  const confirmUpdateAssessment = async () => {
    const { id, status } = notesModal;
    const notes = notesRef.current;
    setNotesModal(null);
    try {
      if (status === "WIP") {
        const assessment = assessments.find(a => a.id === id);
        if (assessment) {
          const linkedEvidence = evidence.filter(e =>
            String(e.evidenceId || e.evidence_id) === String(id)
          );
          for (const ev of linkedEvidence) {
            try {
              await apiFetch(`/api/evidence/${ev.id}`, { token, method: "DELETE" });
            } catch (err) {
              console.error(`Failed to delete evidence ${ev.id}:`, err);
            }
          }
        }
        await apiFetch(`/api/assessments/${id}`, { token, method: "DELETE" });
      } else {
        await apiFetch(`/api/assessments/${id}`, {
          token,
          method: "PUT",
          body: JSON.stringify({ reviewStatus: status, reviewedBy: user?.email, reviewerNotes: notes || undefined })
        });
      }
      await load();
    } catch (e) {
      setError(e.message || "Update failed");
    }
  };

  const qid = a => a.questId || a.quest_id;

  return (
    <div className="review-shell fade-in">
      <div className="review-header">
        <div>
          <div className="logo">PRISM</div>
          <div className="review-title">Review workspace</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button className="btn btn-ghost" onClick={load}>Refresh</button>
          <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="review-content">
        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

        <section className="card" style={{ marginTop: 0 }}>
          <div className="section-title">
            Submitted assessments ({assessments.length})
          </div>

          {assessments.length === 0 ? (
            <p className="muted">No assessments awaiting review.</p>
          ) : (
            <div className="list">
              {assessments.map(a => {
                const questId = qid(a);
                const q = questions.find(q => q.questId === questId || q.quest_id === questId) || {};
                const evItems = evidence.filter(e => (e.questId || e.quest_id) === questId);

                return (
                  <div key={a.id} className="list-item">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 300 }}>
                        <div className="list-item-title">
                          {a.month} — {a.answer}
                        </div>
                        <div className="list-item-meta">
                          Level {a.currentLevel} | {a.reviewStatus || a.review_status} | Submitted by: {a.submittedBy || a.submitted_by}
                        </div>

                        <div style={{ marginTop: 16 }}>
                          <div className="section-label">Question ID: {questId}</div>
                          <div className="list-item-title" style={{ fontSize: 14, marginTop: 4, marginBottom: 8 }}>
                            {q.controlArea || q.control_area}
                          </div>
                          <div className="q-text" style={{ fontSize: 13 }}>
                            {q.baselineQuestion || q.baseline_question || "—"}
                          </div>
                          <div className="section-label" style={{ marginTop: 12 }}>Level 3+ criteria</div>
                          <div className="level3-text">{q.level3YesCriteria || q.level3_yes_criteria || "—"}</div>
                          <div className="section-label" style={{ marginTop: 12 }}>Required evidence</div>
                          <div className="muted">{q.requiredEvidence || q.required_evidence || "—"}</div>
                        </div>

                        {a.comments && (
                          <div style={{ marginTop: 16 }} className="list-item-comment">
                            {a.comments}
                          </div>
                        )}

                        <div style={{ marginTop: 16 }}>
                          <div className="section-label">Evidence ({evItems.length})</div>
                          {evItems.length === 0 ? (
                            <p className="muted">No evidence uploaded.</p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                              {evItems.map(e => (
                                <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", background: "var(--bg4)", borderRadius: 6 }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
                                      {e.evidenceName || e.evidence_name}
                                    </div>
                                    <div className="muted" style={{ marginTop: 2 }}>
                                      Uploaded by: {e.uploadedBy || e.uploaded_by}
                                    </div>
                                  </div>
                                  {(e.filePath || e.file_path) ? (
                                    <button
                                      className="btn-compact"
                                      onClick={() => downloadEvidence(e.id, e.evidenceName || e.evidence_name)}
                                    >
                                      Download
                                    </button>
                                  ) : (e.evidenceLink || e.evidence_link) ? (
                                    <a
                                      href={e.evidenceLink || e.evidence_link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="link"
                                    >
                                      View
                                    </a>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ minWidth: 220, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className="card" style={{ padding: 14 }}>
                          <div className="muted" style={{ marginBottom: 8 }}>Module</div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{q.moduleName || q.module_name}</div>
                        </div>
                        <div className="card" style={{ padding: 14 }}>
                          <div className="muted" style={{ marginBottom: 8 }}>Maturity</div>
                          <div style={{ fontSize: 24, fontWeight: 600, color: "var(--accent2)" }}>
                            {a.currentLevel || "—"}
                          </div>
                        </div>
                        {isReviewer && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <button
                              className="btn btn-primary"
                              style={{ width: "100%" }}
                              onClick={() => promptUpdateAssessment(a.id, "FINISHED")}
                            >
                              ✓ Approve
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ width: "100%" }}
                              onClick={() => promptUpdateAssessment(a.id, "WIP")}
                            >
                              ✗ Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {notesModal && (
        <div className="modal-overlay" onClick={() => setNotesModal(null)}>
          <div className="module-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">
                {notesModal.status === "FINISHED" ? "Approve assessment" : "Reject assessment"}
              </div>
              <button className="modal-close" onClick={() => setNotesModal(null)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "var(--text2)" }}>
                Notes for contributor (optional)
              </label>
              <textarea
                className="comments-textarea"
                rows={4}
                placeholder="Add feedback, comments, or instructions for the contributor..."
                onChange={e => { notesRef.current = e.target.value; }}
                style={{ width: "100%", marginBottom: 16 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn ${notesModal.status === "FINISHED" ? "btn-primary" : "btn-ghost"}`}
                  style={{ flex: 1 }}
                  onClick={confirmUpdateAssessment}
                >
                  {notesModal.status === "FINISHED" ? "✓ Confirm Approval" : "✗ Confirm Rejection"}
                </button>
                <button className="btn btn-ghost" onClick={() => setNotesModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
