import { apiUpload, apiFetch } from "../api/client.js";
import { useState } from "react";

const ANSWER_OPTIONS = [
  { value: "IMPLEMENTED", label: "Implemented", className: "selected-implemented" },
  { value: "PARTIALLY_IMPLEMENTED", label: "Partially Implemented", className: "selected-partial" },
  { value: "PLANNED", label: "Planned", className: "selected-planned" },
  { value: "NOT_IMPLEMENTED", label: "Not Implemented", className: "selected-notimpl" },
  { value: "NOT_APPLICABLE", label: "Not Applicable", className: "selected-na" }
];

const MATURITY = [
  { n: 1, label: "Ad-hoc", desc: "No formal process. Controls are reactive, undocumented, and person-dependent." },
  { n: 2, label: "Repeatable", desc: "Some informal processes exist and are repeated, but not fully documented or standardized." },
  { n: 3, label: "Defined", desc: "Processes are documented, standardized, and communicated. Meets YES / Level 3+ threshold." },
  { n: 4, label: "Managed", desc: "Processes are measured, monitored, and controlled with metrics and regular reviews." },
  { n: 5, label: "Optimised", desc: "Continuous improvement cycle is active. Process is benchmarked and proactively refined." }
];

export default function QuestionCard({ question, assessment, response, onSetResponse, token, month, reminders, onEvidenceChange, onSaveActionDetails }) {
  const inputId = `fileInput-${question.questId}`;
  const [isEditing, setIsEditing] = useState(false);

  const handleFileUpload = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const created = await apiUpload("/api/evidence", file, { moduleId: question.moduleId, questId: question.questId, month, evidenceName: file.name }, token);
        const files = [...(response.files || []), { id: created.id, name: created.evidenceName || created.evidence_name }];
        onSetResponse("files", files);
        if (onEvidenceChange) await onEvidenceChange();
      } catch (err) {
        console.error("Upload failed", err);
        alert(`Evidence upload failed: ${err.message || "Please try again"}`);
      }
    }
  };

  const removeFile = async (index) => {
    const file = (response.files || [])[index];
    if (file && typeof file === "object" && file.id) {
      try {
        await apiFetch(`/api/evidence/${file.id}`, { token, method: "DELETE" });
        if (onEvidenceChange) await onEvidenceChange();
      } catch (err) {
        console.error("Failed to delete evidence", err);
      }
    }
    const files = (response.files || []).filter((_, i) => i !== index);
    onSetResponse("files", files);
  };

  const reviewStatus = assessment?.reviewStatus || assessment?.review_status;
  const reviewerPassed = reviewStatus === "FINISHED";
  const submittedForReview = reviewStatus === "Submitted";

  const needsActionDetails = ["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED"].includes(response.answer);
  const needsEvidence = response.answer === "IMPLEMENTED";
  const isNA = response.answer === "NOT_APPLICABLE";

  const gates = needsActionDetails
    ? [
        { label: `Answer = ${ANSWER_OPTIONS.find(a => a.value === response.answer)?.label || response.answer}`, pass: true },
        { label: "Maturity level", pass: !!response.maturity },
        { label: "Owner set", pass: !!response.actionOwner },
        { label: "Due date set", pass: !!response.actionDueDate },
        { label: "Notes provided", pass: !!response.actionNotes },
        { label: reviewerPassed ? "Review completed" : "Reviewer WIP", pass: reviewerPassed }
      ]
    : isNA
    ? [
        { label: "Answer = Not Applicable", pass: true },
        { label: "Justification provided", pass: !!response.comment },
        { label: reviewerPassed ? "Review completed" : "Reviewer WIP", pass: reviewerPassed }
      ]
    : [
        { label: "Answer = Implemented", pass: response.answer === "IMPLEMENTED" },
        { label: "Maturity >= level 3", pass: response.maturity >= 3 },
        { label: "Evidence provided", pass: !!response.link || (response.files && response.files.length > 0) },
        { label: reviewerPassed ? "Review completed" : "Reviewer WIP", pass: reviewerPassed }
      ];

  const maturityDesc = response.maturity
    ? MATURITY[response.maturity - 1].desc
    : "Select a maturity level above to see the description.";

  const handleAnswer = (answer) => {
    onSetResponse("answer", answer);
    if (["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED"].includes(answer) && !response.actionOwner) {
      onSetResponse("actionOwner", question.defaultOwner || "");
    }
  };

  const handleEditClick = async () => {
    if (window.confirm("Editing will reset the review status to WIP. The reviewer will need to re-approve. Continue?")) {
      try {
        // Set review status back to WIP and allow editing
        await apiFetch(`/api/assessments/${assessment.id}`, {
          token,
          method: "PUT",
          body: JSON.stringify({ reviewStatus: "Submitted" })
        });
        setIsEditing(true);
      } catch (err) {
        console.error("Failed to update assessment:", err);
        alert("Failed to enable editing. Please try again.");
      }
    }
  };

  // Show read-only when submitted-for-review (pending) or fully approved
  const showReadOnly = (reviewerPassed || submittedForReview) && !isEditing;

  return (
    <div className="quest-card">
      <div className="card-meta">
        <span className="pill pill-module">{question.moduleId} - {question.moduleName}</span>
        <span className="pill pill-iso">{question.isoReference}</span>
        <span className="pill pill-owner">{question.defaultOwner}</span>
        {question.recurrenceInterval && question.recurrenceInterval !== "none" && (
          <span className="pill pill-recurrence">⟳ {question.recurrenceInterval}</span>
        )}
        {question.nextDueDate && (
          <span className="pill pill-due">Due: {question.nextDueDate.slice(0, 10)}</span>
        )}
        {(question.isOverdue || question.status === 'OVERDUE' || (question.nextDueDate && new Date(question.nextDueDate) < new Date())) && (
          <span className="badge-overdue">OVERDUE</span>
        )}
      </div>

      <h1 className="quest-title">{question.controlArea}</h1>

      <div className="question-block">
        <div className="q-label">Baseline question</div>
        <p className="q-text">{question.baselineQuestion}</p>
        <div className="level3-label">Level 3+ criteria</div>
        <p className="level3-text">{question.level3YesCriteria}</p>
        <p className="evidence-req">Required evidence: {question.requiredEvidence}</p>
      </div>

      {showReadOnly ? (
        <div className="assessment-info-card">
          <div className="assessment-info-title">
            {reviewerPassed ? "✓ Review completed" : "⏳ Submitted — awaiting review"}
          </div>
          <div className="assessment-info-row">
            <div className="assessment-info-label">Answer:</div>
            <div className="assessment-info-value"><strong>{assessment.answer}</strong></div>
          </div>
          <div className="assessment-info-row">
            <div className="assessment-info-label">Maturity Level:</div>
            <div className="assessment-info-value"><strong>{assessment.currentLevel}</strong></div>
          </div>
          {assessment.evidenceLink && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Evidence Link:</div>
              <div className="assessment-info-value">
                <a href={assessment.evidenceLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal)", textDecoration: "underline" }}>
                  {assessment.evidenceLink}
                </a>
              </div>
            </div>
          )}
          {assessment.comments && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Comments:</div>
              <div className="assessment-info-value">{assessment.comments}</div>
            </div>
          )}
          {assessment.submittedBy && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Submitted by:</div>
              <div className="assessment-info-value" style={{ color: "var(--text3)" }}>{assessment.submittedBy}</div>
            </div>
          )}
          {(assessment.reviewedBy || assessment.reviewed_by) && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Reviewed by:</div>
              <div className="assessment-info-value" style={{ color: "var(--text3)" }}>
                {assessment.reviewedBy || assessment.reviewed_by}
                {(assessment.reviewedAt || assessment.reviewed_at) && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    on {new Date(assessment.reviewedAt || assessment.reviewed_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}
          {(assessment.reviewerNotes || assessment.reviewer_notes) && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Reviewer notes:</div>
              <div className="assessment-info-value" style={{ color: "var(--amber)", fontStyle: "italic" }}>
                {assessment.reviewerNotes || assessment.reviewer_notes}
              </div>
            </div>
          )}
          {(assessment.auditedBy || assessment.audited_by) && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Audited by:</div>
              <div className="assessment-info-value" style={{ color: "var(--text3)" }}>
                {assessment.auditedBy || assessment.audited_by}
                {(assessment.auditedAt || assessment.audited_at) && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    on {new Date(assessment.auditedAt || assessment.audited_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}
          {(assessment.auditorNotes || assessment.auditor_notes) && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Auditor notes:</div>
              <div className="assessment-info-value" style={{ color: "var(--amber)", fontStyle: "italic" }}>
                {assessment.auditorNotes || assessment.auditor_notes}
              </div>
            </div>
          )}
          {reviewerPassed && (
            <div style={{ marginTop: 16 }}>
              <button className="btn-edit" onClick={handleEditClick}>
                ✎ Edit Assessment
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="section-label">Answer</div>
          <div className="answer-group">
            {ANSWER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`answer-btn ${response.answer === opt.value ? opt.className : ""}`}
                onClick={() => handleAnswer(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {needsActionDetails && (
            <div className="action-requirements">
              <div className="section-label">Action details</div>
              <div className="action-fields">
                <label>
                  Owner
                  <input
                    type="text"
                    value={response.actionOwner || ""}
                    onChange={(e) => onSetResponse("actionOwner", e.target.value)}
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={response.actionDueDate || ""}
                    onChange={(e) => onSetResponse("actionDueDate", e.target.value)}
                  />
                </label>
              </div>
              <textarea
                className="comments-textarea"
                placeholder="Action notes, corrective steps, dependencies, or exceptions..."
                value={response.actionNotes || ""}
                onChange={(e) => onSetResponse("actionNotes", e.target.value)}
              ></textarea>
              <button
                className="btn-save-action"
                onClick={() => {
                  if (onSaveActionDetails) onSaveActionDetails();
                }}
                disabled={!response.actionDueDate || !response.actionOwner}
              >
                Save action details
              </button>
            </div>
          )}

          {needsActionDetails && reminders && reminders.length > 0 && (
            <div className="reminders-section">
              <div className="section-label">Upcoming reminders</div>
              <div className="reminders-list">
                {reminders.map((r) => {
                  const remindDateStr = (r.remindAt || r.remind_at || "").slice(0, 10);
                  const remindDate = new Date(r.remindAt || r.remind_at);
                  const daysUntil = Math.ceil((remindDate - new Date()) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={r.id} className="reminder-item">
                      <span className="reminder-icon">⏰</span>
                      <span className="reminder-date">{remindDateStr}</span>
                      <span className="reminder-timing">
                        {daysUntil > 0 ? `in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}` : daysUntil === 0 ? "today" : "overdue"}
                      </span>
                      {r.message && <span className="reminder-msg" title={r.message}>{r.message.substring(0, 40)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {needsEvidence && (
            <>
              <div className="section-label">Maturity level</div>
              <div className="maturity-group">
                {MATURITY.map((m) => (
                  <button
                    key={m.n}
                    className={`maturity-btn ${response.maturity === m.n ? "selected" : ""}`}
                    onClick={() => onSetResponse("maturity", m.n)}
                  >
                    <span className="m-num">{m.n}</span>
                    <span className="m-label">{m.label}</span>
                  </button>
                ))}
              </div>
              <div className="maturity-desc">{maturityDesc}</div>

              <div className="section-label">Evidence</div>
              <div className="evidence-drop" onClick={() => document.getElementById(inputId).click()}>
                <div className="upload-icon">Upload</div>
                <p>
                  <strong>Click to upload evidence file</strong>
                  PDF, DOCX, PNG, XLSX - max 25 MB
                </p>
              </div>
              <input
                type="file"
                id={inputId}
                style={{ display: "none" }}
                accept=".pdf,.docx,.png,.xlsx"
                onChange={handleFileUpload}
              />
              {response.files && response.files.length > 0 && (
                <div className="file-list">
                  {response.files.map((file, i) => {
                    const isLink = file && typeof file === "object" && file.link;
                    const displayName = typeof file === "string" ? file : file.name;
                    const evidenceId = file && typeof file === "object" ? file.id : null;
                    return (
                      <div key={i} className="file-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          {isLink ? (
                            <a 
                              href={file.link} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="file-name"
                              style={{ color: "var(--accent2)", textDecoration: "underline" }}
                            >
                              {displayName}
                            </a>
                          ) : (
                            <span className="file-name">{displayName}</span>
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            {evidenceId && (
                              <button 
                                className="btn-compact" 
                                style={{ fontSize: 12, padding: '4px 8px' }}
                                onClick={async () => {
                                  try {
                                    const analyzed = await apiFetch(`/api/evidence/${evidenceId}/analyze`, { token, method: 'POST' });
                                    // Update the file object with AI data
                                    const updatedFiles = [...(response.files || [])];
                                    updatedFiles[i] = { ...file, ...analyzed };
                                    onSetResponse('files', updatedFiles);
                                    if (onEvidenceChange) await onEvidenceChange();
                                  } catch (err) {
                                    console.error('AI analysis failed', err);
                                    alert(`AI analysis failed: ${err.message}`);
                                  }
                                }}
                              >
                                🤖 AI Analyze
                              </button>
                            )}
                            <button className="file-remove" onClick={() => removeFile(i)}>
                              Remove
                            </button>
                          </div>
                        </div>
                        {file.aiContributorComments && (
                          <div style={{ padding: 10, background: '#f0f9ff', borderRadius: 4, fontSize: 13 }}>
                            <div style={{ fontWeight: 600, color: '#0369a1', marginBottom: 4 }}>📝 AI Feedback</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{file.aiContributorComments}</div>
                            {file.aiGaps && (() => {
                              try {
                                const gaps = Array.isArray(file.aiGaps) ? file.aiGaps : JSON.parse(file.aiGaps);
                                return gaps.length > 0 ? (
                                  <div style={{ marginTop: 6 }}>
                                    <span style={{ fontWeight: 600, color: '#dc2626' }}>⚠️ Gaps:</span>
                                    <span style={{ marginLeft: 6 }}>{gaps.join(', ')}</span>
                                  </div>
                                ) : null;
                              } catch { return null; }
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="link-row">
                <input
                  className="link-input"
                  type="text"
                  placeholder="Or paste a link (SharePoint, Drive, Confluence...)"
                  value={response.link || ""}
                  onChange={(e) => onSetResponse("link", e.target.value)}
                />
                <button className="add-link-btn" onClick={async () => {
                  const link = response.link?.trim();
                  if (!link) return;
                  try {
                    const created = await apiFetch("/api/evidence", { token, method: "POST", body: JSON.stringify({ month, moduleId: question.moduleId, questId: question.questId, evidenceLink: link, evidenceName: `Link: ${link.substring(0, 50)}` }) });
                    const files = [...(response.files || []), { id: created.id, name: created.evidenceName || created.evidence_name, link: created.evidenceLink || created.evidence_link }];
                    onSetResponse("files", files);
                    onSetResponse("link", "");
                    if (onEvidenceChange) await onEvidenceChange();
                  } catch (err) {
                    console.error("Add link failed", err);
                    alert(`Failed to add link: ${err.message || "Please try again"}`);
                  }
                }}>Add link</button>
              </div>
            </>
          )}

          <div className="section-label">Comments</div>
          <textarea
            className="comments-textarea"
            placeholder="Optional notes for the reviewer - context, exceptions, or remediation plan..."
            value={response.comment || ""}
            onChange={(e) => onSetResponse("comment", e.target.value)}
          ></textarea>

          <div className="scoring-gates">
            <div className="section-label">Scoring gates</div>
            <div className="gates-row">
              {gates.map((gate, i) => (
                <span key={i} className={`gate-pill ${gate.pass ? "gate-pass" : "gate-fail"}`}>
                  <span className="gate-x">{gate.pass ? "OK" : "Missing"}</span> {gate.label}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
