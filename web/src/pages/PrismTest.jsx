import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";

const API_URL = import.meta.env.VITE_API_URL || "";

// ─── Question bank ───────────────────────────────────────────────────────────
const QUESTIONS = [
  // Data Privacy & Consent
  { id: "q01", cat: "Data Privacy & Consent", text: "Do you maintain a Privacy Policy that clearly explains how personal data is collected, used, and shared?", weight: 1 },
  { id: "q02", cat: "Data Privacy & Consent", text: "Do you obtain explicit, informed consent from users before collecting or processing their personal data?", weight: 1 },
  { id: "q03", cat: "Data Privacy & Consent", text: "Do users have a clear mechanism to access, correct, or delete their personal data on request?", weight: 1 },
  { id: "q04", cat: "Data Privacy & Consent", text: "Do you maintain a data retention policy with defined timelines and processes for secure deletion?", weight: 1 },
  { id: "q05", cat: "Data Privacy & Consent", text: "Do you conduct Data Protection Impact Assessments (DPIAs) before launching high-risk data processing activities?", weight: 1 },

  // Access Control
  { id: "q06", cat: "Access Control", text: "Are access rights to all systems granted on a least-privilege, need-to-know basis?", weight: 1 },
  { id: "q07", cat: "Access Control", text: "Do you enforce Multi-Factor Authentication (MFA) for privileged accounts and remote access?", weight: 1 },
  { id: "q08", cat: "Access Control", text: "Do you conduct periodic access reviews to identify and revoke unnecessary permissions?", weight: 1 },
  { id: "q09", cat: "Access Control", text: "Are all user passwords stored using a strong hashing algorithm (e.g. bcrypt, Argon2) — never in plain text?", weight: 1 },

  // Incident Response
  { id: "q10", cat: "Incident Response", text: "Do you have a documented Incident Response Plan (IRP) that is reviewed and tested at least annually?", weight: 1 },
  { id: "q11", cat: "Incident Response", text: "Can your team detect and notify affected parties of a data breach within 72 hours as required by DPDPA/GDPR?", weight: 1 },
  { id: "q12", cat: "Incident Response", text: "Do you conduct post-incident reviews (blameless retrospectives) to prevent recurrence?", weight: 1 },

  // Vendor & Third-Party
  { id: "q13", cat: "Vendor & Third-Party", text: "Do you assess the security posture of third-party vendors before onboarding them?", weight: 1 },
  { id: "q14", cat: "Vendor & Third-Party", text: "Do you have signed Data Processing Agreements (DPAs) with every vendor that handles personal data?", weight: 1 },

  // Audit & Monitoring
  { id: "q15", cat: "Audit & Monitoring", text: "Do you maintain tamper-evident audit logs for all system access and data changes?", weight: 1 },
  { id: "q16", cat: "Audit & Monitoring", text: "Are your logs actively monitored (SIEM or equivalent) for anomalous activity or potential breaches?", weight: 1 },
  { id: "q17", cat: "Audit & Monitoring", text: "Are backups taken regularly and restoration tested at a defined cadence?", weight: 1 },

  // Training & Awareness
  { id: "q18", cat: "Training & Awareness", text: "Do all employees who handle personal or sensitive data receive security awareness training at least annually?", weight: 1 },
  { id: "q19", cat: "Training & Awareness", text: "Do you have clear, documented policies for handling and classifying sensitive data?", weight: 1 },

  // Technical Security
  { id: "q20", cat: "Technical Security", text: "Is all personal data encrypted both at rest and in transit (TLS 1.2+)?", weight: 1 },
  { id: "q21", cat: "Technical Security", text: "Do you perform regular vulnerability assessments or penetration tests?", weight: 1 },
  { id: "q22", cat: "Technical Security", text: "Do you have a patch management process that keeps systems and dependencies up to date?", weight: 1 },
];

const ANSWER_OPTIONS = [
  { value: "yes",     label: "Yes",     color: "var(--green,#16a34a)",  score: 1.0 },
  { value: "partial", label: "Partial", color: "var(--amber,#d97706)", score: 0.5 },
  { value: "no",      label: "No",      color: "var(--red,#dc2626)",   score: 0.0 },
  { value: "na",      label: "N/A",     color: "var(--text3,#888)",    score: null },
];

function storageKey(email) {
  return `prism_test_${email.trim().toLowerCase()}`;
}

function computeScore(answers) {
  const cats = {};
  let totalEarned = 0, totalPossible = 0;

  for (const q of QUESTIONS) {
    const a = answers[q.id];
    if (!cats[q.cat]) cats[q.cat] = { earned: 0, possible: 0 };
    if (!a || a === "na") continue;
    const opt = ANSWER_OPTIONS.find(o => o.value === a);
    const earned = opt ? opt.score * q.weight : 0;
    cats[q.cat].earned += earned;
    cats[q.cat].possible += q.weight;
    totalEarned += earned;
    totalPossible += q.weight;
  }

  const overall = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0;
  const byCategory = Object.entries(cats).map(([name, v]) => ({
    name,
    score: v.possible > 0 ? Math.round((v.earned / v.possible) * 100) : 0,
    earned: v.earned,
    possible: v.possible,
  })).sort((a, b) => a.score - b.score);

  return { overall, byCategory };
}

function scoreColor(s) {
  if (s >= 75) return "var(--green,#16a34a)";
  if (s >= 50) return "var(--amber,#d97706)";
  if (s >= 30) return "#ea580c";
  return "var(--red,#dc2626)";
}

function scoreLabel(s) {
  if (s >= 75) return "Good";
  if (s >= 50) return "Moderate";
  if (s >= 30) return "At Risk";
  return "Critical";
}

function ScoreRing({ score }) {
  const c = scoreColor(score);
  const circ = 2 * Math.PI * 52;
  const off = circ * (1 - score / 100);
  return (
    <svg viewBox="0 0 120 120" width={140} height={140}>
      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--bg3,#e5e7eb)" strokeWidth="10" />
      <circle cx="60" cy="60" r="52" fill="none" stroke={c} strokeWidth="10"
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
        transform="rotate(-90 60 60)"
        style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="800" fill={c}>{score}</text>
      <text x="60" y="73" textAnchor="middle" fontSize="11" fill="var(--text3,#888)">/ 100</text>
    </svg>
  );
}

function buildReportText({ userInfo, answers, score }) {
  const { overall, byCategory } = score;
  const lines = [
    `PRISM Compliance Self-Assessment Report`,
    `========================================`,
    ``,
    `Name:    ${userInfo.name}`,
    `Email:   ${userInfo.email}`,
    userInfo.company ? `Company: ${userInfo.company}` : null,
    `Date:    ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    ``,
    `Overall Score: ${overall}/100 — ${scoreLabel(overall)}`,
    ``,
    `── Category Breakdown ─────────────────────`,
    ...byCategory.map(c => `  ${c.name}: ${c.score}%`),
    ``,
    `── Question Responses ─────────────────────`,
    ...QUESTIONS.map(q => {
      const a = answers[q.id] || "unanswered";
      return `  [${a.toUpperCase().padEnd(8)}] ${q.text}`;
    }),
    ``,
    `── Gaps (No / Partial answers) ───────────`,
    ...QUESTIONS.filter(q => answers[q.id] === "no" || answers[q.id] === "partial").map(q => {
      const a = answers[q.id];
      return `  ${a === "no" ? "✗" : "~"} [${q.cat}] ${q.text}`;
    }),
    ``,
    `──────────────────────────────────────────`,
    `Generated by PRISM Compliance Platform`,
    `https://prism.auditready.in`,
  ].filter(l => l !== null);

  return lines.join("\n");
}

function buildReportHtml({ userInfo, answers, score }) {
  const { overall, byCategory } = score;
  const gaps = QUESTIONS.filter(q => answers[q.id] === "no" || answers[q.id] === "partial");
  const c = scoreColor(overall);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>PRISM Compliance Assessment Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111; margin: 0; padding: 0; }
  .wrap { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .header { background: #1e3a5f; color: #fff; padding: 32px 36px; }
  .header h1 { margin: 0 0 4px; font-size: 22px; }
  .header p { margin: 0; font-size: 14px; opacity: .75; }
  .body { padding: 32px 36px; }
  .score-box { text-align: center; padding: 24px 0 16px; }
  .score-num { font-size: 64px; font-weight: 800; color: ${c}; line-height: 1; }
  .score-label { font-size: 18px; font-weight: 600; color: ${c}; margin-top: 4px; }
  .section-title { font-size: 15px; font-weight: 700; color: #374151; margin: 28px 0 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  .cat-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .cat-name { flex: 1; font-size: 13px; color: #374151; }
  .cat-bar-wrap { width: 160px; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .cat-bar { height: 100%; border-radius: 4px; }
  .cat-pct { font-size: 13px; font-weight: 600; width: 36px; text-align: right; }
  .gap-item { padding: 10px 12px; border-left: 3px solid #e5e7eb; margin-bottom: 8px; background: #f9fafb; border-radius: 0 6px 6px 0; }
  .gap-item.no { border-left-color: #dc2626; }
  .gap-item.partial { border-left-color: #d97706; }
  .gap-cat { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }
  .gap-text { font-size: 13px; color: #111; }
  .footer { background: #f3f4f6; padding: 20px 36px; font-size: 12px; color: #6b7280; text-align: center; }
  .meta { font-size: 13px; color: #6b7280; margin-bottom: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>PRISM Compliance Assessment</h1>
    <p>Self-Assessment Report · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
  </div>
  <div class="body">
    <p class="meta"><strong>${userInfo.name}</strong>${userInfo.company ? ` · ${userInfo.company}` : ""}</p>
    <p class="meta">${userInfo.email}</p>

    <div class="score-box">
      <div class="score-num">${overall}</div>
      <div class="score-label">${scoreLabel(overall)}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:6px;">Overall compliance score out of 100</div>
    </div>

    <div class="section-title">Category Breakdown</div>
    ${byCategory.map(cat => {
      const cc = cat.score >= 75 ? "#16a34a" : cat.score >= 50 ? "#d97706" : cat.score >= 30 ? "#ea580c" : "#dc2626";
      return `<div class="cat-row">
        <div class="cat-name">${cat.name}</div>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${cat.score}%;background:${cc}"></div></div>
        <div class="cat-pct" style="color:${cc}">${cat.score}%</div>
      </div>`;
    }).join("")}

    ${gaps.length > 0 ? `
    <div class="section-title">Gaps to Address (${gaps.length})</div>
    ${gaps.map(q => `<div class="gap-item ${answers[q.id]}">
      <div class="gap-cat">${q.cat} · ${answers[q.id] === "no" ? "Not in place" : "Partial"}</div>
      <div class="gap-text">${q.text}</div>
    </div>`).join("")}` : ""}

    <div style="margin-top:32px;padding:20px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe">
      <div style="font-size:15px;font-weight:700;color:#1e40af;margin-bottom:8px">Ready to close the gaps?</div>
      <div style="font-size:13px;color:#1e3a5f;line-height:1.6">
        PRISM helps you track compliance posture over time — assign owners, record evidence, set reminders, and always be audit-ready.
      </div>
      <a href="https://prism.auditready.in/register" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#1e3a5f;color:#fff;border-radius:6px;font-weight:600;font-size:13px;text-decoration:none">
        Start a full PRISM assessment →
      </a>
    </div>
  </div>
  <div class="footer">Generated by PRISM Compliance Platform · prism.auditready.in</div>
</div>
</body>
</html>`;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function PrismTest() {
  const [phase, setPhase] = useState("intro"); // intro | assessing | results
  const [userInfo, setUserInfo] = useState({ name: "", email: "", company: "" });
  const [formErrors, setFormErrors] = useState({});
  const [answers, setAnswers] = useState({});
  const [current, setCurrent] = useState(0);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const cardRef = useRef(null);

  // Restore progress when email is entered
  const restoreProgress = (email) => {
    try {
      const raw = localStorage.getItem(storageKey(email));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const saveProgress = (email, data) => {
    try {
      localStorage.setItem(storageKey(email), JSON.stringify(data));
    } catch {}
  };

  const handleStart = (e) => {
    e.preventDefault();
    const errors = {};
    if (!userInfo.name.trim()) errors.name = "Name is required";
    if (!userInfo.email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userInfo.email.trim())) errors.email = "Enter a valid email address";
    if (Object.keys(errors).length) { setFormErrors(errors); return; }

    const saved = restoreProgress(userInfo.email);
    if (saved?.answers) {
      setAnswers(saved.answers);
      // Find the first unanswered question to resume from
      const firstUnanswered = QUESTIONS.findIndex(q => !saved.answers[q.id]);
      setCurrent(firstUnanswered >= 0 ? firstUnanswered : QUESTIONS.length - 1);
    }
    setPhase("assessing");
  };

  const handleAnswer = (value) => {
    const q = QUESTIONS[current];
    const newAnswers = { ...answers, [q.id]: value };
    setAnswers(newAnswers);
    saveProgress(userInfo.email, { answers: newAnswers, userInfo });

    if (current < QUESTIONS.length - 1) {
      setCurrent(i => i + 1);
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      setPhase("results");
    }
  };

  const handleEmailReport = async () => {
    setEmailSending(true);
    setEmailError("");
    const score = computeScore(answers);
    const reportHtml = buildReportHtml({ userInfo, answers, score });
    const reportText = buildReportText({ userInfo, answers, score });

    try {
      const resp = await fetch(`${API_URL}/api/contact/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: userInfo.name,
          email: userInfo.email,
          company: userInfo.company,
          score: score.overall,
          reportHtml,
          reportText,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to send report");
      setEmailSent(true);
    } catch (err) {
      setEmailError(err.message || "Could not send report. Please try again.");
    } finally {
      setEmailSending(false);
    }
  };

  const handleRestart = () => {
    setAnswers({});
    setCurrent(0);
    setPhase("intro");
    setEmailSent(false);
    setEmailError("");
  };

  const answeredCount = QUESTIONS.filter(q => answers[q.id]).length;
  const score = computeScore(answers);

  // ── Intro screen ─────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div style={styles.shell}>
        <div style={styles.header}>
          <Link to="/" style={{ textDecoration: "none" }}>
            <Logo style={{ height: 36 }} />
          </Link>
          <Link to="/login" style={{ ...styles.signInBtn }}>Sign In →</Link>
        </div>

        <div style={styles.body}>
          <div style={styles.introBadge}>Free · 22 Questions · ~5 minutes</div>
          <h1 style={styles.heroTitle}>Is your organisation compliance-ready?</h1>
          <p style={styles.heroSub}>
            This self-assessment covers Data Privacy (DPDPA / GDPR), Access Control, Incident Response,
            Vendor Management, and Technical Security — the key areas auditors examine.
          </p>

          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Start your assessment</h2>
            <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 20, marginTop: 0 }}>
              Enter your details to save progress and receive your report by email when you're done.
            </p>
            <form onSubmit={handleStart}>
              <div style={styles.fieldRow}>
                <label style={styles.label}>Full Name *</label>
                <input
                  style={{ ...styles.input, borderColor: formErrors.name ? "var(--red,#dc2626)" : "var(--border2)" }}
                  type="text"
                  placeholder="Jane Smith"
                  value={userInfo.name}
                  onChange={e => setUserInfo(v => ({ ...v, name: e.target.value }))}
                  autoComplete="name"
                />
                {formErrors.name && <p style={styles.fieldError}>{formErrors.name}</p>}
              </div>

              <div style={styles.fieldRow}>
                <label style={styles.label}>Work Email *</label>
                <input
                  style={{ ...styles.input, borderColor: formErrors.email ? "var(--red,#dc2626)" : "var(--border2)" }}
                  type="email"
                  placeholder="jane@company.com"
                  value={userInfo.email}
                  onChange={e => setUserInfo(v => ({ ...v, email: e.target.value }))}
                  autoComplete="email"
                />
                {formErrors.email && <p style={styles.fieldError}>{formErrors.email}</p>}
              </div>

              <div style={styles.fieldRow}>
                <label style={styles.label}>Company <span style={{ color: "var(--text3)" }}>(optional)</span></label>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Acme Corp"
                  value={userInfo.company}
                  onChange={e => setUserInfo(v => ({ ...v, company: e.target.value }))}
                  autoComplete="organization"
                />
              </div>

              <button type="submit" style={styles.primaryBtn}>
                Begin Assessment →
              </button>
              <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 12, textAlign: "center", lineHeight: 1.5 }}>
                Your responses are saved locally in your browser. We only use your email to send the report if you request it.
              </p>
            </form>
          </div>

          <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", marginTop: 32 }}>
            {[
              { icon: "🔒", title: "Data Privacy", desc: "DPDPA 2023 & GDPR readiness" },
              { icon: "🛡", title: "ISO 27001", desc: "Key security controls coverage" },
              { icon: "📋", title: "Instant Report", desc: "Score + actionable gap list" },
            ].map(f => (
              <div key={f.title} style={styles.featureChip}>
                <div style={{ fontSize: 22 }}>{f.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{f.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)" }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Assessment screen ─────────────────────────────────────────────────────
  if (phase === "assessing") {
    const q = QUESTIONS[current];
    const progress = Math.round((answeredCount / QUESTIONS.length) * 100);

    return (
      <div style={styles.shell}>
        <div style={styles.header}>
          <Link to="/" style={{ textDecoration: "none" }}>
            <Logo style={{ height: 36 }} />
          </Link>
          <div style={{ fontSize: 13, color: "var(--text2)" }}>
            {userInfo.name} · {answeredCount}/{QUESTIONS.length} answered
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, background: "var(--bg3,#e5e7eb)" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent,#2563eb)", transition: "width 0.3s ease" }} />
        </div>

        <div style={styles.body} ref={cardRef}>
          {/* Category pill */}
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text3)", background: "var(--bg3)", padding: "4px 12px", borderRadius: 20 }}>
              {q.cat}
            </span>
          </div>

          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>Question {current + 1} of {QUESTIONS.length}</span>
          </div>

          {/* Question card */}
          <div style={{ ...styles.card, textAlign: "center" }}>
            <p style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.55, color: "var(--text)", margin: "0 0 28px" }}>
              {q.text}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ANSWER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer(opt.value)}
                  style={{
                    ...styles.answerBtn,
                    borderColor: answers[q.id] === opt.value ? opt.color : "var(--border2)",
                    background: answers[q.id] === opt.value ? `${opt.color}18` : "var(--bg)",
                    color: answers[q.id] === opt.value ? opt.color : "var(--text)",
                    fontWeight: answers[q.id] === opt.value ? 700 : 500,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Navigation */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 480, margin: "0 auto" }}>
            <button
              onClick={() => setCurrent(i => Math.max(0, i - 1))}
              disabled={current === 0}
              style={{ ...styles.ghostBtn, opacity: current === 0 ? 0.3 : 1 }}
            >
              ← Back
            </button>
            {answeredCount === QUESTIONS.length && (
              <button onClick={() => setPhase("results")} style={styles.primaryBtn}>
                View Results →
              </button>
            )}
            <button
              onClick={() => setCurrent(i => Math.min(QUESTIONS.length - 1, i + 1))}
              disabled={current === QUESTIONS.length - 1}
              style={{ ...styles.ghostBtn, opacity: current === QUESTIONS.length - 1 ? 0.3 : 1 }}
            >
              Skip →
            </button>
          </div>

          {/* Question dots */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", maxWidth: 400, margin: "20px auto 0" }}>
            {QUESTIONS.map((qq, i) => {
              const a = answers[qq.id];
              const bg = !a ? "var(--bg3,#e5e7eb)" : a === "yes" ? "var(--green,#16a34a)" : a === "partial" ? "var(--amber,#d97706)" : a === "no" ? "var(--red,#dc2626)" : "var(--text3,#888)";
              return (
                <button
                  key={qq.id}
                  onClick={() => setCurrent(i)}
                  style={{ width: 10, height: 10, borderRadius: "50%", border: i === current ? "2px solid var(--accent,#2563eb)" : "none", background: bg, cursor: "pointer", padding: 0, boxSizing: "border-box" }}
                  title={`Q${i + 1}: ${qq.cat}`}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Results screen ────────────────────────────────────────────────────────
  const { overall, byCategory } = score;
  const gaps = QUESTIONS.filter(q => answers[q.id] === "no" || answers[q.id] === "partial");

  return (
    <div style={styles.shell}>
      <div style={styles.header}>
        <Link to="/" style={{ textDecoration: "none" }}>
          <Logo style={{ height: 36 }} />
        </Link>
        <button onClick={handleRestart} style={styles.ghostBtn}>← Restart</button>
      </div>

      <div style={styles.body}>
        <h1 style={{ ...styles.heroTitle, marginBottom: 8 }}>Your assessment is complete</h1>
        <p style={{ ...styles.heroSub, marginBottom: 0 }}>{userInfo.name}{userInfo.company ? ` · ${userInfo.company}` : ""}</p>

        {/* Score ring */}
        <div style={{ ...styles.card, textAlign: "center" }}>
          <ScoreRing score={overall} />
          <div style={{ fontSize: 18, fontWeight: 700, color: scoreColor(overall), marginTop: 8 }}>{scoreLabel(overall)}</div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
            {answeredCount} of {QUESTIONS.length} questions answered
          </div>

          {/* Email report */}
          <div style={{ marginTop: 24, borderTop: "1px solid var(--border2)", paddingTop: 20 }}>
            {emailSent ? (
              <div style={{ fontSize: 14, color: "var(--green,#16a34a)", fontWeight: 600 }}>
                ✓ Report sent to {userInfo.email}
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12, marginTop: 0 }}>
                  Get a full HTML report with your scores and gap list delivered to your inbox.
                </p>
                {emailError && <p style={{ fontSize: 13, color: "var(--red,#dc2626)", marginBottom: 10 }}>{emailError}</p>}
                <button
                  onClick={handleEmailReport}
                  disabled={emailSending}
                  style={{ ...styles.primaryBtn, display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  {emailSending ? "Sending…" : "📧 Email my report"}
                </button>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8 }}>Will be sent to {userInfo.email}</div>
              </>
            )}
          </div>
        </div>

        {/* Category breakdown */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Category Breakdown</h2>
          {byCategory.map(cat => (
            <div key={cat.name} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{cat.name}</span>
                <span style={{ color: scoreColor(cat.score), fontWeight: 700 }}>{cat.score}%</span>
              </div>
              <div style={{ height: 8, background: "var(--bg3,#e5e7eb)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${cat.score}%`, background: scoreColor(cat.score), borderRadius: 4, transition: "width 0.6s ease" }} />
              </div>
            </div>
          ))}
        </div>

        {/* Gaps */}
        {gaps.length > 0 && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Gaps to Address ({gaps.length})</h2>
            {gaps.map(q => {
              const isNo = answers[q.id] === "no";
              return (
                <div key={q.id} style={{
                  padding: "10px 12px", marginBottom: 8,
                  borderLeft: `3px solid ${isNo ? "var(--red,#dc2626)" : "var(--amber,#d97706)"}`,
                  background: "var(--bg3,#f9fafb)", borderRadius: "0 6px 6px 0"
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                    {q.cat} · {isNo ? "Not in place" : "Partial"}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{q.text}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* CTA */}
        <div style={{ ...styles.card, background: "var(--accent,#2563eb)", color: "#fff", textAlign: "center" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Close the gaps with PRISM</h2>
          <p style={{ fontSize: 13, opacity: 0.85, margin: "0 0 20px", lineHeight: 1.6 }}>
            PRISM tracks your compliance posture over time — assign owners, record evidence, set reminders,
            and always be audit-ready across DPDPA, ISO 27001, and GDPR.
          </p>
          <Link to="/register" style={{ display: "inline-block", padding: "12px 24px", background: "#fff", color: "var(--accent,#2563eb)", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
            Start a full PRISM assessment →
          </Link>
        </div>

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={() => { setCurrent(0); setPhase("assessing"); }} style={styles.ghostBtn}>
            ← Review answers
          </button>
          &nbsp;&nbsp;
          <button onClick={handleRestart} style={styles.ghostBtn}>
            Restart assessment
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline styles ────────────────────────────────────────────────────────────
const styles = {
  shell: {
    minHeight: "100vh",
    background: "var(--bg,#f9fafb)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 24px",
    background: "var(--bg2,#fff)",
    borderBottom: "1px solid var(--border2,#e5e7eb)",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  body: {
    maxWidth: 520,
    margin: "0 auto",
    padding: "32px 16px 64px",
  },
  introBadge: {
    textAlign: "center",
    display: "inline-block",
    width: "100%",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--accent,#2563eb)",
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: 800,
    lineHeight: 1.25,
    textAlign: "center",
    color: "var(--text,#111)",
    margin: "0 0 12px",
  },
  heroSub: {
    fontSize: 14,
    color: "var(--text2,#555)",
    textAlign: "center",
    lineHeight: 1.6,
    margin: "0 0 28px",
  },
  card: {
    background: "var(--bg2,#fff)",
    border: "1px solid var(--border2,#e5e7eb)",
    borderRadius: 12,
    padding: "24px 24px",
    marginBottom: 16,
  },
  cardTitle: {
    margin: "0 0 16px",
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text,#111)",
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text2,#374151)",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border2,#d1d5db)",
    background: "var(--bg,#f9fafb)",
    color: "var(--text,#111)",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
  },
  fieldRow: {
    marginBottom: 16,
  },
  fieldError: {
    margin: "4px 0 0",
    fontSize: 12,
    color: "var(--red,#dc2626)",
  },
  primaryBtn: {
    display: "block",
    width: "100%",
    padding: "12px 20px",
    background: "var(--accent,#2563eb)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "center",
    textDecoration: "none",
  },
  ghostBtn: {
    background: "none",
    border: "none",
    color: "var(--text2,#555)",
    fontSize: 13,
    cursor: "pointer",
    padding: "6px 10px",
    borderRadius: 6,
  },
  answerBtn: {
    padding: "14px 20px",
    borderRadius: 8,
    border: "2px solid",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 500,
    transition: "all 0.15s ease",
    textAlign: "left",
  },
  signInBtn: {
    padding: "8px 16px",
    background: "var(--accent,#2563eb)",
    color: "#fff",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    textDecoration: "none",
  },
  featureChip: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    background: "var(--bg2,#fff)",
    border: "1px solid var(--border2,#e5e7eb)",
    borderRadius: 10,
    minWidth: 160,
  },
};
