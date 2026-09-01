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
    <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ fontSize: 56, marginBottom: 20 }}>🛡️</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>Compliance Self-Assessment</h1>
      <p style={{ fontSize: 15, color: "var(--text2)", lineHeight: 1.7, marginBottom: 12 }}>
        This tool helps you understand your organisation's current data protection posture across key departments.
      </p>
      <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, marginBottom: 32 }}>
        Select the departments you want to assess and answer a short set of questions. You'll receive a compliance score with a summary of gaps to address.
      </p>
      <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 32, textAlign: "left" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b", marginBottom: 4 }}>⏳ Pending Verification</div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
          Your account is awaiting approval. This self-assessment gives you a head start on understanding your compliance posture. Once verified, you'll get access to the full PRISM platform with detailed assessments and remediation workflows.
        </div>
      </div>
      <button
        className="btn btn-primary"
        style={{ padding: "12px 36px", fontSize: 15, borderRadius: 10 }}
        onClick={onStart}
      >
        Start Assessment →
      </button>
    </div>
  );
}

function DeptSelectStep({ selected, onToggle, onCustomAdd, customDept, setCustomDept, onNext, onBack }) {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Select Departments</h2>
        <p style={{ fontSize: 14, color: "var(--text2)" }}>Choose the departments you want to assess. You can select multiple.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
        {DEFAULT_DEPTS.map(dept => {
          const meta = DEPT_META[dept];
          const active = selected.includes(dept);
          return (
            <button
              key={dept}
              onClick={() => onToggle(dept)}
              style={{
                padding: "16px 14px", borderRadius: 10, border: `2px solid ${active ? "var(--accent)" : "var(--border2)"}`,
                background: active ? "rgba(99,102,241,0.08)" : "var(--bg2)",
                textAlign: "left", cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>{meta.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: active ? "var(--accent)" : "var(--text)", marginBottom: 4 }}>{meta.label}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.4 }}>{meta.description}</div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        <input
          type="text"
          value={customDept}
          onChange={e => setCustomDept(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && customDept.trim()) { onCustomAdd(); } }}
          placeholder="Add custom department…"
          style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13 }}
        />
        <button
          className="btn btn-ghost"
          disabled={!customDept.trim()}
          onClick={onCustomAdd}
        >
          Add
        </button>
      </div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {selected.map(dept => {
            const isCustom = !DEFAULT_DEPTS.includes(dept);
            const meta = DEPT_META[dept];
            return (
              <div
                key={dept}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--bg3)", border: "1px solid var(--border2)",
                  borderRadius: 20, padding: "5px 10px 5px 12px", fontSize: 12, color: "var(--text)",
                }}
              >
                <span>{meta ? `${meta.icon} ${meta.label}` : dept}</span>
                {isCustom && (
                  <button
                    onClick={() => onToggle(dept)}
                    aria-label={`Remove ${dept}`}
                    style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}
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
          Continue →
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
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Add Collaborators</h2>
        <p style={{ fontSize: 14, color: "var(--text2)" }}>
          Optionally invite colleagues to help answer questions for each department before you begin. You can skip this and continue on your own.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
        {depts.map(dept => {
          const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
          return (
            <div key={dept}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{meta.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{meta.label}</span>
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
          Start Questions →
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
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 28 }}>{meta.icon}</span>
        <div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 2 }}>
            Department {deptIndex + 1} of {totalDepts}
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{meta.label}</h2>
        </div>
      </div>

      {isDelegated ? (
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "20px 24px", marginBottom: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🔗</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Delegated to the department head</div>
          <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 16 }}>
            Copy the link below and send it to the department head. Once they fill it in, results will appear here automatically — you don't need to answer these questions yourself.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {delegatedTo.map(c => (
              <div key={c.email}>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>{c.email}</div>
                {c.inviteLink && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      readOnly
                      value={c.inviteLink}
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text2)", fontFamily: "monospace" }}
                      onFocus={e => e.target.select()}
                    />
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
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
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Answering on behalf of this department (also delegated to {delegatedTo.map(c => c.email).join(", ")})</span>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setAnswerMyself(false)}>
                Undo
              </button>
            </div>
          )}
          <div style={{ height: 4, background: "var(--bg4)", borderRadius: 2, marginBottom: 24 }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.3s" }} />
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
              <div key={q.id} style={isFollowUp ? { marginLeft: 20, borderLeft: "2px solid var(--border2)", paddingLeft: 12 } : undefined}>
                {showSection && (
                  <div style={{
                    fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                    color: "var(--accent)", padding: "16px 0 6px", borderBottom: "1px solid var(--border2)",
                    marginBottom: 8,
                  }}>
                    {q.section}
                  </div>
                )}
                <div style={{ background: "var(--bg2)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border2)" }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 10, lineHeight: 1.5 }}>
                    {isFollowUp ? (
                      <span style={{ color: "var(--accent)", marginRight: 8, fontWeight: 700 }}>↳</span>
                    ) : (
                      <span style={{ color: "var(--text3)", marginRight: 8, fontWeight: 700 }}>{mainCount}.</span>
                    )}
                    {q.text}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ANSWER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => onAnswer(q.id, opt.value)}
                      style={{
                        padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${selected === opt.value ? opt.color : "var(--border2)"}`,
                        background: selected === opt.value ? opt.bg : "var(--bg3)",
                        color: selected === opt.value ? opt.color : "var(--text2)",
                        transition: "all 0.15s",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
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
          {deptIndex < totalDepts - 1 ? "Next Department →" : "View Results →"}
        </button>
      </div>
    </div>
  );
}

function ResultsStep({ selectedDepts, answers, onRetake, onLogout, onViewReport, submitting }) {
  const { byDept, overall } = useMemo(() => calcScore(answers, selectedDepts), [answers, selectedDepts]);
  const overallLabel = scoreLabel(overall);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Your Compliance Assessment</h2>
      <p style={{ fontSize: 14, color: "var(--text2)", marginBottom: 24 }}>
        Based on your responses across {selectedDepts.length} department{selectedDepts.length !== 1 ? "s" : ""}.
      </p>

      {/* Overall score */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "24px 28px", marginBottom: 20, display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%", flexShrink: 0,
          border: `4px solid ${overallLabel.color}`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: overallLabel.color }}>{overall ?? "—"}%</div>
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
            Overall: <span style={{ color: overallLabel.color }}>{overallLabel.label}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
            This score reflects your self-reported compliance posture. Once your account is verified, PRISM will help you remediate gaps with structured workflows and evidence management.
          </div>
        </div>
      </div>

      {/* Per-dept breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {selectedDepts.map(dept => {
          const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
          const pct = byDept[dept];
          const { label, color } = scoreLabel(pct);
          const qs = expandQuestions(deptQuestionBase(dept), answers);
          const answeredCount = qs.filter(q => answers[q.id] && answers[q.id] !== "NA").length;
          const noCount = qs.filter(q => answers[q.id] === "NO").length;
          const partialCount = qs.filter(q => answers[q.id] === "PARTIAL").length;
          return (
            <div key={dept} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{meta.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{meta.label}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color }}>{pct !== null ? `${pct}%` : "—"}</div>
                  <div style={{ fontSize: 11, color }}>{label}</div>
                </div>
              </div>
              <div style={{ height: 6, background: "var(--bg4)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct ?? 0}%`, background: color, borderRadius: 3, transition: "width 0.5s" }} />
              </div>
              {(noCount > 0 || partialCount > 0) && (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text3)" }}>
                  {noCount > 0 && <span style={{ color: "#ef4444", marginRight: 10 }}>✗ {noCount} gap{noCount !== 1 ? "s" : ""}</span>}
                  {partialCount > 0 && <span style={{ color: "#f59e0b" }}>⚠ {partialCount} partial</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pending verification callout */}
      <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 10, padding: "16px 20px", marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", marginBottom: 6 }}>What happens next?</div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
          Once a PRISM administrator verifies your account, you'll receive access to the full platform — including the DPDPA compliance tracker, evidence vault, AI-assisted gap analysis, and remediation workflows tailored to your organisation.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {onRetake && <button className="btn btn-ghost" onClick={onRetake}>↺ Retake</button>}
        {onViewReport && (
          <button className="btn btn-primary" onClick={onViewReport} disabled={submitting}>
            {submitting ? "Saving…" : "📊 Team Report"}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}

// One report section: a heading with the same spectrum underline used in the
// emailed report, plus its content. Keeps ReportStep's sections visually and
// structurally consistent without repeating the heading markup each time.
function ReportSection({ title, subtitle, children }) {
  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: subtitle ? 2 : 12 }}>{title}</h3>
      {subtitle && <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 12, lineHeight: 1.5 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function RoadmapPhase({ label, actions }) {
  if (!actions?.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{label}</div>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        {actions.map((a, i) => (
          <li key={i} style={{ fontSize: 12.5, color: "var(--text2)", marginBottom: 6, lineHeight: 1.5 }}>{a}</li>
        ))}
      </ol>
    </div>
  );
}

function ReportStep({ token, onBack }) {
  const [submissions, setSubmissions] = useState(null);
  const [extendedReport, setExtendedReport] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/self-assessment", { token })
      .then(data => {
        setSubmissions(data?.submissions || []);
        setExtendedReport(data?.report || null);
      })
      .catch(err => setError(err.message || "Failed to load report"));
  }, [token]);

  if (error) return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={onBack}>← Back</button>
      <p style={{ color: "var(--red, #ef4444)" }}>{error}</p>
    </div>
  );

  if (!submissions) return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px", textAlign: "center", color: "var(--text3)" }}>
      <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
      Loading team report…
    </div>
  );

  if (submissions.length === 0 || !extendedReport) return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={onBack}>← Back</button>
      <p style={{ color: "var(--text3)", fontSize: 14 }}>No submissions yet. Invite colleagues and ask them to complete their department assessment.</p>
    </div>
  );

  const {
    overallScore, priorityFocus = [], quickWins = [],
    dataQualityNotes = [], roadmap, riskRewardRows = [], regulatoryExposure = [],
    regulatoryExposureSource, executiveSummary, requestedByEmail, html: reportHtml,
  } = extendedReport;
  const overallLabel = scoreLabel(overallScore);

  // Tolerate an older API build that hasn't picked up the new report shape:
  // normalise each dept row so gap/partial lists are always arrays, and detect
  // a stale response (no roadmap/exec-summary) so we can tell the user why the
  // page looks thin instead of white-screening on a missing field.
  const deptRows = (extendedReport.deptRows || []).map(d => ({
    ...d,
    gapQuestions: d.gapQuestions || [],
    partialQuestions: d.partialQuestions || [],
    openItems: d.openItems ?? ((d.gapCount || 0) + (d.partialCount || 0)),
  }));
  const staleApiShape = !roadmap && !executiveSummary;

  // Per-submitter scores for the "Submitted by" chips — the only thing this
  // step still computes client-side. Everything else (gap/partial text,
  // scores, priority ranking, roadmap, regulatory mapping) comes straight
  // from the server report, so what's shown here always matches what was
  // just emailed to REPORT_RECIPIENT.
  const byDept = {};
  for (const s of submissions) (byDept[s.department] ||= []).push(s);

  // Opens the exact HTML that was just emailed in a new tab, so there's
  // still a one-shot printable/PDF artifact identical to the emailed report.
  function openPrintableReport() {
    if (!reportHtml) return;
    const blob = new Blob(
      [`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Team Self-Assessment Report</title></head><body>${reportHtml}</body></html>`],
      { type: "text/html" }
    );
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12 }}>
        <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onBack}>← Back to Results</button>
        {reportHtml && (
          <button className="btn btn-secondary" style={{ fontSize: 13 }} onClick={openPrintableReport}>⬇ Download / Print Report</button>
        )}
      </div>

      {staleApiShape && (
        <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid #f59e0b55", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: "var(--text2)", lineHeight: 1.5 }}>
          The API is serving an older version of this report (no roadmap / executive summary / grounded regulatory mapping). Restart the API service — <code>docker compose up -d && docker compose restart api</code> — then reopen this page.
        </div>
      )}

      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Team Self-Assessment Report</h2>
      <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>
        {submissions.length} submission{submissions.length !== 1 ? "s" : ""} across {deptRows.length} department{deptRows.length !== 1 ? "s" : ""}
        {requestedByEmail && <> · Requested by {requestedByEmail}</>}
      </p>

      <div style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>
        <strong style={{ color: "var(--text)" }}>Basis of assessment — trust-based self-reporting.</strong> Each department submitted its own responses; no independent verification, evidence review, or third-party validation was performed.
      </div>

      {/* Overall score */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "20px 24px", marginBottom: 8, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", flexShrink: 0, border: `4px solid ${overallLabel.color}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: overallLabel.color }}>{overallScore !== null ? `${overallScore}%` : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
            Overall: <span style={{ color: overallLabel.color }}>{overallLabel.label}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>
            Average across {deptRows.filter(d => d.avgScore !== null).length} scored department{deptRows.filter(d => d.avgScore !== null).length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {executiveSummary?.bullets?.length > 0 && (
        <ReportSection title="Executive Summary">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {executiveSummary.bullets.map((b, i) => (
              <li key={i} style={{ fontSize: 13, color: "var(--text2)", marginBottom: 6, lineHeight: 1.5 }}>{b}</li>
            ))}
          </ul>
        </ReportSection>
      )}

      {/* Department scorecard */}
      <ReportSection title="Department Scorecard">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {deptRows.map(d => {
            const meta = DEPT_META[d.dept] || { label: d.dept, icon: "🏢" };
            const { label, color } = scoreLabel(d.avgScore);
            const subs = byDept[d.dept] || [];
            const scoredSubs = subs.map(s => {
              const { byDept: bd } = calcScore(s.answers, [d.dept]);
              return { ...s, score: bd[d.dept] };
            });

            return (
              <div key={d.dept} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border2)" }}>
                  <span style={{ fontSize: 22 }}>{meta.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{meta.label || d.dept}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                      {d.contributors} contributor{d.contributors !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>{d.avgScore !== null ? `${d.avgScore}%` : "—"}</div>
                    <div style={{ fontSize: 11, color }}>{label}</div>
                  </div>
                </div>

                <div style={{ height: 4, background: "var(--bg4)" }}>
                  <div style={{ height: "100%", width: `${d.avgScore ?? 0}%`, background: color, transition: "width 0.5s" }} />
                </div>

                <div style={{ padding: "10px 18px", borderBottom: d.openItems ? "1px solid var(--border2)" : "none" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Submitted by</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {scoredSubs.map(s => {
                      const { color: sc } = scoreLabel(s.score);
                      return (
                        <div key={s.userEmail} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg3)", borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>
                          <span style={{ color: "var(--text)" }}>{s.userName}</span>
                          {s.score !== null && <span style={{ color: sc, fontWeight: 700, fontSize: 11 }}>{s.score}%</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(d.gapQuestions.length > 0 || d.partialQuestions.length > 0) && (
                  <div style={{ padding: "10px 18px" }}>
                    {d.gapQuestions.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>✗ Gaps ({d.gapQuestions.length})</div>
                        <ul style={{ margin: 0, paddingLeft: 16, marginBottom: d.partialQuestions.length ? 10 : 0 }}>
                          {d.gapQuestions.map(q => (
                            <li key={q.id} style={{ fontSize: 12, color: "var(--text2)", marginBottom: 3, lineHeight: 1.4 }}>{q.text}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {d.partialQuestions.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>⚠ Partial ({d.partialQuestions.length})</div>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {d.partialQuestions.map(q => (
                            <li key={q.id} style={{ fontSize: 12, color: "var(--text2)", marginBottom: 3, lineHeight: 1.4 }}>{q.text}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ReportSection>

      {priorityFocus.length > 0 && (
        <ReportSection title="Priority Focus Areas" subtitle="Ranking departments purely by score can understate where remediation effort is actually needed — this ranks by raw open-item volume instead.">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {priorityFocus.map(d => {
              const meta = DEPT_META[d.dept] || { label: d.dept, icon: "🏢" };
              return (
                <div key={d.dept} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 14px" }}>
                  <span style={{ fontSize: 16 }}>{meta.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{meta.label || d.dept}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>{d.openItems} open item{d.openItems !== 1 ? "s" : ""} ({d.gapCount} gap{d.gapCount !== 1 ? "s" : ""}, {d.partialCount} partial{d.partialCount !== 1 ? "s" : ""})</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>≈{d.shareOfOrgWideTotal}% of total</div>
                </div>
              );
            })}
          </div>
        </ReportSection>
      )}

      {quickWins.length > 0 && (
        <ReportSection title="Quick-Win Opportunities" subtitle="Departments already close to a perfect score — useful as early, visible progress while larger remediation work is underway elsewhere.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {quickWins.map(d => {
              const meta = DEPT_META[d.dept] || { label: d.dept, icon: "🏢" };
              return (
                <div key={d.dept} style={{ background: "var(--bg2)", border: "1px solid #22c55e55", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                  <span style={{ marginRight: 6 }}>{meta.icon}</span>
                  <strong style={{ color: "var(--text)" }}>{meta.label || d.dept}</strong>
                  <span style={{ color: "var(--text3)" }}> — {d.avgScore}% → 100% ({d.gapCount} gap{d.gapCount !== 1 ? "s" : ""} + {d.partialCount} partial{d.partialCount !== 1 ? "s" : ""})</span>
                </div>
              );
            })}
          </div>
        </ReportSection>
      )}

      {riskRewardRows.length > 0 && (
        <ReportSection title="Risk vs. Reward — by Department">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {riskRewardRows.map(r => {
              const meta = DEPT_META[r.dept] || { label: r.dept, icon: "🏢" };
              return (
                <div key={r.dept} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{meta.icon}</span>{meta.label || r.dept}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ borderLeft: `3px solid ${r.hasGaps ? "#ef4444" : "var(--border2)"}`, paddingLeft: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>⚠ Risk — current exposure</div>
                      {r.riskReasons?.length > 0 ? (
                        <>
                          <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5, marginBottom: 6 }}>
                            {r.gapsSummary} in {r.dept} fall within scope of:
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {r.riskReasons.map((rr, i) => (
                              <div key={i} style={{ background: "var(--bg3)", borderRadius: 6, padding: "6px 8px" }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{rr.framework} — {rr.provision}</div>
                                <div style={{ fontSize: 11, color: "var(--text3)", margin: "2px 0" }}>{rr.why}</div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>Penalty: {rr.penalty}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>{r.riskText}</div>
                      )}
                    </div>
                    <div style={{ borderLeft: "3px solid #22c55e", paddingLeft: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>✅ Reward — if gaps close</div>
                      <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>{r.rewardText}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ReportSection>
      )}

      {regulatoryExposure.length > 0 && (
        <ReportSection
          title="Regulatory Exposure Summary"
          subtitle={regulatoryExposureSource === "ai"
            ? "Each row below was mapped from your actual open self-assessment items by AI, grounded against a checked-in index of official provisions — the provision id is never invented. Follow \"Official source\" to verify it yourself."
            : "AI mapping wasn't available for this report, so this falls back to a static, department-bucket-matched reference — not specific to your actual gaps. Penalty figures are commonly-cited public maxima, for awareness only — not legal advice."}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {regulatoryExposure.map((row, i) => (
              <div key={i} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{row.framework}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", textAlign: "right", whiteSpace: "nowrap" }}>{row.penalty}</div>
                </div>
                <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, marginBottom: 6 }}>{row.provisionLabel}</div>
                <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5, marginBottom: 8 }}>{row.summary}</div>
                <div style={{ fontSize: 11, color: "var(--accent)", lineHeight: 1.5, paddingTop: 8, borderTop: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span><strong>Why this applies to you:</strong> {row.triggeredBy.map(t => t.dept).join(", ")} — self-assessed with open gaps in this exact area.</span>
                  {row.source === "ai" && row.url && (
                    <a href={row.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap" }}>
                      AI-mapped from {row.framework} official text ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {dataQualityNotes.length > 0 && (
        <ReportSection title="Basis of Assessment & Data Quality Notes">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {dataQualityNotes.map((n, i) => (
              <li key={i} style={{ fontSize: 12.5, color: "var(--text2)", marginBottom: 8, lineHeight: 1.5 }}>{n.text}</li>
            ))}
          </ul>
        </ReportSection>
      )}

      {roadmap && (
        <ReportSection title="Recommended Remediation Roadmap">
          <RoadmapPhase label={`Phase 1 — ${roadmap.phase1.label}`} actions={roadmap.phase1.actions} />
          <RoadmapPhase label={`Phase 2 — ${roadmap.phase2.label}`} actions={roadmap.phase2.actions} />
          <RoadmapPhase label={`Phase 3 — ${roadmap.phase3.label}`} actions={roadmap.phase3.actions} />
        </ReportSection>
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
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      {/* Pending banner */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 8000,
        background: "#f59e0b", color: "#fff",
        padding: "8px 20px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        fontSize: 13, fontWeight: 500,
      }}>
        <span>⏳</span>
        <span>Your account is pending admin verification. Complete this self-assessment while you wait.</span>
      </div>

      {/* Header */}
      <div style={{
        marginTop: 36, padding: "16px 28px",
        borderBottom: "1px solid var(--border2)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Logo style={{ height: 28 }} />
          <span style={{ fontSize: 13, color: "var(--text3)", borderLeft: "1px solid var(--border2)", paddingLeft: 14 }}>
            Compliance Self-Assessment
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text3)" }}>{user?.email}</span>
          {step !== "welcome" && step !== "results" && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, color: savedFeedback ? "var(--green, #22c55e)" : undefined, borderColor: savedFeedback ? "var(--green, #22c55e)" : undefined }}
              onClick={handleSaveProgress}
            >
              {savedFeedback ? "✓ Saved" : "Save Progress"}
            </button>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onLogout}>Sign out</button>
        </div>
      </div>

      {/* Step progress bar */}
      {step !== "welcome" && step !== "report" && (
        <div style={{ padding: "0 28px" }}>
          <div style={{ display: "flex", gap: 4, padding: "12px 0", maxWidth: 680, margin: "0 auto" }}>
            {["depts", "collabs", ...selectedDepts, "results"].map((s, i) => {
              const stepOrder = ["welcome", "depts", "collabs", ...selectedDepts, "results"];
              const current = stepOrder.indexOf(step);
              const done = i < current - 1;
              const active = s === step || (step === `q-${selectedDepts[deptIndex]}` && s === selectedDepts[deptIndex]);
              return (
                <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: done ? "var(--accent)" : active ? "var(--accent)" : "var(--bg4)", opacity: done || active ? 1 : 0.4, transition: "background 0.3s" }} />
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
