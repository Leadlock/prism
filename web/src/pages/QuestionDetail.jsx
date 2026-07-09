import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch, apiDownload } from "../api/client.js";
import TopBar from "../components/TopBar.jsx";

export default function QuestionDetail({ token, onLogout }) {
  const { questId } = useParams();
  const navigate = useNavigate();
  const [question, setQuestion] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch(`/api/questions/${questId}`, { token })
      .then((data) => {
        if (active) {
          setQuestion(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [questId, token]);

  const downloadEvidence = async (id, filename) => {
    try {
      const url = apiDownload(`/api/evidence/${id}/download`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'evidence';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      setError(e.message || 'Download failed');
    }
  };

  if (loading) {
    return (
      <div className="app-shell">
        <TopBar title="Loading..." onLogout={onLogout} />
        <div className="loading">Loading question details...</div>
      </div>
    );
  }

  if (error || !question) {
    return (
      <div className="app-shell">
        <TopBar title="Error" onLogout={onLogout} />
        <div className="error-text">{error || "Question not found"}</div>
        <button onClick={() => navigate("/tracker")} className="btn-secondary">
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell fade-in">
      <TopBar
        title={`${question.questId} — ${question.moduleName}`}
        subtitle={question.controlArea}
        tags={[question.isoReference, question.frequency]}
        onLogout={onLogout}
        onBack={() => navigate("/tracker")}
      />
      <div style={{ padding: '0 28px 28px 28px' }}>
        <button className="btn btn-ghost" onClick={async () => {
          try {
            const q = await apiFetch(`/api/questions/${questId}`, { token });
            setQuestion(q);
          } catch (e) { setError(e.message); }
        }}>Refresh</button>
      </div>
      <div className="grid">
        <section className="card">
          <div className="section-title">Question Details</div>
          <div className="detail-row">
            <span className="detail-label">Baseline Question:</span>
            <span>{question.baselineQuestion}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Level 3 Criteria:</span>
            <span>{question.level3YesCriteria}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Required Evidence:</span>
            <span>{question.requiredEvidence}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Default Owner:</span>
            <span>{question.defaultOwner}</span>
          </div>
        </section>

        <section className="card">
          <div className="section-title">Assessments ({question.assessments?.length || 0})</div>
          {question.assessments && question.assessments.length > 0 ? (
            <div className="list">
              {question.assessments.map((assessment) => (
                <div key={assessment.id} className="list-item">
                  <div>
                    <div className="list-item-title">
                      {assessment.month} — {assessment.answer}
                    </div>
                    <div className="list-item-meta">
                      Level {assessment.currentLevel} | {assessment.reviewStatus}
                    </div>
                    {(assessment.reviewedBy || assessment.auditedBy) && (
                      <div className="list-item-meta" style={{ marginTop: 4 }}>
                        {assessment.reviewedBy && `Reviewed by: ${assessment.reviewedBy}`}
                        {assessment.reviewedBy && assessment.auditedBy && " | "}
                        {assessment.auditedBy && `Audited by: ${assessment.auditedBy}`}
                      </div>
                    )}
                  </div>
                  {assessment.comments && (
                    <div className="list-item-comment">{assessment.comments}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No assessments recorded yet.</p>
          )}
        </section>

        <section className="card">
          <div className="section-title">Actions ({question.actions?.length || 0})</div>
          {question.actions && question.actions.length > 0 ? (
            <div className="list">
              {question.actions.map((action) => (
                <div key={action.id} className="list-item">
                  <div>
                    <div className="list-item-title">
                      {action.defeatedQuest} — {action.status}
                    </div>
                    <div className="list-item-meta">
                      Owner: {action.owner} | Due: {action.dueDate ? new Date(action.dueDate).toLocaleDateString() : "N/A"}
                    </div>
                  </div>
                  {action.notes && (
                    <div className="list-item-comment">{action.notes}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No actions required.</p>
          )}
        </section>

        <section className="card">
          <div className="section-title">Evidence ({question.evidence?.length || 0})</div>
          {question.evidence && question.evidence.length > 0 ? (
            <div className="list">
              {question.evidence.map((evidence) => (
                <div key={evidence.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="list-item-title">
                        {evidence.evidenceName || evidence.evidenceType}
                      </div>
                      <div className="list-item-meta">
                        Uploaded by: {evidence.uploadedBy} | Status: {evidence.approvalStatus}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {evidence.evidenceLink && (
                        <a href={evidence.evidenceLink} target="_blank" rel="noopener noreferrer" className="link">
                          View Evidence
                        </a>
                      )}
                      {evidence.filePath && (
                        <button className="btn btn-compact" onClick={() => downloadEvidence(evidence.id, evidence.evidenceName)}>
                          Download
                        </button>
                      )}
                      <button 
                        className="btn btn-secondary" 
                        onClick={async () => {
                          try {
                            setLoading(true);
                            await apiFetch(`/api/evidence/${evidence.id}/analyze`, { token, method: 'POST' });
                            const q = await apiFetch(`/api/questions/${questId}`, { token });
                            setQuestion(q);
                            setLoading(false);
                          } catch (e) { 
                            setError(e.message);
                            setLoading(false);
                          }
                        }}
                      >
                        🤖 AI Analyze
                      </button>
                    </div>
                  </div>
                  {evidence.aiContributorComments && (
                    <div style={{ marginTop: 12, padding: 12, background: 'var(--bg)', borderRadius: 14, boxShadow: '4px 4px 10px rgba(163,177,198,0.6), -4px -4px 10px rgba(255,255,255,0.8)' }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--accent)' }}>📝 Contributor Feedback</div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{evidence.aiContributorComments}</div>
                      {evidence.aiGaps && JSON.parse(evidence.aiGaps).length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--red)', marginBottom: 4 }}>⚠️ Gaps Identified:</div>
                          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                            {JSON.parse(evidence.aiGaps).map((gap, i) => <li key={i}>{gap}</li>)}
                          </ul>
                        </div>
                      )}
                      {evidence.aiSuggestions && JSON.parse(evidence.aiSuggestions).length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)', marginBottom: 4 }}>💡 Suggestions:</div>
                          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                            {JSON.parse(evidence.aiSuggestions).map((sug, i) => <li key={i}>{sug}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {evidence.aiReviewerComments && (
                    <div style={{ marginTop: 8, padding: 12, background: 'var(--bg)', borderRadius: 14, boxShadow: '4px 4px 10px rgba(163,177,198,0.6), -4px -4px 10px rgba(255,255,255,0.8)' }}>
                      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--amber)' }}>👤 Reviewer Summary</div>
                      <div style={{ fontSize: 14 }}>{evidence.aiReviewerComments}</div>
                      {evidence.aiAnalyzedAt && (
                        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                          Analyzed: {new Date(evidence.aiAnalyzedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No evidence uploaded yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
