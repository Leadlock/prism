import { useState, useMemo } from "react";
import Logo from "../components/Logo";
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

function QuestionStep({ dept, questions, answers, onAnswer, onNext, onBack, deptIndex, totalDepts }) {
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
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={onNext}>
          {deptIndex < totalDepts - 1 ? "Next Department →" : "View Results →"}
        </button>
      </div>
    </div>
  );
}

function ResultsStep({ selectedDepts, answers, onRetake, onLogout }) {
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

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" onClick={onRetake}>↺ Retake Assessment</button>
        <button className="btn btn-ghost" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SelfAssessment({ user, onLogout }) {
  const saved = loadSaved(user?.id);

  const [step, setStep] = useState(saved?.step ?? "welcome");
  const [selectedDepts, setSelectedDepts] = useState(saved?.selectedDepts ?? []);
  const [customDept, setCustomDept] = useState("");
  const [deptIndex, setDeptIndex] = useState(saved?.deptIndex ?? 0);
  const [answers, setAnswers] = useState(saved?.answers ?? {});

  const persist = (patch) => {
    const next = { step, selectedDepts, deptIndex, answers, ...patch };
    saveToDisk(user?.id, next);
    return next;
  };

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

  const currentDept = selectedDepts[deptIndex];
  const currentQuestions = currentDept
    ? (DEPT_QUESTIONS[currentDept] || [{ id: `${currentDept}-1`, text: `Does your ${currentDept} department have documented data protection practices?` }])
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
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onLogout}>Sign out</button>
        </div>
      </div>

      {/* Step progress bar */}
      {step !== "welcome" && (
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
        {step === "welcome" && (
          <WelcomeStep onStart={() => goToStep("depts")} />
        )}
        {step === "depts" && (
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
            onBack={() => {
              if (deptIndex === 0) { goToStep("depts"); }
              else { const prev = deptIndex - 1; setDeptIndex(prev); persist({ deptIndex: prev }); }
            }}
            onNext={() => {
              if (deptIndex < selectedDepts.length - 1) {
                const next = deptIndex + 1;
                setDeptIndex(next);
                persist({ deptIndex: next });
              } else {
                goToStep("results");
              }
            }}
          />
        )}
        {step === "results" && (
          <ResultsStep
            selectedDepts={selectedDepts}
            answers={answers}
            onRetake={() => {
              setStep("welcome");
              setSelectedDepts([]);
              setDeptIndex(0);
              setAnswers({});
              saveToDisk(user?.id, null);
            }}
            onLogout={onLogout}
          />
        )}
      </div>
    </div>
  );
}
