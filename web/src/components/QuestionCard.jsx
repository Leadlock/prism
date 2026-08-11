import { apiUpload, apiFetch } from "../api/client.js";
import { useEffect, useState } from "react";

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const s = dateStr.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

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

export default function QuestionCard({ question, assessment, response, onSetResponse, token, month, reminders, onEvidenceChange, onSaveActionDetails, user }) {
  const inputId = `fileInput-${question.questId}`;
  const [isEditing, setIsEditing] = useState(false);

  // Request evidence state
  const [showReqEvidence, setShowReqEvidence] = useState(false);
  const [reqEmail, setReqEmail]               = useState("");
  const [reqLoading, setReqLoading]           = useState(false);
  const [reqError, setReqError]               = useState("");
  const [reqSuccess, setReqSuccess]           = useState(false);
  const [orgUsers, setOrgUsers]               = useState(null);

  // Vault-link state
  const [vaultItems, setVaultItems]               = useState([]);
  const [showVaultPicker, setShowVaultPicker]     = useState(false);
  const [pickerItems, setPickerItems]             = useState([]);
  const [pickerSearch, setPickerSearch]           = useState("");
  const [pickerLoading, setPickerLoading]         = useState(false);
  const [linkingVaultId, setLinkingVaultId]       = useState(null);
  const [vaultItemsLoaded, setVaultItemsLoaded]   = useState(false);

  // Suggested evidence state
  const [suggestions, setSuggestions]             = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [ignoredSuggestions, setIgnoredSuggestions] = useState(new Set());
  const [attachingSuggestion, setAttachingSuggestion] = useState(null);

  const orgDomain = user?.email ? user.email.split("@")[1] : null;
  const isOrgEmail = (email) => orgDomain && email.toLowerCase().endsWith("@" + orgDomain.toLowerCase());

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
        { label: "Evidence provided", pass: !!response.link || (response.files && response.files.length > 0) || vaultItems.length > 0 },
        { label: reviewerPassed ? "Review completed" : "Reviewer WIP", pass: reviewerPassed }
      ];

  const maturityDesc = response.maturity
    ? MATURITY[response.maturity - 1].desc
    : "Select a maturity level above to see the description.";

  // Load org users once when "Implemented" section is visible
  useEffect(() => {
    if (needsEvidence && orgUsers === null && token) {
      apiFetch("/api/requests/users", { token })
        .then(data => setOrgUsers(data || []))
        .catch(() => setOrgUsers([]));
    }
  }, [needsEvidence, token]);

  // Load vault items and suggestions when evidence section opens
  useEffect(() => {
    if (!needsEvidence || !token || vaultItemsLoaded) return;
    setVaultItemsLoaded(true);
    apiFetch(`/api/vault?questId=${encodeURIComponent(question.questId)}`, { token })
      .then(data => setVaultItems(data || []))
      .catch(() => {});
    setSuggestionsLoading(true);
    apiFetch(`/api/vault/suggestions?questId=${encodeURIComponent(question.questId)}`, { token })
      .then(data => setSuggestions(data || []))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [needsEvidence, token, question.questId, vaultItemsLoaded]);

  const loadPicker = async (search = "") => {
    setPickerLoading(true);
    try {
      const url = search.trim() ? `/api/vault?search=${encodeURIComponent(search.trim())}` : "/api/vault";
      const data = await apiFetch(url, { token });
      setPickerItems(data || []);
    } catch { /* silent */ }
    setPickerLoading(false);
  };

  const handleVaultLink = async (vaultId) => {
    setLinkingVaultId(vaultId);
    try {
      await apiFetch(`/api/vault/${vaultId}/link`, {
        token, method: "POST",
        body: JSON.stringify({ questId: question.questId })
      });
      const data = await apiFetch(`/api/vault?questId=${encodeURIComponent(question.questId)}`, { token });
      setVaultItems(data || []);
      setShowVaultPicker(false);
    } catch { /* silent */ }
    setLinkingVaultId(null);
  };

  const handleVaultDetach = async (vaultId) => {
    try {
      await apiFetch(`/api/vault/${vaultId}/link/${encodeURIComponent(question.questId)}`, { token, method: "DELETE" });
      setVaultItems(prev => prev.filter(v => v.id !== vaultId));
    } catch (err) {
      alert(err.message || "Could not detach evidence.");
    }
  };

  const handleSuggestionAttach = async (vaultId) => {
    setAttachingSuggestion(vaultId);
    try {
      await apiFetch(`/api/vault/${vaultId}/link`, {
        token, method: "POST",
        body: JSON.stringify({ questId: question.questId })
      });
      const data = await apiFetch(`/api/vault?questId=${encodeURIComponent(question.questId)}`, { token });
      setVaultItems(data || []);
      setIgnoredSuggestions(prev => new Set([...prev, vaultId]));
    } catch { /* silent */ }
    setAttachingSuggestion(null);
  };

  function addIntervalQC(date, interval) {
    const d = new Date(date);
    const s = (interval || "monthly").toLowerCase();
    if (s === "none") return null;
    if (s === "weekly") d.setDate(d.getDate() + 7);
    else if (s === "fortnightly") d.setDate(d.getDate() + 14);
    else if (s.includes("annual") || s.includes("year")) d.setFullYear(d.getFullYear() + 1);
    else if (s.includes("quarter")) d.setMonth(d.getMonth() + 3);
    else if (s.includes("semi") || s.includes("bi")) d.setMonth(d.getMonth() + 6);
    else d.setMonth(d.getMonth() + 1);
    return d;
  }

  const handleAnswer = (answer) => {
    onSetResponse("answer", answer);
  };

  const handleRequestEvidence = async () => {
    const email = reqEmail.trim();
    if (!email) { setReqError("Email is required"); return; }
    if (orgDomain && !isOrgEmail(email)) { setReqError(`Must be a @${orgDomain} address`); return; }
    const assignee = orgUsers?.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!assignee) { setReqError("User not found in your organisation. They may need to sign up first."); return; }
    setReqLoading(true);
    setReqError("");
    try {
      await apiFetch("/api/requests", {
        token, method: "POST",
        body: JSON.stringify({
          title: `Evidence needed for ${question.questId}`,
          description: question.requiredEvidence || `Please provide evidence for: ${question.controlArea}`,
          priority: "Medium",
          questionId: question.questId,
          assigneeId: assignee.id,
        })
      });
      setReqSuccess(true);
      setReqEmail("");
      setShowReqEvidence(false);
    } catch (e) {
      setReqError(e.message);
    } finally {
      setReqLoading(false);
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
        {question.priority && (
          <span className={`priority-badge priority-${(question.priority || '').toLowerCase()}`}>{question.priority}</span>
        )}
        {question.recurrenceInterval && question.recurrenceInterval !== "none" && (
          <span className="pill pill-recurrence">⟳ {question.recurrenceInterval}</span>
        )}
        {question.nextDueDate && (
          <span className="pill pill-due">Due: {question.nextDueDate.slice(0, 10)}</span>
        )}
        {(question.isOverdue || question.status === 'OVERDUE' || (question.nextDueDate && new Date(question.nextDueDate) < new Date())) && (
          <span className="badge-overdue">OVERDUE</span>
        )}
        {question.tags && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {question.tags.split(',').filter(t => t.trim()).map(tag => (
              <span key={tag.trim()} className="tag-badge">{tag.trim()}</span>
            ))}
          </div>
        )}
        {question.dueDate && (() => {
          const dateOnly = question.dueDate.slice(0, 10);
          const today = localToday();
          const sevenDays = new Date(Date.now() + 7*24*60*60*1000).toISOString().slice(0,10);
          const overdue = dateOnly < today && !["IMPLEMENTED","NOT_APPLICABLE"].includes(question.latestAnswer);
          const warning = !overdue && dateOnly >= today && dateOnly <= sevenDays;
          return (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`pill ${overdue ? "pill-due-overdue" : warning ? "pill-due-warning" : "pill-due"}`}>
                Due: {formatDueDate(dateOnly)}
              </span>
              {overdue && <span className="badge-overdue">OVERDUE</span>}
              {warning && <span className="badge-due-warning">Due soon</span>}
            </div>
          );
        })()}
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
              <div className="assessment-info-label">Internal Notes:</div>
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
              <div className="assessment-info-label">Reviewer Notes:</div>
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
                  Responsible person (email)
                  <input
                    type="email"
                    value={response.actionOwner || ""}
                    onChange={(e) => onSetResponse("actionOwner", e.target.value)}
                    placeholder={orgDomain ? `name@${orgDomain}` : "email@company.com"}
                  />
                  {response.actionOwner && orgDomain && !isOrgEmail(response.actionOwner) && (
                    <span style={{ fontSize: 11, color: "var(--red)", marginTop: 2, display: "block" }}>
                      Must be a @{orgDomain} address
                    </span>
                  )}
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
                  PDF, DOCX, XLSX, PNG, ZIP and more — max 10 MB
                </p>
              </div>
              <input
                type="file"
                id={inputId}
                style={{ display: "none" }}
                accept=".pdf,.docx,.png,.xlsx,.zip,.csv,.pptx,.txt,.jpg,.jpeg"
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
                        {(file.aiContributorComments || file.aiDateWarning) && (
                          <div className="ai-feedback-card">
                            <div className="ai-feedback-header">
                              <span className="ai-feedback-icon">✨</span>
                              <span className="ai-feedback-title">AI Analysis</span>
                            </div>
                            {file.aiDateWarning && (
                              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "6px 0 8px", padding: "8px 10px", background: "rgba(var(--amber-rgb,220,150,40),0.12)", border: "1px solid var(--amber,#dc9628)", borderRadius: 6 }}>
                                <span style={{ fontSize: 14, flexShrink: 0 }}>📅</span>
                                <span style={{ fontSize: 12, color: "var(--amber,#dc9628)", fontWeight: 500, lineHeight: 1.4 }}>{file.aiDateWarning}</span>
                              </div>
                            )}
                            {file.aiContributorComments && (
                              <div className="ai-feedback-body">{file.aiContributorComments}</div>
                            )}
                            {file.aiGaps && (() => {
                              try {
                                const gaps = Array.isArray(file.aiGaps) ? file.aiGaps : JSON.parse(file.aiGaps);
                                return gaps.length > 0 ? (
                                  <div className="ai-feedback-gaps">
                                    <div className="ai-feedback-gaps-header">
                                      <span className="ai-feedback-gaps-icon">⚠️</span>
                                      <span>Gaps Identified</span>
                                    </div>
                                    <ul className="ai-feedback-gaps-list">
                                      {gaps.map((gap, gi) => (
                                        <li key={gi}>{gap}</li>
                                      ))}
                                    </ul>
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

              {/* ── Link from Vault ── */}
              <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "6px 14px" }}
                  onClick={() => { setShowVaultPicker(true); loadPicker(pickerSearch); }}
                >
                  🗄 Link from Vault
                </button>
              </div>

              {/* Linked vault items */}
              {vaultItems.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {vaultItems.map(item => {
                    const due = item.uploadedAt ? addIntervalQC(item.uploadedAt, question.recurrenceInterval) : null;
                    const daysLeft = due ? Math.round((due - new Date()) / 86400000) : null;
                    const overdue = daysLeft !== null && daysLeft < 0;
                    const soon = daysLeft !== null && !overdue && daysLeft <= 14;
                    const validColor = overdue ? "var(--red)" : soon ? "var(--amber)" : "var(--green)";
                    return (
                      <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--bg3)", borderRadius: 6, marginBottom: 5, fontSize: 12 }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>
                          {item.fileType?.includes("pdf") ? "📋" : item.fileType?.startsWith("image/") ? "🖼" : "📄"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                          {due && (
                            <div style={{ fontSize: 10, color: validColor, marginTop: 1 }}>
                              {overdue
                                ? `⚠ Review overdue — ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                                : soon
                                  ? `⏳ Due in ${daysLeft}d — ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                                  : `✓ Valid until ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0 }}>Vault</span>
                        <button
                          title="Detach from this question"
                          onClick={() => handleVaultDetach(item.id)}
                          style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                        >×</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Suggested Evidence */}
              {(suggestionsLoading || (suggestions !== null && suggestions.filter(s => !ignoredSuggestions.has(s.id) && !vaultItems.some(v => v.id === s.id)).length > 0)) && (
                <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>Suggested Evidence</span>
                    <span style={{ fontSize: 9, color: "var(--text3)", background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 8, padding: "1px 6px" }}>AI</span>
                  </div>
                  {suggestionsLoading ? (
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>Scanning vault…</div>
                  ) : (
                    suggestions
                      .filter(s => !ignoredSuggestions.has(s.id) && !vaultItems.some(v => v.id === s.id))
                      .map(s => {
                        const scoreColor = s.relevanceScore >= 70 ? "var(--green)" : s.relevanceScore >= 50 ? "var(--amber)" : "var(--text3)";
                        return (
                          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 11 }}>
                            <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", border: `2px solid ${scoreColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: scoreColor }}>
                              {s.relevanceScore}%
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                              {s.reason && <div style={{ fontSize: 10, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic" }}>{s.reason}</div>}
                            </div>
                            <button className="btn btn-primary" style={{ fontSize: 10, padding: "3px 10px", flexShrink: 0 }} disabled={attachingSuggestion === s.id} onClick={() => handleSuggestionAttach(s.id)}>
                              {attachingSuggestion === s.id ? "…" : "Attach"}
                            </button>
                            <button style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 14, flexShrink: 0 }} onClick={() => setIgnoredSuggestions(prev => new Set([...prev, s.id]))}>×</button>
                          </div>
                        );
                      })
                  )}
                </div>
              )}

              {/* ── Request Evidence from someone ── */}
              <div style={{ marginTop: 14 }}>
                {reqSuccess ? (
                  <div style={{ fontSize: 13, color: "var(--green)", padding: "8px 12px", background: "rgba(34,197,94,0.1)", borderRadius: 6, display: "flex", alignItems: "center", gap: 10 }}>
                    ✓ Evidence request sent.
                    <button onClick={() => setReqSuccess(false)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 11 }}>Dismiss</button>
                  </div>
                ) : showReqEvidence ? (
                  <div style={{ padding: 14, background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border2)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Request Evidence from Someone</div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                      Enter the email of a person in your organisation who can provide this evidence.
                    </div>
                    <input
                      type="email"
                      value={reqEmail}
                      onChange={e => { setReqEmail(e.target.value); setReqError(""); }}
                      placeholder={orgDomain ? `name@${orgDomain}` : "email@company.com"}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${reqError ? "var(--red)" : "var(--border2)"}`, background: "var(--bg)", color: "var(--text)", fontSize: 13, boxSizing: "border-box", marginBottom: 6 }}
                    />
                    {reqError && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 8 }}>✗ {reqError}</div>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 12, padding: "6px 14px" }}
                        onClick={handleRequestEvidence}
                        disabled={reqLoading || !reqEmail.trim()}
                      >
                        {reqLoading ? "Sending…" : "Send Request"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "6px 14px" }}
                        onClick={() => { setShowReqEvidence(false); setReqEmail(""); setReqError(""); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "6px 14px" }}
                    onClick={() => { setShowReqEvidence(true); setReqError(""); }}
                  >
                    📋 Request Evidence from Someone
                  </button>
                )}
              </div>
            </>
          )}

          <div className="section-label">Internal Notes</div>
          <textarea
            className="comments-textarea"
            placeholder="Optional notes for the reviewer - context, exceptions, or remediation plan..."
            value={response.comment || ""}
            onChange={(e) => onSetResponse("comment", e.target.value)}
          ></textarea>

          {(assessment?.reviewerNotes || assessment?.reviewer_notes) && (
            <>
              <div className="section-label" style={{ marginTop: 12 }}>Reviewer Notes</div>
              <div style={{ padding: "10px 14px", background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, fontSize: 13, color: "var(--amber)", fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                {assessment.reviewerNotes || assessment.reviewer_notes}
              </div>
            </>
          )}

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

      {/* Vault picker modal */}
      {showVaultPicker && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowVaultPicker(false)}
        >
          <div
            style={{ background: "var(--bg2)", borderRadius: 12, padding: 20, width: 480, maxWidth: "90vw", maxHeight: "70vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Link Evidence from Vault</div>
              <button onClick={() => setShowVaultPicker(false)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 20 }}>×</button>
            </div>
            <input
              type="text"
              placeholder="Search vault…"
              value={pickerSearch}
              onChange={e => { setPickerSearch(e.target.value); loadPicker(e.target.value); }}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, marginBottom: 12, boxSizing: "border-box", width: "100%" }}
            />
            <div style={{ overflowY: "auto", flex: 1 }}>
              {pickerLoading ? (
                <div style={{ textAlign: "center", padding: 20, color: "var(--text3)", fontSize: 13 }}>Loading…</div>
              ) : pickerItems.length === 0 ? (
                <div style={{ textAlign: "center", padding: 20, color: "var(--text3)", fontSize: 13 }}>No vault items found.</div>
              ) : pickerItems.map(item => {
                const alreadyLinked = vaultItems.some(v => v.id === item.id);
                return (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg3)", borderRadius: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>
                      {item.fileType?.includes("pdf") ? "📋" : item.fileType?.startsWith("image/") ? "🖼" : "📄"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                      {item.description && <div style={{ fontSize: 11, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>}
                    </div>
                    {alreadyLinked ? (
                      <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>Linked</span>
                    ) : (
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: "5px 14px", flexShrink: 0 }}
                        disabled={linkingVaultId === item.id}
                        onClick={() => handleVaultLink(item.id)}
                      >
                        {linkingVaultId === item.id ? "…" : "Attach"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
