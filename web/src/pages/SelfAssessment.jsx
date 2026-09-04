import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import Logo from "../components/Logo";
import { apiFetch } from "../api/client.js";
import { DEPT_META, DEPT_QUESTIONS, ANSWER_OPTIONS, DEFAULT_DEPTS, expandQuestions } from "../utils/deptSelfAssessQuestions.js";

const STORAGE_KEY = (userId) => `prism_selfassess_${userId || "guest"}`;

function loadSaved(userId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToDisk(userId, data) {
  try { localStorage.setItem(STORAGE_KEY(userId), JSON.stringify(data)); } catch {}
}

// Custom (non-default) departments have no entry in DEPT_QUESTIONS, so both
// the question screen and answer-scoping below fall back to this same
// generic 6-question set — kept in one place so their ids never drift apart.
function fallbackDeptQuestions(dept) {
  return [
    { id: `${dept}-1`, text: `Do you share data / tasks with other departments??` },
    { id: `${dept}-2`, text: `Does your department directly contact clients / vendors?` },
    { id: `${dept}-3`, text: `Does ${dept} department enforce Role Based Access Control?` },
    { id: `${dept}-4`, text: `Does ${dept} process personal data (name, phone number, card details)?` },
    { id: `${dept}-5`, text: `Does ${dept} use third party software (ERP, SaaS, CRM) ?` },
    { id: `${dept}-6`, text: `Does ${dept} handle employee / client / vendor data?` },
  ];
}

function deptQuestionBase(dept) {
  return DEPT_QUESTIONS[dept] || fallbackDeptQuestions(dept);
}

// The session keeps one flat `answers` map across every department the user
// has touched. Before submitting one department's answers to the backend,
// scope it down to just that department's own question ids (base + any
// triggered follow-ups) — otherwise every department's stored submission
// ends up containing every other department's answers too, which corrupts
// per-department gap/score counts.
function getDeptAnswers(dept, answers) {
  const ids = new Set(expandQuestions(deptQuestionBase(dept), answers).map(q => q.id));
  const scoped = {};
  for (const id of ids) {
    if (answers[id] !== undefined) scoped[id] = answers[id];
  }
  return scoped;
}

function calcScore(answers, depts) {
  const byDept = {};
  for (const dept of depts) {
    const qs = expandQuestions(deptQuestionBase(dept), answers);
    let total = 0, scored = 0;
    for (const q of qs) {
      const a = answers[q.id];
      const opt = ANSWER_OPTIONS.find(o => o.value === a);
      if (!opt || opt.score === null) continue;
      total++;
      scored += opt.score;
    }
    byDept[dept] = total > 0 ? Math.round((scored / total) * 100) : null;
  }
  const vals = Object.values(byDept).filter(v => v !== null);
  const overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  return { byDept, overall };
}

function scoreLabel(pct) {
  if (pct === null) return { label: "Not assessed", color: "var(--text3)" };
  if (pct >= 80) return { label: "Strong", color: "#22c55e" };
  if (pct >= 60) return { label: "Moderate", color: "#f59e0b" };
  if (pct >= 40) return { label: "Developing", color: "#f97316" };
  return { label: "Needs work", color: "#ef4444" };
}

// ── Step components ────────────────────────────────────────────────────────────

function WelcomeStep({ onStart }) {
  return (
    <div className="self-assess-card" style={{ maxWidth: 640, textAlign: "center", margin: "40px auto" }}>
      <div className="self-assess-hero-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
      </div>
      <h1 className="self-assess-title">Compliance Self-Assessment</h1>
      <p className="self-assess-desc">
        This tool helps you understand your organisation's current data protection posture across key departments.
      </p>
      <p className="self-assess-desc" style={{ marginBottom: 28 }}>
        Select the departments you want to assess and answer a short set of questions. You'll receive a compliance score with a summary of gaps to address.
      </p>
      <div className="self-assess-alert">
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#D97706", marginBottom: 6, display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--dp-font-mono, monospace)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 22h14"></path>
            <path d="M5 2h14"></path>
            <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path>
            <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path>
          </svg>
          Pending Verification
        </div>
        <div style={{ fontSize: 13, color: "var(--dp-ink)", lineHeight: 1.6 }}>
          Your account is awaiting approval. This self-assessment gives you a head start on understanding your compliance posture. Once verified, you'll get access to the full PRISM platform with detailed assessments and remediation workflows.
        </div>
      </div>
      <button
        className="btn btn-primary"
        style={{ padding: "12px 36px", fontSize: 15, borderRadius: 12 }}
        onClick={onStart}
      >
        <span>Start Assessment →</span>
      </button>
    </div>
  );
}

function DeptSelectStep({ selected, onToggle, onCustomAdd, customDept, setCustomDept, onNext, onBack }) {
  return (
    <div className="self-assess-card" style={{ maxWidth: 760, margin: "32px auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 className="self-assess-title" style={{ fontSize: 22, marginBottom: 6 }}>Select Departments</h2>
        <p className="self-assess-desc">Choose the departments you want to assess. You can select multiple.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14, marginBottom: 24 }}>
        {DEFAULT_DEPTS.map(dept => {
          const meta = DEPT_META[dept];
          const active = selected.includes(dept);
          return (
            <button
              key={dept}
              onClick={() => onToggle(dept)}
              className={`self-assess-dept-card ${active ? "selected" : ""}`}
            >
              <div style={{ fontSize: 26, marginBottom: 8 }}>{meta.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: active ? "var(--dp-accent, #4F46E5)" : "var(--dp-ink)", marginBottom: 4 }}>{meta.label}</div>
              <div style={{ fontSize: 12, color: "var(--dp-quiet)", lineHeight: 1.45 }}>{meta.description}</div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <input
          type="text"
          value={customDept}
          onChange={e => setCustomDept(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && customDept.trim()) { onCustomAdd(); } }}
          placeholder="Add custom department…"
          className="link-input"
          style={{ padding: "10px 14px" }}
        />
        <button
          className="btn btn-ghost"
          disabled={!customDept.trim()}
          onClick={onCustomAdd}
          style={{ height: 40 }}
        >
          Add
        </button>
      </div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {selected.map(dept => {
            const isCustom = !DEFAULT_DEPTS.includes(dept);
            const meta = DEPT_META[dept];
            return (
              <div
                key={dept}
                className="pill pill-module"
                style={{ fontSize: 12.5 }}
              >
                <span>{meta ? `${meta.icon} ${meta.label}` : dept}</span>
                {isCustom && (
                  <button
                    onClick={() => onToggle(dept)}
                    aria-label={`Remove ${dept}`}
                    style={{ background: "none", border: "none", color: "var(--dp-quiet)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 4 }}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" disabled={selected.length === 0} onClick={onNext}>
          <span>Continue →</span>
        </button>
      </div>
    </div>
  );
}

function CollaboratorInput({ dept, collaborators, onChange, orgDomain, token, userRole }) {
  const current = collaborators[dept] || [];
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(null);
  const canInvite = userRole === "ADMIN" || userRole === "LEAD";

  const sendInvite = async () => {
    const email = input.trim().toLowerCase();
    if (!email) return;
    if (orgDomain && !email.endsWith("@" + orgDomain)) {
      setError(`Must be a @${orgDomain} address`);
      return;
    }
    if (current.some(c => c.email === email)) { setError("Already invited"); return; }
    setSending(true);
    setError("");
    try {
      const data = await apiFetch("/api/users/invite", { token, method: "POST", body: JSON.stringify({ email, role: "CONTRIBUTOR", department: dept }) });
      onChange(dept, [...current, { email, inviteLink: data.inviteLink || null }]);
      setInput("");
    } catch (e) {
      setError(e.message || "Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const copyLink = (email, link) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(email);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const remove = (email) => onChange(dept, current.filter(c => c.email !== email));

  return (
    <div style={{ marginTop: 20, padding: "14px 16px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Collaborators
      </div>
      {current.map(c => (
        <div key={c.email} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg3)", borderRadius: 6, padding: "6px 10px" }}>
            <span style={{ fontSize: 13, flex: 1, color: "var(--text)" }}>{c.email}</span>
            <span style={{ fontSize: 11, color: "var(--green, #22c55e)" }}>✓ Invite sent</span>
            <button
              onClick={() => remove(c.email)}
              style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
            >×</button>
          </div>
          {c.inviteLink && (
            <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                readOnly
                value={c.inviteLink}
                style={{
                  flex: 1, padding: "5px 8px", borderRadius: 5, fontSize: 11,
                  border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text3)",
                  fontFamily: "monospace",
                }}
                onFocus={e => e.target.select()}
              />
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap" }}
                onClick={() => copyLink(c.email, c.inviteLink)}
              >
                {copied === c.email ? "Copied!" : "Copy link"}
              </button>
            </div>
          )}
        </div>
      ))}
      {canInvite && (
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            type="email"
            value={input}
            onChange={e => { setInput(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && sendInvite()}
            placeholder={orgDomain ? `name@${orgDomain}` : "colleague@company.com"}
            style={{
              flex: 1, padding: "7px 10px", borderRadius: 6,
              border: `1px solid ${error ? "var(--red, #ef4444)" : "var(--border2)"}`,
              background: "var(--bg)", color: "var(--text)", fontSize: 12,
            }}
          />
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} onClick={sendInvite} disabled={!input.trim() || sending}>
            {sending ? "Sending…" : "Invite"}
          </button>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: "var(--red, #ef4444)", marginTop: 4 }}>✗ {error}</div>}
      {current.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8, fontStyle: "italic" }}>
          Invited colleagues will receive a link to join the workspace and access this self-assessment.
        </div>
      )}
    </div>
  );
}

function CollabsStep({ depts, collaborators, onChange, orgDomain, token, userRole, onNext, onBack }) {
  return (
    <div className="self-assess-card" style={{ maxWidth: 760, margin: "32px auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 className="self-assess-title" style={{ fontSize: 22, marginBottom: 6 }}>Add Collaborators</h2>
        <p className="self-assess-desc">
          Optionally invite colleagues to help answer questions for each department before you begin. You can skip this and continue on your own.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
        {depts.map(dept => {
          const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
          return (
            <div key={dept}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>{meta.icon}</span>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--dp-ink)" }}>{meta.label}</span>
              </div>
              <CollaboratorInput
                dept={dept}
                collaborators={collaborators}
                onChange={onChange}
                orgDomain={orgDomain}
                token={token}
                userRole={userRole}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={onNext}>
          <span>Start Questions →</span>
        </button>
      </div>
    </div>
  );
}

function QuestionStep({ dept, questions, answers, onAnswer, onNext, onBack, deptIndex, totalDepts, collaborators }) {
  const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
  const answered = questions.filter(q => answers[q.id]).length;
  const progress = Math.round((answered / questions.length) * 100);
  const delegatedTo = collaborators?.[dept] || [];
  const [answerMyself, setAnswerMyself] = useState(false);
  const isDelegated = delegatedTo.length > 0 && !answerMyself;

  return (
    <div className="self-assess-card" style={{ maxWidth: 760, margin: "32px auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <span style={{ fontSize: 32 }}>{meta.icon}</span>
        <div>
          <div style={{ fontSize: 11.5, fontFamily: "var(--dp-font-mono, monospace)", color: "var(--dp-quiet)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 2 }}>
            Department {deptIndex + 1} of {totalDepts}
          </div>
          <h2 className="self-assess-title" style={{ fontSize: 20, marginBottom: 0 }}>{meta.label}</h2>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <span className="pill" style={{ fontSize: 12, fontWeight: 700 }}>
            {answered} / {questions.length} answered
          </span>
        </div>
      </div>

      {isDelegated ? (
        <div className="self-assess-alert" style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🔗</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dp-ink)", marginBottom: 6 }}>Delegated to the department head</div>
          <p style={{ fontSize: 13.5, color: "var(--dp-quiet)", lineHeight: 1.6, marginBottom: 16 }}>
            Copy the link below and send it to the department head. Once they fill it in, results will appear here automatically — you don't need to answer these questions yourself.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {delegatedTo.map(c => (
              <div key={c.email}>
                <div style={{ fontSize: 12, color: "var(--dp-quiet)", marginBottom: 4, fontFamily: "var(--dp-font-mono)" }}>{c.email}</div>
                {c.inviteLink && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      readOnly
                      value={c.inviteLink}
                      className="link-input"
                      style={{ padding: "8px 12px", fontSize: 12 }}
                      onFocus={e => e.target.select()}
                    />
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap" }}
                      onClick={() => navigator.clipboard.writeText(c.inviteLink)}
                    >
                      Copy link
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setAnswerMyself(true)}>
            Answer it myself instead
          </button>
        </div>
      ) : (
        <>
          {delegatedTo.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--dp-quiet)", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Answering on behalf of this department (also delegated to {delegatedTo.map(c => c.email).join(", ")})</span>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setAnswerMyself(false)}>
                Undo
              </button>
            </div>
          )}
          <div style={{ height: 6, background: "var(--dp-surface-2)", borderRadius: 999, boxShadow: "var(--neu-inset-sm)", marginBottom: 24, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #4F46E5 0%, #6366F1 100%)", borderRadius: 999, transition: "width 0.3s" }} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {(() => {
          let mainCount = 0;
          return questions.map((q, i) => {
            const selected = answers[q.id];
            const isFollowUp = !!q.parentId;
            if (!isFollowUp) mainCount++;
            const showSection = !isFollowUp && q.section && (i === 0 || questions[i - 1]?.section !== q.section);
            return (
              <div key={q.id} style={isFollowUp ? { marginLeft: 20, borderLeft: "2px solid var(--dp-line)", paddingLeft: 14 } : undefined}>
                {showSection && (
                  <div style={{
                    fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                    color: "var(--dp-accent, #4F46E5)", padding: "16px 0 8px", borderBottom: "1px solid var(--dp-line)",
                    marginBottom: 10, fontFamily: "var(--dp-font-mono, monospace)"
                  }}>
                    {q.section}
                  </div>
                )}
                <div className="self-assess-q-card">
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--dp-ink)", marginBottom: 12, lineHeight: 1.55 }}>
                    {isFollowUp ? (
                      <span style={{ color: "var(--dp-accent, #4F46E5)", marginRight: 8, fontWeight: 700 }}>↳</span>
                    ) : (
                      <span style={{ color: "var(--dp-quiet)", marginRight: 8, fontWeight: 700, fontFamily: "var(--dp-font-mono)" }}>{mainCount}.</span>
                    )}
                    {q.text}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ANSWER_OPTIONS.map(opt => {
                    let activeClass = "";
                    if (selected === opt.value) {
                      if (opt.value === "YES") activeClass = "selected-yes";
                      else if (opt.value === "PARTIAL") activeClass = "selected-partial";
                      else if (opt.value === "NO") activeClass = "selected-no";
                      else activeClass = "selected-na";
                    }
                    return (
                      <button
                        key={opt.value}
                        onClick={() => onAnswer(q.id, opt.value)}
                        className={`self-assess-ans-btn ${activeClass}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
          });
        })()}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        {onBack && <button className="btn btn-ghost" onClick={onBack}>← Back</button>}
        <button className="btn btn-primary" onClick={onNext}>
          <span>{deptIndex < totalDepts - 1 ? "Next Department →" : "View Results →"}</span>
        </button>
      </div>
    </div>
  );
}

function ResultsStep({ selectedDepts, answers, onRetake, onLogout, onViewReport, submitting }) {
  const { byDept, overall } = useMemo(() => calcScore(answers, selectedDepts), [answers, selectedDepts]);
  const overallLabel = scoreLabel(overall);

  return (
    <div className="self-assess-card" style={{ maxWidth: 760, margin: "32px auto" }}>
      <h2 className="self-assess-title" style={{ fontSize: 24, marginBottom: 6 }}>Your Compliance Assessment</h2>
      <p className="self-assess-desc" style={{ marginBottom: 28 }}>
        Based on your responses across {selectedDepts.length} department{selectedDepts.length !== 1 ? "s" : ""}.
      </p>

      {/* Overall score */}
      <div style={{ background: "var(--dp-surface-gradient)", border: "1px solid var(--dp-line)", borderRadius: 16, padding: "28px 32px", marginBottom: 24, display: "flex", alignItems: "center", gap: 24, boxShadow: "var(--neu-raised-sm)" }}>
        <div style={{
          width: 88, height: 88, borderRadius: "50%", flexShrink: 0,
          border: `4px solid ${overallLabel.color}`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          boxShadow: "var(--neu-raised-sm)",
          background: "var(--dp-surface-2)",
        }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: overallLabel.color, fontFamily: "var(--dp-font-mono, monospace)" }}>{overall ?? "—"}%</div>
        </div>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, color: "var(--dp-ink)", marginBottom: 6 }}>
            Overall: <span style={{ color: overallLabel.color }}>{overallLabel.label}</span>
          </div>
          <div style={{ fontSize: 13.5, color: "var(--dp-quiet)", lineHeight: 1.6 }}>
            This score reflects your self-reported compliance posture. Once your account is verified, PRISM will help you remediate gaps with structured workflows and evidence management.
          </div>
        </div>
      </div>

      {/* Per-dept breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        {selectedDepts.map(dept => {
          const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
          const pct = byDept[dept];
          const { label, color } = scoreLabel(pct);
          const qs = expandQuestions(deptQuestionBase(dept), answers);
          const answeredCount = qs.filter(q => answers[q.id] && answers[q.id] !== "NA").length;
          const noCount = qs.filter(q => answers[q.id] === "NO").length;
          const partialCount = qs.filter(q => answers[q.id] === "PARTIAL").length;
          return (
            <div key={dept} className="self-assess-q-card" style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 24 }}>{meta.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--dp-ink)" }}>{meta.label}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "var(--dp-font-mono)" }}>{pct !== null ? `${pct}%` : "—"}</div>
                  <div style={{ fontSize: 11.5, color, fontWeight: 600 }}>{label}</div>
                </div>
              </div>
              <div style={{ height: 6, background: "var(--dp-surface-2)", borderRadius: 999, boxShadow: "var(--neu-inset-sm)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct ?? 0}%`, background: color, borderRadius: 999, transition: "width 0.5s" }} />
              </div>
              {(noCount > 0 || partialCount > 0) && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--dp-quiet)" }}>
                  {noCount > 0 && <span style={{ color: "var(--red, #EF4444)", marginRight: 12, fontWeight: 600 }}>✗ {noCount} gap{noCount !== 1 ? "s" : ""}</span>}
                  {partialCount > 0 && <span style={{ color: "var(--amber, #F59E0B)", fontWeight: 600 }}>⚠ {partialCount} partial</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pending verification callout */}
      <div style={{ background: "var(--dp-accent-light, rgba(79,70,229,0.08))", border: "1px solid rgba(79,70,229,0.25)", borderRadius: 14, padding: "18px 22px", marginBottom: 28, boxShadow: "var(--neu-raised-sm)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dp-accent, #4F46E5)", marginBottom: 6 }}>What happens next?</div>
        <div style={{ fontSize: 13.5, color: "var(--dp-ink)", lineHeight: 1.65 }}>
          Once a PRISM administrator verifies your account, you'll receive access to the full platform — including the DPDPA compliance tracker, evidence vault, AI-assisted gap analysis, and remediation workflows tailored to your organisation.
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {onRetake && <button className="btn btn-ghost" onClick={onRetake}>↺ Retake</button>}
        {onViewReport && (
          <button className="btn btn-primary" onClick={onViewReport} disabled={submitting}>
            <span>{submitting ? "Saving…" : "📊 Team Report"}</span>
          </button>
        )}
        <button className="btn btn-ghost" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}

// Wraps the server-built report HTML in a minimal document for the iframe /
// new-tab view. The report body already carries all its own inline styles.
function wrapReportDoc(inner) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Team Self-Assessment Report</title>` +
    `<link rel="preconnect" href="https://fonts.googleapis.com">` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Sora:wght@400;500;600;700;800&display=swap" rel="stylesheet">` +
    `<style>
      html, body {
        margin: 0;
        padding: 0;
        background: #E8EEF6;
        font-family: 'Sora', 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        color: #1E293B;
      }
      a { color: #4F46E5; }
    </style>` +
    `</head><body>${inner}</body></html>`;
}

// The in-app "Team Report". Renders the exact HTML document the server builds
// (and emails) inside an auto-sized iframe, so the in-app view, the emailed
// report, and the printable/PDF version are always identical — there is no
// second React re-implementation to drift.
function ReportStep({ token, onBack }) {
  const [state, setState] = useState({ status: "loading" });
  const iframeRef = useRef(null);

  useEffect(() => {
    apiFetch("/api/self-assessment", { token })
      .then(data => {
        if (!data?.submissions?.length) return setState({ status: "empty" });
        const html = data?.report?.html;
        if (!html) return setState({ status: "stale" });
        setState({ status: "ready", html });
      })
      .catch(err => setState({ status: "error", message: err.message || "Failed to load report" }));
  }, [token]);

  const fitIframe = () => {
    const f = iframeRef.current;
    try {
      const h = f?.contentWindow?.document?.documentElement?.scrollHeight;
      if (h) f.style.height = (h + 40) + "px";
    } catch { /* cross-origin guard */ }
  };

  function openInNewTab() {
    if (state.status !== "ready") return;
    const url = URL.createObjectURL(new Blob([wrapReportDoc(state.html)], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "28px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Back to Results</span>
        </button>
        {state.status === "ready" && (
          <button className="btn btn-primary" onClick={openInNewTab}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            <span>Open / Print Report</span>
          </button>
        )}
      </div>

      {state.status === "loading" && (
        <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--dp-quiet)" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
          Generating team report…
        </div>
      )}

      {state.status === "error" && (
        <p style={{ color: "var(--red, #ef4444)", fontSize: 14 }}>{state.message}</p>
      )}

      {state.status === "empty" && (
        <p style={{ color: "var(--dp-quiet)", fontSize: 14 }}>
          No submissions yet. Invite colleagues and ask them to complete their department assessment.
        </p>
      )}

      {state.status === "stale" && (
        <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: "14px 18px", fontSize: 13.5, color: "var(--dp-ink)", lineHeight: 1.6 }}>
          The API is serving an older build that doesn't generate this report. Restart it —{" "}
          <code>docker compose up -d &amp;&amp; docker compose restart api</code> — then reopen this page.
        </div>
      )}

      {state.status === "ready" && (
        <div style={{ border: "1px solid var(--dp-line)", borderRadius: 18, overflow: "hidden", background: "#FFFFFF", boxShadow: "var(--neu-raised)" }}>
          <iframe
            ref={iframeRef}
            title="Team Self-Assessment Report"
            srcDoc={wrapReportDoc(state.html)}
            onLoad={fitIframe}
            style={{ width: "100%", border: "none", display: "block", minHeight: 650 }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SelfAssessment({ user, token, onLogout }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lockedDept = searchParams.get("dept") || null;

  const saved = lockedDept ? null : loadSaved(user?.id);

  const [step, setStep] = useState(() => {
    if (lockedDept) return "questions";
    return saved?.step ?? "welcome";
  });
  const [selectedDepts, setSelectedDepts] = useState(() => {
    if (lockedDept) return [lockedDept];
    return saved?.selectedDepts ?? [];
  });
  const [customDept, setCustomDept] = useState("");
  const [deptIndex, setDeptIndex] = useState(saved?.deptIndex ?? 0);
  const [answers, setAnswers] = useState(saved?.answers ?? {});
  const [collaborators, setCollaborators] = useState(saved?.collaborators ?? {});
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submitAnswersToBackend = async (depts, answers) => {
    if (!token) return;
    setSubmitting(true);
    try {
      await Promise.all(
        depts.map(dept => {
          const scoped = getDeptAnswers(dept, answers);
          // Nothing answered — most likely a delegated department the admin
          // never filled in themselves. Skip it rather than overwriting
          // whatever the department head already submitted with an empty row.
          if (Object.keys(scoped).length === 0) return Promise.resolve();
          return apiFetch("/api/self-assessment", {
            token,
            method: "POST",
            body: JSON.stringify({ department: dept, answers: scoped }),
          }).catch(() => {});
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  const orgDomain = user?.email ? user.email.split("@")[1] : null;

  const persist = (patch) => {
    const next = { step, selectedDepts, deptIndex, answers, collaborators, ...patch };
    saveToDisk(user?.id, next);
    return next;
  };

  const handleSaveProgress = () => {
    persist({});
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  const goToPreviousStep = useCallback(() => {
    if (step === "questions") {
      if (deptIndex === 0) {
        setStep("collabs");
        persist({ step: "collabs" });
      } else {
        const prev = deptIndex - 1;
        setDeptIndex(prev);
        persist({ deptIndex: prev });
      }
    } else if (step === "results") {
      setStep("questions");
      persist({ step: "questions" });
    } else if (step === "collabs") {
      setStep("depts");
      persist({ step: "depts" });
    } else if (step === "depts") {
      setStep("welcome");
      persist({ step: "welcome" });
    }
  }, [step, deptIndex]);

  // Keep a ref to the latest goToPreviousStep and step so the popstate handler
  // doesn't go stale when step changes. A single handler registered once on mount
  // means at most ONE extra sentinel entry in history instead of one per step change.
  const goToPreviousStepRef = useRef(goToPreviousStep);
  const stepRef = useRef(step);
  useEffect(() => { goToPreviousStepRef.current = goToPreviousStep; }, [goToPreviousStep]);
  useEffect(() => { stepRef.current = step; }, [step]);

  useEffect(() => {
    // Push ONE sentinel via React Router so its internal history idx stays correct.
    // The handler re-pushes after each back press so there's always a sentinel to catch
    // the next back, but consume-one/push-one means at most two /self-assess entries total.
    navigate(location.pathname + location.search, { replace: false });

    const handler = () => {
      if (stepRef.current === "welcome") return; // let browser back exit normally from welcome
      navigate(location.pathname + location.search, { replace: false });
      goToPreviousStepRef.current();
    };

    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs only on mount

  const toggleDept = (dept) => {
    setSelectedDepts(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  const addCustomDept = () => {
    const d = customDept.trim();
    if (!d || selectedDepts.includes(d)) { setCustomDept(""); return; }
    setSelectedDepts(prev => [...prev, d]);
    setCustomDept("");
  };

  const answer = (qId, value) => {
    const next = { ...answers, [qId]: value };
    setAnswers(next);
    persist({ answers: next });
  };

  const handleCollaboratorsChange = (dept, entries) => {
    const next = { ...collaborators, [dept]: entries };
    setCollaborators(next);
    persist({ collaborators: next });
  };

  const currentDept = selectedDepts[deptIndex];
  const currentQuestionsBase = currentDept ? deptQuestionBase(currentDept) : [];
  const currentQuestions = expandQuestions(currentQuestionsBase, answers);

  const goToStep = (s, extra = {}) => {
    setStep(s);
    persist({ step: s, ...extra });
  };

  return (
    <div className="self-assess-shell">
      {/* Pending banner */}
      <div className="self-assess-top-banner">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 22h14"></path>
          <path d="M5 2h14"></path>
          <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path>
          <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path>
        </svg>
        <span>Your account is pending admin verification. Complete this self-assessment while you wait.</span>
      </div>

      {/* Header */}
      <div className="self-assess-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Logo style={{ height: 32 }} />
          <span className="self-assess-header-title">
            Compliance Self-Assessment
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="pill" style={{ fontSize: 12.5, fontWeight: 600 }}>{user?.email}</span>
          {step !== "welcome" && step !== "results" && (
            <button
              className="btn btn-ghost"
              style={{ color: savedFeedback ? "var(--green, #10B981)" : undefined, borderColor: savedFeedback ? "var(--green, #10B981)" : undefined }}
              onClick={handleSaveProgress}
            >
              {savedFeedback ? "✓ Saved" : "Save Progress"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      {/* Step progress bar */}
      {step !== "welcome" && step !== "report" && (
        <div style={{ padding: "0 28px" }}>
          <div style={{ display: "flex", gap: 6, padding: "16px 0 0", maxWidth: 760, margin: "0 auto" }}>
            {["depts", "collabs", ...selectedDepts, "results"].map((s, i) => {
              const stepOrder = ["welcome", "depts", "collabs", ...selectedDepts, "results"];
              const current = stepOrder.indexOf(step);
              const done = i < current - 1;
              const active = s === step || (step === `q-${selectedDepts[deptIndex]}` && s === selectedDepts[deptIndex]);
              return (
                <div
                  key={s}
                  style={{
                    flex: 1,
                    height: 5,
                    borderRadius: 999,
                    background: done || active ? "linear-gradient(90deg, #4F46E5 0%, #6366F1 100%)" : "var(--dp-surface-2)",
                    boxShadow: done || active ? "0 1px 4px rgba(79, 70, 229, 0.4)" : "var(--neu-inset-sm)",
                    opacity: done || active ? 1 : 0.6,
                    transition: "all 0.3s ease"
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Step content */}
      <div style={{ paddingTop: 12 }}>
        {lockedDept && step === "questions" && (
          <div style={{
            maxWidth: 680, margin: "0 auto 0", padding: "10px 24px 0",
            fontSize: 13, color: "var(--text2)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontWeight: 600, color: "var(--accent)" }}>
              {(DEPT_META[lockedDept] || {}).icon || "🏢"} {(DEPT_META[lockedDept] || {}).label || lockedDept}
            </span>
            <span style={{ color: "var(--text3)" }}>— you've been invited to assess this department</span>
          </div>
        )}

        {!lockedDept && step === "welcome" && (
          <WelcomeStep onStart={() => goToStep("depts")} />
        )}
        {!lockedDept && step === "depts" && (
          <DeptSelectStep
            selected={selectedDepts}
            onToggle={toggleDept}
            customDept={customDept}
            setCustomDept={setCustomDept}
            onCustomAdd={addCustomDept}
            onBack={() => goToStep("welcome")}
            onNext={() => goToStep("collabs")}
          />
        )}
        {!lockedDept && step === "collabs" && (
          <CollabsStep
            depts={selectedDepts}
            collaborators={collaborators}
            onChange={handleCollaboratorsChange}
            orgDomain={orgDomain}
            token={token}
            userRole={user?.role}
            onBack={() => goToStep("depts")}
            onNext={() => { setDeptIndex(0); goToStep("questions", { deptIndex: 0 }); }}
          />
        )}
        {step === "questions" && currentDept && (
          <QuestionStep
            key={currentDept}
            dept={currentDept}
            questions={currentQuestions}
            answers={answers}
            onAnswer={answer}
            deptIndex={deptIndex}
            totalDepts={selectedDepts.length}
            collaborators={collaborators}
            onBack={lockedDept ? null : () => {
              if (deptIndex === 0) { goToStep("collabs"); }
              else { const prev = deptIndex - 1; setDeptIndex(prev); persist({ deptIndex: prev }); }
            }}
            onNext={() => {
              if (deptIndex < selectedDepts.length - 1) {
                const next = deptIndex + 1;
                setDeptIndex(next);
                persist({ deptIndex: next });
              } else {
                submitAnswersToBackend(selectedDepts, answers);
                goToStep("results");
              }
            }}
          />
        )}
        {step === "results" && (
          <ResultsStep
            selectedDepts={selectedDepts}
            answers={answers}
            onRetake={lockedDept ? null : () => {
              setStep("welcome");
              setSelectedDepts([]);
              setDeptIndex(0);
              setAnswers({});
              saveToDisk(user?.id, null);
            }}
            onLogout={onLogout}
            onViewReport={user?.role === "ADMIN" || user?.role === "LEAD" ? () => setStep("report") : null}
            submitting={submitting}
          />
        )}
        {step === "report" && (
          <ReportStep token={token} onBack={() => setStep("results")} />
        )}
      </div>
    </div>
  );
}
