import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import Logo from "../components/Logo";
import { apiFetch } from "../api/client.js";
import { DEPT_META, DEPT_QUESTIONS, ANSWER_OPTIONS, DEFAULT_DEPTS } from "../utils/deptSelfAssessQuestions.js";

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

function calcScore(answers, depts) {
  const byDept = {};
  for (const dept of depts) {
    const qs = DEPT_QUESTIONS[dept] || [];
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
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20 }}>
          Selected: {selected.join(", ")}
        </div>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" disabled={selected.length === 0} onClick={onNext}>
          Start Questions →
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
  const [sent, setSent] = useState([]);
  const [inviteLinks, setInviteLinks] = useState({});
  const [copied, setCopied] = useState(null);
  const canInvite = userRole === "ADMIN" || userRole === "LEAD";

  const sendInvite = async () => {
    const email = input.trim().toLowerCase();
    if (!email) return;
    if (orgDomain && !email.endsWith("@" + orgDomain)) {
      setError(`Must be a @${orgDomain} address`);
      return;
    }
    if (current.includes(email) || sent.includes(email)) { setError("Already invited"); return; }
    setSending(true);
    setError("");
    try {
      const data = await apiFetch("/api/users/invite", { token, method: "POST", body: JSON.stringify({ email, role: "CONTRIBUTOR", department: dept }) });
      onChange(dept, [...current, email]);
      setSent(prev => [...prev, email]);
      if (data.inviteLink) setInviteLinks(prev => ({ ...prev, [email]: data.inviteLink }));
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

  const remove = (email) => onChange(dept, current.filter(e => e !== email));

  return (
    <div style={{ marginTop: 20, padding: "14px 16px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Collaborators
      </div>
      {current.map(email => (
        <div key={email} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg3)", borderRadius: 6, padding: "6px 10px" }}>
            <span style={{ fontSize: 13, flex: 1, color: "var(--text)" }}>{email}</span>
            {sent.includes(email) && <span style={{ fontSize: 11, color: "var(--green, #22c55e)" }}>✓ Invite sent</span>}
            <button
              onClick={() => remove(email)}
              style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
            >×</button>
          </div>
          {inviteLinks[email] && (
            <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                readOnly
                value={inviteLinks[email]}
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
                onClick={() => copyLink(email, inviteLinks[email])}
              >
                {copied === email ? "Copied!" : "Copy link"}
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

function QuestionStep({ dept, questions, answers, onAnswer, onNext, onBack, deptIndex, totalDepts, collaborators, onCollaboratorsChange, orgDomain, token, userRole }) {
  const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
  const answered = questions.filter(q => answers[q.id]).length;
  const progress = Math.round((answered / questions.length) * 100);

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
      <div style={{ height: 4, background: "var(--bg4)", borderRadius: 2, marginBottom: 24 }}>
        <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.3s" }} />
      </div>

      <CollaboratorInput
        dept={dept}
        collaborators={collaborators}
        onChange={onCollaboratorsChange}
        orgDomain={orgDomain}
        token={token}
        userRole={userRole}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {questions.map((q, i) => {
          const selected = answers[q.id];
          const showSection = q.section && (i === 0 || questions[i - 1]?.section !== q.section);
          return (
            <div key={q.id}>
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
                  <span style={{ color: "var(--text3)", marginRight: 8, fontWeight: 700 }}>{i + 1}.</span>
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
        })}
      </div>

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
          const qs = DEPT_QUESTIONS[dept] || [];
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

function ReportStep({ token, onBack }) {
  const [submissions, setSubmissions] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/self-assessment", { token })
      .then(data => setSubmissions(data || []))
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

  if (submissions.length === 0) return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={onBack}>← Back</button>
      <p style={{ color: "var(--text3)", fontSize: 14 }}>No submissions yet. Invite colleagues and ask them to complete their department assessment.</p>
    </div>
  );

  // Group by department
  const byDept = {};
  for (const s of submissions) {
    if (!byDept[s.department]) byDept[s.department] = [];
    byDept[s.department].push(s);
  }

  // For each dept, compute per-submission score and aggregate
  const deptSummaries = Object.entries(byDept).map(([dept, subs]) => {
    const qs = DEPT_QUESTIONS[dept] || [];
    const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };

    const scoredSubs = subs.map(s => {
      const { byDept: bd } = calcScore(s.answers, [dept]);
      return { ...s, score: bd[dept] };
    });

    // Aggregate: average score across all submitters
    const scores = scoredSubs.map(s => s.score).filter(v => v !== null);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    // Gap questions: answered NO by at least one person
    const gaps = qs.filter(q =>
      subs.some(s => s.answers[q.id] === "NO")
    );
    const partials = qs.filter(q =>
      subs.some(s => s.answers[q.id] === "PARTIAL") && !gaps.find(g => g.id === q.id)
    );

    return { dept, meta, scoredSubs, avgScore, gaps, partials };
  }).sort((a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101));

  // Overall score: average of dept averages
  const validScores = deptSummaries.map(d => d.avgScore).filter(v => v !== null);
  const overallScore = validScores.length ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null;
  const overallLabel = scoreLabel(overallScore);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <button className="btn btn-ghost" style={{ marginBottom: 20, fontSize: 13 }} onClick={onBack}>← Back to Results</button>

      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Team Self-Assessment Report</h2>
      <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 24 }}>
        {submissions.length} submission{submissions.length !== 1 ? "s" : ""} across {Object.keys(byDept).length} department{Object.keys(byDept).length !== 1 ? "s" : ""}
      </p>

      {/* Overall score */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "20px 24px", marginBottom: 24, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", flexShrink: 0, border: `4px solid ${overallLabel.color}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: overallLabel.color }}>{overallScore !== null ? `${overallScore}%` : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
            Overall: <span style={{ color: overallLabel.color }}>{overallLabel.label}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>
            Average across {deptSummaries.filter(d => d.avgScore !== null).length} scored department{deptSummaries.filter(d => d.avgScore !== null).length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Per-department cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {deptSummaries.map(({ dept, meta, scoredSubs, avgScore, gaps, partials }) => {
          const { label, color } = scoreLabel(avgScore);
          return (
            <div key={dept} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, overflow: "hidden" }}>
              {/* Dept header */}
              <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border2)" }}>
                <span style={{ fontSize: 22 }}>{meta.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{meta.label || dept}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                    {scoredSubs.length} contributor{scoredSubs.length !== 1 ? "s" : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{avgScore !== null ? `${avgScore}%` : "—"}</div>
                  <div style={{ fontSize: 11, color }}>{label}</div>
                </div>
              </div>

              {/* Score bar */}
              <div style={{ height: 4, background: "var(--bg4)" }}>
                <div style={{ height: "100%", width: `${avgScore ?? 0}%`, background: color, transition: "width 0.5s" }} />
              </div>

              {/* Submitters */}
              <div style={{ padding: "10px 18px", borderBottom: gaps.length || partials.length ? "1px solid var(--border2)" : "none" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Submitted by</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {scoredSubs.map(s => {
                    const { label: sl, color: sc } = scoreLabel(s.score);
                    return (
                      <div key={s.userEmail} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg3)", borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>
                        <span style={{ color: "var(--text)" }}>{s.userName}</span>
                        {s.score !== null && (
                          <span style={{ color: sc, fontWeight: 700, fontSize: 11 }}>{s.score}%</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Gaps */}
              {(gaps.length > 0 || partials.length > 0) && (
                <div style={{ padding: "10px 18px" }}>
                  {gaps.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>✗ Gaps ({gaps.length})</div>
                      <ul style={{ margin: 0, paddingLeft: 16, marginBottom: partials.length ? 10 : 0 }}>
                        {gaps.map(q => (
                          <li key={q.id} style={{ fontSize: 12, color: "var(--text2)", marginBottom: 3, lineHeight: 1.4 }}>{q.text}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {partials.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>⚠ Partial ({partials.length})</div>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {partials.map(q => (
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
        depts.map(dept =>
          apiFetch("/api/self-assessment", {
            token,
            method: "POST",
            body: JSON.stringify({ department: dept, answers }),
          }).catch(() => {})
        )
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
        setStep("depts");
        persist({ step: "depts" });
      } else {
        const prev = deptIndex - 1;
        setDeptIndex(prev);
        persist({ deptIndex: prev });
      }
    } else if (step === "results") {
      setStep("questions");
      persist({ step: "questions" });
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

  const handleCollaboratorsChange = (dept, emails) => {
    const next = { ...collaborators, [dept]: emails };
    setCollaborators(next);
    persist({ collaborators: next });
  };

  const currentDept = selectedDepts[deptIndex];
  const currentQuestions = currentDept
    ? (DEPT_QUESTIONS[currentDept] || [
      { id: `${currentDept}-1`, text: `Do you share data / tasks with other departments??` }, 
      { id: `${currentDept}-2`, text: `Does your department directly contact clients / vendors?` },
      { id: `${currentDept}-3`, text: `Does ${currentDept} department enforce Role Based Access Control?` },
      {id: `${currentDept}-4`, text: `Does ${currentDept} process personal data (name, phone number, card details)?` },
      {id: `${currentDept}-5`, text: `Does ${currentDept} use third party software (ERP, SaaS, CRM) ?` },
      {id: `${currentDept}-6`, text: `Does ${currentDept} handle employee / client / vendor data?` },
      ])
    : [];

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
            {["depts", ...selectedDepts, "results"].map((s, i) => {
              const stepOrder = ["welcome", "depts", ...selectedDepts, "results"];
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
            onNext={() => { setDeptIndex(0); goToStep("questions", { deptIndex: 0 }); }}
          />
        )}
        {step === "questions" && currentDept && (
          <QuestionStep
            dept={currentDept}
            questions={currentQuestions}
            answers={answers}
            onAnswer={answer}
            deptIndex={deptIndex}
            totalDepts={selectedDepts.length}
            collaborators={collaborators}
            onCollaboratorsChange={handleCollaboratorsChange}
            orgDomain={orgDomain}
            token={token}
            userRole={user?.role}
            onBack={lockedDept ? null : () => {
              if (deptIndex === 0) { goToStep("depts"); }
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
