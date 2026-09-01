// Builds the HTML for the auto-emailed self-assessment "Team Report", and the
// same structured data GET /api/self-assessment returns for the in-app view —
// the two are built from one function so what's emailed and what's shown
// in-app never drift apart.
//
// Regulatory citations: this file itself never authors a provision id, a URL,
// or a penalty figure. The route (routes/selfAssessment.js) calls
// aiProvider.mapRegulatoryExposure() — which grounds every citation against
// the checked-in index in api/src/data/legal/ — and passes the already-
// validated result in as `aiExposureMappings`. If that's empty (AI
// unavailable/disabled, or nothing validated), buildRegulatoryExposure falls
// back to the static FALLBACK_REFERENCE table below, clearly labeled as such.

import { resolveDeptQuestionText } from "./deptSelfAssessQuestions.js";
import { PRISM_LOGO_DATA_URI } from "../data/prismLogo.js";
import { lookupProvision } from "./provisionIndex.js";

const SCORE_VALUE = { YES: 1, PARTIAL: 0.5, NO: 0 };

// Score bands — the label + colour used wherever a score is shown.
const SCORE_BANDS = [
  { min: 80, label: "Strong", color: "#15803D", bg: "#DCFCE7" },
  { min: 60, label: "Moderate", color: "#B45309", bg: "#FEF3C7" },
  { min: 40, label: "Developing", color: "#C2410C", bg: "#FFEDD5" },
  { min: 0, label: "Needs work", color: "#B91C1C", bg: "#FEE2E2" },
];
const NOT_ASSESSED_BAND = { label: "Not assessed", color: "#8B85A0", bg: "#F7F6FC" };

function scoreBand(pct) {
  if (pct === null) return NOT_ASSESSED_BAND;
  return SCORE_BANDS.find(b => pct >= b.min);
}

function scoreSubmission(answers) {
  let total = 0, scored = 0;
  for (const value of Object.values(answers || {})) {
    if (!(value in SCORE_VALUE)) continue; // skips NA and unrecognised values
    total++;
    scored += SCORE_VALUE[value];
  }
  return total > 0 ? Math.round((scored / total) * 100) : null;
}

// Static regulatory/standard reference rows — last-resort fallback only, used
// when AI mapping is unavailable, disabled, or nothing validated against the
// provision index this round. Figures are commonly-cited public maxima as of
// authoring time — included for awareness, not as a substitute for legal
// advice. Matched to a department by static bucket, NOT by inspecting which
// question was actually answered NO/PARTIAL — the AI path (see above) is
// strictly more precise and should be preferred whenever AI is configured.
const FALLBACK_REFERENCE = [
  {
    framework: "DPDPA 2023 (India)",
    provision: "Sec. 8(5) — Reasonable security safeguards",
    summary: "Data fiduciaries must implement reasonable security safeguards to prevent personal data breaches.",
    penalty: "Up to ₹250 crore",
    relatedDepts: ["IT", "SWE", "Operations", "Finance"],
  },
  {
    framework: "DPDPA 2023 (India)",
    provision: "Sec. 5 & 6 — Notice and consent",
    summary: "Valid, informed, and specific consent must be obtained before processing personal data.",
    penalty: "Up to ₹50 crore (residuary — Schedule to the DPDP Act, 2023)",
    relatedDepts: ["Marketing", "HR", "Legal"],
  },
  {
    framework: "GDPR",
    provision: "Art. 32 — Security of processing",
    summary: "Appropriate technical and organisational measures required to ensure a level of security appropriate to risk.",
    penalty: "Up to €20M or 4% of global annual turnover",
    relatedDepts: ["IT", "SWE"],
  },
  {
    framework: "GDPR",
    provision: "Art. 6 & 7 — Lawful basis and consent",
    summary: "Processing requires a documented lawful basis; consent must be freely given, specific, and revocable.",
    penalty: "Up to €20M or 4% of global annual turnover",
    relatedDepts: ["Marketing", "HR", "Legal"],
  },
  {
    framework: "ISO/IEC 27001:2022",
    provision: "Annex A.5.15–5.23 — Access control & supplier relationships",
    summary: "Access rights and third-party/supplier relationships must be controlled, reviewed, and documented.",
    penalty: "No statutory fine — noncompliance risks certification suspension / audit nonconformities",
    relatedDepts: ["IT", "Operations", "Finance"],
  },
];

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ─── Deterministic derivations (no AI) ─────────────────────────────────────

/** submissions: [{ department, answers, userEmail, userName, submittedAt }] grouped by dept. */
function computeDeptRows(byDept) {
  return Object.entries(byDept).map(([dept, subs]) => {
    const scores = subs.map(s => scoreSubmission(s.answers)).filter(v => v !== null);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    const textById = resolveDeptQuestionText(dept, subs);
    const answeredIds = new Set();
    for (const s of subs) for (const id of Object.keys(s.answers || {})) answeredIds.add(id);

    const gapQuestions = [];
    const partialQuestions = [];
    for (const id of answeredIds) {
      const hasNo = subs.some(s => s.answers?.[id] === "NO");
      const hasPartial = subs.some(s => s.answers?.[id] === "PARTIAL");
      const text = textById.get(id) || id;
      if (hasNo) gapQuestions.push({ id, text });
      else if (hasPartial) partialQuestions.push({ id, text });
    }

    return {
      dept,
      contributors: subs.length,
      avgScore,
      gapCount: gapQuestions.length,
      partialCount: partialQuestions.length,
      openItems: gapQuestions.length + partialQuestions.length,
      gapQuestions,
      partialQuestions,
    };
  }).sort((a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101));
}

function buildPriorityFocus(deptRows) {
  const totalOpen = deptRows.reduce((a, d) => a + d.openItems, 0);
  return deptRows
    .filter(d => d.openItems > 0)
    .map(d => ({
      dept: d.dept,
      avgScore: d.avgScore,
      openItems: d.openItems,
      gapCount: d.gapCount,
      partialCount: d.partialCount,
      shareOfOrgWideTotal: totalOpen ? Math.round((d.openItems / totalOpen) * 100) : 0,
    }))
    .sort((a, b) => b.openItems - a.openItems)
    .slice(0, 5);
}

function buildQuickWins(deptRows) {
  return deptRows
    .filter(d => d.avgScore !== null && d.avgScore < 100 && d.openItems > 0 && d.openItems <= 2)
    .map(d => ({ dept: d.dept, avgScore: d.avgScore, openItems: d.openItems, gapCount: d.gapCount, partialCount: d.partialCount }))
    .sort((a, b) => a.openItems - b.openItems);
}

function buildDataQualityNotes(deptRows) {
  const notes = [];

  const notAssessed = deptRows.filter(d => d.avgScore === null).map(d => d.dept);
  if (notAssessed.length) {
    notes.push({
      type: "not-assessed",
      text: `${notAssessed.join(", ")} ${notAssessed.length !== 1 ? "were" : "was"} treated as Not Assessed and excluded from the overall score — no scoreable answers were submitted.`,
    });
  }

  const singleContributor = deptRows.filter(d => d.contributors === 1).map(d => d.dept);
  if (singleContributor.length) {
    notes.push({
      type: "single-contributor",
      text: `Every submission was completed by a single contributor, with no independent peer or manager review built into this round (${singleContributor.length} department${singleContributor.length !== 1 ? "s" : ""}: ${singleContributor.join(", ")}).`,
    });
  }

  const bySignature = {};
  for (const d of deptRows) {
    if (d.avgScore === null) continue;
    const sig = `${d.avgScore}-${d.gapCount}-${d.partialCount}`;
    (bySignature[sig] ||= []).push(d.dept);
  }
  for (const [sig, depts] of Object.entries(bySignature)) {
    if (depts.length < 3) continue;
    const [score] = sig.split("-");
    notes.push({
      type: "identical-scores",
      text: `${depts.join(", ")} returned an identical result — ${score}% — which is worth a light sanity check before treating scores as fully independent assessments.`,
    });
  }

  notes.push({
    type: "trust-based",
    text: "This is a trust-based self-assessment: each department reported on its own controls, and no independent evidence review, technical testing, or third-party verification was performed as part of this exercise.",
  });

  return notes;
}

function buildExecutiveSummary({ companyName, deptRows, overallScore, priorityFocus, quickWins, regulatoryExposure, notAssessedDepts = [] }) {
  const totalGaps = deptRows.reduce((a, d) => a + d.gapCount, 0);
  const totalPartials = deptRows.reduce((a, d) => a + d.partialCount, 0);
  const scoredDeptCount = deptRows.filter(d => d.avgScore !== null).length;
  const notAssessedCount = notAssessedDepts.length;
  const scores = deptRows.map(d => d.avgScore).filter(v => v !== null);
  const co = companyName || "This organization";

  // The narrative paragraph + its self-reported caveat (the italic line under
  // the paragraph in the reference report).
  const range = scores.length > 1 ? `, with individual department scores ranging from ${Math.min(...scores)}% to ${Math.max(...scores)}%` : "";
  const narrative =
    `This report summarizes the actionable insights from ${co}'s PRISM team self-assessment ` +
    `(${deptRows.length} department submission${deptRows.length !== 1 ? "s" : ""}). ` +
    (notAssessedCount ? `Excluding ${notAssessedDepts.join(", ")} — treated as Not Assessed — the ` : "The ") +
    `assessed departments produced an overall compliance score of ` +
    `${overallScore !== null ? `${overallScore}%` : "—"} ("${scoreBand(overallScore).label}")${range}. ` +
    `Beyond the headline score, the underlying data points to a small number of departments driving most of the ` +
    `open items${quickWins.length ? ", a handful of low-effort \"quick win\" opportunities," : ""} and ` +
    `specific regulatory provisions that the self-reported gaps map to.`;
  const caveat = "All figures below are self-reported by the responsible department and have not been independently verified (see the Basis of Assessment note above and Section 6).";

  const bullets = [];
  bullets.push(
    `Org-wide totals: ${totalGaps} unresolved gap${totalGaps !== 1 ? "s" : ""} and ${totalPartials} partial control${totalPartials !== 1 ? "s" : ""} across ${scoredDeptCount} assessed department${scoredDeptCount !== 1 ? "s" : ""}` +
    (notAssessedCount ? ` (${notAssessedCount} not assessed — see Data Quality Notes).` : ".")
  );

  const top = priorityFocus[0];
  if (top && top.shareOfOrgWideTotal > 0) {
    bullets.push(`${top.dept} alone accounts for ${top.shareOfOrgWideTotal}% of all open items organization-wide — the single highest-leverage area for remediation.`);
  }

  if (quickWins.length) {
    bullets.push(`${quickWins.length} department${quickWins.length !== 1 ? "s are" : " is"} each one or two fixes away from a perfect score.`);
  }

  if (regulatoryExposure.length) {
    const topRows = [...regulatoryExposure].sort((a, b) => b.triggeredBy.length - a.triggeredBy.length).slice(0, 2);
    bullets.push(`Open items map most heavily to ${topRows.map(r => `${r.framework} ${r.provisionLabel}`).join(" and ")}.`);
  }

  return {
    headline: overallScore !== null ? `${overallScore}%` : "—",
    band: scoreBand(overallScore).label,
    narrative,
    caveat,
    bullets,
  };
}

// "DPDPA 2023 Sec. 8(5); GDPR Art. 6, Art. 32" per department, from the
// regulatory-exposure rows that name that department — for the Annexure B
// "Regulatory Scope" column. Provisions are grouped under their framework so a
// department mapped to several ISO controls reads "ISO/IEC 27001:2022 A.5.20,
// A.5.34" rather than repeating the framework name each time.
function regulatoryScopeByDept(regulatoryExposure) {
  const byDept = {};
  for (const row of regulatoryExposure) {
    const fw = row.framework.replace(/\s*\(.*\)$/, "").trim();
    for (const t of row.triggeredBy) {
      const deptFw = (byDept[t.dept] ||= {});
      (deptFw[fw] ||= new Set()).add(row.provisionLabel);
    }
  }
  const out = {};
  for (const [dept, frameworks] of Object.entries(byDept)) {
    out[dept] = Object.entries(frameworks)
      .map(([fw, provs]) => `${fw} ${[...provs].join(", ")}`)
      .join("; ");
  }
  return out;
}

function buildRoadmap({ priorityFocus, quickWins, notAssessedDepts, dataQualityNotes }) {
  const phase1 = [];
  const top = priorityFocus[0];
  if (top) {
    phase1.push(
      `Close ${top.dept}'s ${top.gapCount} unresolved gap${top.gapCount !== 1 ? "s" : ""}` +
      (top.partialCount ? ` and ${top.partialCount} partial${top.partialCount !== 1 ? "s" : ""}` : "") +
      ` first — the largest single concentration of open items organization-wide.`
    );
  }
  if (quickWins.length) {
    phase1.push(
      `Bank the ${quickWins.length} quick-win item${quickWins.length !== 1 ? "s" : ""} — ` +
      `${quickWins.map(q => `${q.dept} (${q.openItems} item${q.openItems !== 1 ? "s" : ""})`).join(", ")} — ` +
      `to move ${quickWins.length} department${quickWins.length !== 1 ? "s" : ""} to 100% with minimal effort.`
    );
  }
  if (dataQualityNotes.some(n => n.type === "identical-scores")) {
    phase1.push("Spot-check the departments flagged with identical scores in Data Quality Notes to confirm the self-assessment reflects each department's actual controls.");
  }
  phase1.push("Introduce a second-reviewer sign-off step for department self-assessments going forward.");
  if (notAssessedDepts.length) {
    phase1.push(`Obtain a validated self-assessment submission for ${notAssessedDepts.join(", ")}, currently treated as Not Assessed and excluded from the overall score.`);
  }

  const rest = priorityFocus.slice(1);
  const mid = Math.ceil(rest.length / 2);
  const phase2 = rest.slice(0, mid).map(d =>
    `Remediate ${d.dept}'s remaining ${d.openItems} open item${d.openItems !== 1 ? "s" : ""} ` +
    `(${d.gapCount} gap${d.gapCount !== 1 ? "s" : ""}, ${d.partialCount} partial${d.partialCount !== 1 ? "s" : ""}).`
  );

  const phase3Depts = rest.slice(mid);
  const phase3 = [
    ...(phase3Depts.length ? [`Close the remaining lower-priority open items in ${phase3Depts.map(d => d.dept).join(", ")}.`] : []),
    "Re-run the self-assessment organization-wide to produce an updated score set and measure movement against this baseline.",
    "Establish a recurring (quarterly or annual) self-assessment cadence with mandatory second-reviewer sign-off built in from the start.",
  ];

  return {
    phase1: { label: "Immediate (0–30 days)", actions: phase1 },
    phase2: { label: "Short-Term (30–90 days)", actions: phase2 },
    phase3: { label: "Medium-Term (90–180 days)", actions: phase3 },
  };
}

// ─── Regulatory exposure ────────────────────────────────────────────────────
// AI path: aiExposureMappings is already validated against the checked-in
// provision index (aiProvider.mapRegulatoryExposure -> validExposureMapping)
// before it ever reaches this file — title/url/penalty here are index values,
// never model-authored text. Fallback path: the static FALLBACK_REFERENCE
// table, dept-bucket matched, used only when nothing AI-validated is available.

// DPDPA ids in the index are bare ("8(5)"); GDPR/ISO already carry their own
// prefix ("Art. 32", "A.5.15"). Present DPDPA as "Sec. 8(5)" to match how the
// Act is normally cited.
function provisionLabelFor(framework, id) {
  return framework === "DPDPA" && !/^sec/i.test(id) ? `Sec. ${id}` : id;
}

function buildRegulatoryExposureFromAI(aiExposureMappings) {
  const byProvision = new Map();
  for (const m of aiExposureMappings) {
    const key = `${m.framework}|${m.provisionId}`;
    if (!byProvision.has(key)) {
      // Re-resolve title/url/penalty from the checked-in index at render time
      // rather than trusting the fields on the mapping — those may have been
      // cached (self_assessment_reports) before the index was last edited, and
      // the index is the single source of truth for citation text.
      const idx = lookupProvision(m.framework, m.provisionId) || {};
      byProvision.set(key, {
        source: "ai",
        framework: idx.frameworkName || m.frameworkName,
        provisionId: m.provisionId,
        provisionLabel: provisionLabelFor(m.framework, m.provisionId),
        summary: idx.title || m.title,
        penalty: idx.penalty || m.penalty || "Not specified — see official source",
        url: idx.url || m.url,
        _byDept: new Map(),
      });
    }
    // The model can emit more than one mapping for the same (provision, dept)
    // pair — merge them into one triggeredBy entry, unioning the question ids.
    const dedup = byProvision.get(key)._byDept;
    const existing = dedup.get(m.dept);
    if (existing) {
      existing.questionIds = [...new Set([...existing.questionIds, ...m.relatedQuestionIds])];
    } else {
      dedup.set(m.dept, { dept: m.dept, rationale: m.rationale, questionIds: [...m.relatedQuestionIds] });
    }
  }
  return [...byProvision.values()].map(({ _byDept, ...row }) => ({
    ...row,
    triggeredBy: [..._byDept.values()].map(e => ({ dept: e.dept, rationale: e.rationale, questionCount: e.questionIds.length })),
  }));
}

function buildFallbackExposure(deptRows) {
  const deptsWithGaps = new Set(deptRows.filter(d => d.openItems > 0).map(d => d.dept));
  return FALLBACK_REFERENCE
    .filter(row => row.relatedDepts.some(d => deptsWithGaps.has(d)))
    .map(row => ({
      source: "fallback",
      framework: row.framework,
      provisionId: null,
      provisionLabel: row.provision.split("—")[0].trim(),
      summary: row.summary,
      penalty: row.penalty,
      url: null,
      triggeredBy: deptRows
        .filter(d => row.relatedDepts.includes(d.dept) && d.openItems > 0)
        .map(d => ({ dept: d.dept, rationale: null, questionCount: d.openItems })),
    }));
}

function buildRiskRewardRows(deptRows, regulatoryExposure) {
  return deptRows.map(d => {
    const hasGaps = d.openItems > 0;
    const gapParts = [];
    if (d.gapCount) gapParts.push(`${d.gapCount} unresolved gap${d.gapCount !== 1 ? "s" : ""}`);
    if (d.partialCount) gapParts.push(`${d.partialCount} partial control${d.partialCount !== 1 ? "s" : ""}`);
    const gapsSummary = gapParts.join(" and ");

    const applicable = regulatoryExposure.filter(r => r.triggeredBy.some(t => t.dept === d.dept));

    let riskReasons = [], riskText;
    if (!hasGaps) {
      riskText = "No material gaps identified — low exposure.";
    } else if (applicable.length) {
      riskReasons = applicable.map(r => ({ framework: r.framework, provision: r.provisionLabel, why: r.summary, penalty: r.penalty, url: r.url }));
      riskText = `${gapsSummary} in ${d.dept} fall within scope of ${riskReasons.map(r => `${r.framework} ${r.provision}`).join("; ")} — penalty ${riskReasons.map(r => r.penalty).join("; ")}.`;
    } else {
      riskText = `${gapsSummary} identified, with no mapped regulatory reference for this department.`;
    }

    let rewardText;
    if (!hasGaps) {
      rewardText = "Already at low risk — maintain current controls.";
    } else {
      const frameworks = [...new Set(applicable.map(r => r.framework))];
      const scoreNote = d.avgScore !== null ? `raise score from ${d.avgScore}% to up to 100%` : "establish a baseline score";
      rewardText = `Closing ${gapsSummary} would ${scoreNote}, avoid the exposure above${frameworks.length ? `, and strengthen ${frameworks.join(" / ")} readiness` : ""}.`;
    }

    return { dept: d.dept, hasGaps, gapsSummary, riskReasons, riskText, rewardText };
  });
}

// ─── HTML — a typeset document, not an email card ───────────────────────────
// Full-page layout modelled on the PRISM "Key Insights & Priority Actions"
// report: navy section headers with a rule, navy table header rows, numbered
// sections, narrative intros. Rendered as-is both in the email and (via an
// iframe) in the in-app Team Report, so all three surfaces are identical.

const NAVY = "#1E3A5F";
const NAVY_SOFT = "#F0F3F8";
const DOC_INK = "#22252E";
const DOC_MUTED = "#5A6270";
const DOC_BORDER = "#DADEE6";
const DOC_BG = "#F4F4F6";
const AMBER_BG = "#FEF6E7";
const AMBER_BORDER = "#F3D48B";
const DOC_FONT = "'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";

const bandColor = (pct) => scoreBand(pct).color;

function docSection(n, label, body) {
  return `
    <h2 style="font-family:${DOC_FONT};font-size:17px;font-weight:700;color:${NAVY};margin:36px 0 0;padding-bottom:7px;border-bottom:2px solid ${NAVY};">
      ${n ? `${n}. ` : ""}${esc(label)}
    </h2>
    <div style="margin-top:14px;">${body}</div>`;
}

function para(text) {
  return `<p style="font-family:${DOC_FONT};font-size:13.5px;line-height:1.62;color:${DOC_INK};margin:0 0 12px;">${text}</p>`;
}
function caveat(text) {
  return `<p style="font-family:${DOC_FONT};font-size:12.5px;line-height:1.6;color:${DOC_MUTED};font-style:italic;margin:0 0 12px;">${esc(text)}</p>`;
}
function bullets(items) {
  return `<ul style="font-family:${DOC_FONT};margin:0 0 4px;padding-left:20px;">${items.map(b => `<li style="font-size:13px;line-height:1.6;color:${DOC_INK};margin-bottom:7px;">${esc(b)}</li>`).join("")}</ul>`;
}

function docTable(headers, rows, { widths = [] } = {}) {
  const th = headers.map((h, i) =>
    `<th style="background:${NAVY};color:#fff;font-family:${DOC_FONT};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;text-align:left;padding:9px 12px;${widths[i] ? `width:${widths[i]};` : ""}">${esc(h)}</th>`
  ).join("");
  const tr = rows.map((cells, r) => {
    const bg = r % 2 ? NAVY_SOFT : "#fff";
    const tds = cells.map(c => {
      const { html, colspan, ...st } = typeof c === "object" && c !== null ? c : { html: c };
      const style = Object.entries(st).map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}:${v}`).join(";");
      return `<td${colspan ? ` colspan="${colspan}"` : ""} style="font-family:${DOC_FONT};font-size:12.5px;line-height:1.5;color:${DOC_INK};padding:9px 12px;border-bottom:1px solid ${DOC_BORDER};vertical-align:top;${style}">${html}</td>`;
    }).join("");
    return `<tr style="background:${bg};">${tds}</tr>`;
  }).join("");
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid ${DOC_BORDER};margin-bottom:6px;"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function statusCell(pct) {
  const b = scoreBand(pct);
  return { html: `<strong style="color:${b.color};">${b.label}</strong>` };
}

export function buildSelfAssessmentReportHtml({
  companyName, submissions, deptRows, overallScore, executiveSummary, priorityFocus,
  quickWins, dataQualityNotes, roadmap, regulatoryExposure, regulatoryExposureSource,
  requestedByEmail, logoDataUri,
}) {
  const generatedAt = new Date().toLocaleDateString("en-IN", { dateStyle: "long" });
  const band = scoreBand(overallScore);
  const notAssessed = deptRows.filter(d => d.avgScore === null).map(d => d.dept);
  const co = esc(companyName || "Your organization");

  // 2 — Department Scorecard
  const scorecard = docTable(
    ["Department", "Score", "Status", "Gaps", "Partials"],
    deptRows.map(d => [
      { html: `<strong>${esc(d.dept)}</strong>` },
      { html: d.avgScore !== null ? `${d.avgScore}%` : "—", "font-weight": "700" },
      d.avgScore !== null ? statusCell(d.avgScore) : { html: `<span style="color:${DOC_MUTED};">Not Assessed</span>` },
      { html: String(d.gapCount), color: d.gapCount ? "#B91C1C" : DOC_MUTED, "font-weight": d.gapCount ? "700" : "400" },
      { html: String(d.partialCount), color: d.partialCount ? "#B45309" : DOC_MUTED, "font-weight": d.partialCount ? "700" : "400" },
    ]),
    { widths: ["", "12%", "16%", "10%", "10%"] }
  );

  // 3 — Priority Focus
  const priority = priorityFocus.length ? docTable(
    ["Department", "Score", "Open Items (Gaps + Partials)", "Share of Org-Wide Total"],
    priorityFocus.map(d => [
      { html: `<strong>${esc(d.dept)}</strong>` },
      d.avgScore !== null ? `${d.avgScore}%` : "—",
      `${d.openItems} (${d.gapCount} gap${d.gapCount !== 1 ? "s" : ""}, ${d.partialCount} partial${d.partialCount !== 1 ? "s" : ""})`,
      `≈ ${d.shareOfOrgWideTotal}% of all open items org-wide`,
    ])
  ) : para("No department has an open item this round.");

  // 4 — Quick Wins
  const quick = quickWins.length ? docTable(
    ["Department", "Movement If Closed", "Remaining Items"],
    quickWins.map(d => [
      { html: `<strong>${esc(d.dept)}</strong>` },
      `${d.avgScore}% → 100%`,
      `${d.gapCount} gap${d.gapCount !== 1 ? "s" : ""} + ${d.partialCount} partial${d.partialCount !== 1 ? "s" : ""}`,
    ])
  ) : para("No department is within one or two fixes of a perfect score this round.");

  // 5 — Regulatory Exposure
  const exposure = regulatoryExposure.length ? (
    docTable(
      ["Framework", "Provision", "Requirement", "Penalty / Fine"],
      regulatoryExposure.flatMap(row => [
        [
          { html: `<strong>${esc(row.framework)}</strong>` },
          esc(row.provisionLabel),
          esc(row.summary),
          { html: esc(row.penalty), "font-weight": "700", color: "#B91C1C" },
        ],
        [{
          html: `<span style="color:${NAVY};"><strong>Why this applies to you:</strong> ${esc(row.triggeredBy.map(t => t.dept).join(", "))} — self-assessed with open gaps in this exact area.</span>${row.url ? ` <a href="${esc(row.url)}" style="color:${NAVY};font-weight:600;">View official source ↗</a>` : ""}`,
          colspan: "4",
          "font-size": "11.5px",
          background: "#fff",
        }],
      ])
    ) +
    caveat(regulatoryExposureSource === "ai"
      ? "Each row was mapped from this organization's actual open self-assessment items by AI and checked against a curated index of official provisions — the provision id shown is never invented. Follow \"View official source\" to verify. Penalty figures are commonly-cited public maxima, for awareness only — not legal advice."
      : "AI mapping was unavailable for this report, so this table is a static, department-bucket reference — not derived from the specific open items. Penalty figures are commonly-cited public maxima, for awareness only — not legal advice.")
  ) : para("No open self-assessment item mapped to a tracked regulatory provision this round.");

  // 7 — Roadmap
  const phaseTable = (phase) => !phase.actions.length ? "" : `
    <h3 style="font-family:${DOC_FONT};font-size:13.5px;font-weight:700;color:${NAVY};margin:18px 0 8px;">${esc(phase.title || phase.label)}</h3>
    ${docTable(["#", "Action"], phase.actions.map((a, i) => [
      { html: String(i + 1), "font-weight": "700", "text-align": "center" },
      esc(a),
    ]), { widths: ["6%", ""] })}`;
  const roadmapBody =
    para("The roadmap sequences remediation by urgency and by where open items are concentrated: Phase 1 targets the highest-volume items first, Phase 2 the remaining regulation-mapped gaps, Phase 3 the lower-priority items plus a repeatable review process.") +
    phaseTable({ ...roadmap.phase1, title: `Phase 1 — ${roadmap.phase1.label}` }) +
    phaseTable({ ...roadmap.phase2, title: `Phase 2 — ${roadmap.phase2.label}` }) +
    phaseTable({ ...roadmap.phase3, title: `Phase 3 — ${roadmap.phase3.label}` });

  // Annexure B — full detail + regulatory scope per department
  const legend = docTable(["Term", "Meaning"], [
    [{ html: `<strong style="color:${bandColor(85)};">Strong</strong>` }, "Self-assessed score of 80% or higher"],
    [{ html: `<strong style="color:${bandColor(70)};">Moderate</strong>` }, "Self-assessed score of 60%–79%"],
    [{ html: `<strong style="color:${bandColor(45)};">Developing</strong>` }, "Self-assessed score of 40%–59%"],
    [{ html: `<strong style="color:${bandColor(10)};">Needs work</strong>` }, "Self-assessed score below 40%"],
    [{ html: `<span style="color:${DOC_MUTED};">Not Assessed</span>` }, "No scoreable answers submitted — excluded from the overall score"],
    ["Gaps", "Unresolved control items, as self-reported by the department"],
    ["Partials", "Controls reported as partially, but not fully, in place"],
  ], { widths: ["22%", ""] });
  const annexure = docTable(
    ["Department", "Score", "Status", "Open Items", "Regulatory Scope (this assessment)"],
    deptRows.map(d => [
      { html: `<strong>${esc(d.dept)}</strong>` },
      d.avgScore !== null ? `${d.avgScore}%` : "—",
      d.avgScore !== null ? statusCell(d.avgScore) : { html: `<span style="color:${DOC_MUTED};">Not Assessed</span>` },
      `${d.gapCount} gap${d.gapCount !== 1 ? "s" : ""}, ${d.partialCount} partial${d.partialCount !== 1 ? "s" : ""}`,
      { html: esc(d.regulatoryScope || "None mapped in this assessment"), color: d.regulatoryScope ? DOC_INK : DOC_MUTED },
    ]),
    { widths: ["", "9%", "13%", "18%", "32%"] }
  );

  const body = `
  <div style="background:${DOC_BG};padding:32px 16px;font-family:${DOC_FONT};">
    <div style="max-width:820px;margin:0 auto;background:#fff;border:1px solid ${DOC_BORDER};padding:52px 60px 40px;">

      ${logoDataUri ? `<img src="${logoDataUri}" alt="PRISM" style="height:38px;width:auto;margin-bottom:22px;" />` : ""}
      <div style="font-size:27px;font-weight:800;color:${NAVY};letter-spacing:-0.01em;">${co}</div>
      <div style="font-size:15px;font-weight:600;color:${NAVY};margin-top:3px;">PRISM Team Self-Assessment — Key Insights &amp; Priority Actions</div>
      <div style="font-size:12px;color:${DOC_MUTED};font-style:italic;margin-top:8px;line-height:1.6;">
        ${submissions.length} self-assessment submission${submissions.length !== 1 ? "s" : ""} across ${deptRows.length} department${deptRows.length !== 1 ? "s" : ""}
        &nbsp;•&nbsp; Generated ${esc(generatedAt)}
        &nbsp;•&nbsp; Overall Compliance Score: <strong style="color:${band.color};font-style:normal;">${overallScore !== null ? `${overallScore}%` : "—"} (${band.label})</strong>
        ${requestedByEmail ? `<br/>Requested by ${esc(requestedByEmail)}` : ""}
        ${notAssessed.length ? `<br/>${esc(notAssessed.join(", "))} treated as Not Assessed and excluded from the overall score` : ""}
      </div>

      <div style="background:${AMBER_BG};border:1px solid ${AMBER_BORDER};border-radius:6px;padding:12px 16px;margin-top:18px;">
        <div style="font-size:12.5px;font-weight:700;color:#92590C;">Basis of Assessment: Trust-Based Self-Reporting</div>
        <div style="font-size:12px;color:#6B4A0B;line-height:1.6;margin-top:4px;">
          This report is generated from a trust-based, self-reported assessment. Each department submitted its own responses through PRISM, and the scores, gaps, and partials reflect what each department reported about itself. No independent verification, evidence review, or third-party validation was performed as part of this exercise.
        </div>
      </div>

      ${docSection(1, "Executive Summary",
        para(executiveSummary.narrative) + caveat(executiveSummary.caveat) + bullets(executiveSummary.bullets))}

      ${docSection(2, "Department Scorecard",
        para("Full self-assessment results by department, ranked from lowest to highest score. “Gaps” are unresolved control items; “Partials” are controls that are partly, but not fully, in place.") + scorecard)}

      ${docSection(3, "Priority Focus Areas",
        para("Ranking departments purely by score can understate where the real remediation effort is needed. Ranking instead by the raw count of open items (gaps + partials) shows where effort is concentrated:") + priority)}

      ${docSection(4, "Quick-Win Opportunities",
        para("Departments already close to a perfect score that can reach 100% with minimal additional effort — useful as early, visible progress while larger remediation work is underway elsewhere:") + quick)}

      ${docSection(5, "Regulatory Exposure Summary",
        para("The self-reported gaps and partials cluster around a small number of regulatory provisions. This table consolidates which provisions each department's open items fall within scope of.") + exposure)}

      ${docSection(6, "Basis of Assessment & Data Quality Notes", bullets(dataQualityNotes.map(n => n.text)))}

      ${docSection(7, "Recommended Remediation Roadmap", roadmapBody)}

      ${docSection(null, "Annexure B — Full Department-Wise Detail",
        para("Every department's self-assessment result in full, including the specific regulatory provisions its open items were mapped to (where applicable). All figures are self-reported and have not been independently verified.") +
        `<h3 style="font-family:${DOC_FONT};font-size:13.5px;font-weight:700;color:${NAVY};margin:18px 0 8px;">Legend</h3>` + legend +
        `<div style="height:14px;"></div>` + annexure)}

      <div style="border-top:1px solid ${DOC_BORDER};margin-top:32px;padding-top:14px;font-size:11px;color:${DOC_MUTED};line-height:1.6;">
        Source: PRISM Team Self-Assessment — ${co}, generated ${esc(generatedAt)}.<br/>
        Generated by PRISM. This document is confidential and intended for internal circulation only.
      </div>
    </div>
  </div>`;

  const text = `PRISM Team Self-Assessment — ${companyName || "Your organization"}\n` +
    `${submissions.length} submissions across ${deptRows.length} departments. Overall Compliance Score: ${overallScore !== null ? `${overallScore}%` : "—"} (${band.label})\n` +
    (requestedByEmail ? `Requested by ${requestedByEmail}\n` : "") +
    `\n1. EXECUTIVE SUMMARY\n${executiveSummary.narrative}\n${executiveSummary.caveat}\n${executiveSummary.bullets.map(b => `  - ${b}`).join("\n")}\n` +
    `\n2. DEPARTMENT SCORECARD\n` +
    deptRows.map(d => `  ${d.dept}: ${d.avgScore !== null ? `${d.avgScore}%` : "Not Assessed"} — ${d.gapCount} gaps, ${d.partialCount} partials`).join("\n") +
    `\n\n5. REGULATORY EXPOSURE\n` +
    (regulatoryExposure.length
      ? regulatoryExposure.map(r => `  ${r.framework} ${r.provisionLabel} — ${r.penalty}  (${r.triggeredBy.map(t => t.dept).join(", ")})${r.url ? `\n    ${r.url}` : ""}`).join("\n")
      : "  (none mapped this round)") +
    `\n\n7. REMEDIATION ROADMAP\n` +
    [roadmap.phase1, roadmap.phase2, roadmap.phase3].map(p =>
      p.actions.length ? `  ${p.label}\n` + p.actions.map((a, i) => `    ${i + 1}. ${a}`).join("\n") : ""
    ).filter(Boolean).join("\n");

  return { html: body, text };
}

/**
 * @param {{ companyName?: string, submissions: Array, requestedByEmail?: string,
 *   aiExposureMappings?: Array }} args
 *   aiExposureMappings: already-validated output of
 *   aiProvider.mapRegulatoryExposure() (see aiProvider.js's validExposureMapping) —
 *   pass [] when AI is unavailable/disabled to use the static fallback table.
 */
export function buildSelfAssessmentReport({ companyName, submissions, requestedByEmail, aiExposureMappings = [] }) {
  const byDept = {};
  for (const s of submissions) (byDept[s.department] ||= []).push(s);

  const deptRows = computeDeptRows(byDept);
  const validScores = deptRows.map(d => d.avgScore).filter(v => v !== null);
  const overallScore = validScores.length ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null;

  const priorityFocus = buildPriorityFocus(deptRows);
  const quickWins = buildQuickWins(deptRows);
  const dataQualityNotes = buildDataQualityNotes(deptRows);
  const notAssessedDepts = deptRows.filter(d => d.avgScore === null).map(d => d.dept);
  const roadmap = buildRoadmap({ priorityFocus, quickWins, notAssessedDepts, dataQualityNotes });

  const regulatoryExposureSource = aiExposureMappings.length ? "ai" : "fallback";
  const regulatoryExposure = aiExposureMappings.length
    ? buildRegulatoryExposureFromAI(aiExposureMappings)
    : buildFallbackExposure(deptRows);

  // Annexure B "Regulatory Scope" column, per department.
  const scopeByDept = regulatoryScopeByDept(regulatoryExposure);
  for (const d of deptRows) d.regulatoryScope = scopeByDept[d.dept] || null;

  const riskRewardRows = buildRiskRewardRows(deptRows, regulatoryExposure);

  const executiveSummary = buildExecutiveSummary({
    companyName, deptRows, overallScore, priorityFocus, quickWins, regulatoryExposure, notAssessedDepts,
  });

  const { html, text } = buildSelfAssessmentReportHtml({
    companyName, submissions, deptRows, overallScore, executiveSummary, priorityFocus,
    quickWins, dataQualityNotes, roadmap, regulatoryExposure,
    regulatoryExposureSource, requestedByEmail, logoDataUri: PRISM_LOGO_DATA_URI,
  });

  return {
    html,
    text,
    overallScore,
    overallBand: scoreBand(overallScore).label,
    deptRows,
    priorityFocus,
    quickWins,
    dataQualityNotes,
    roadmap,
    riskRewardRows,
    regulatoryExposure,
    regulatoryExposureSource,
    executiveSummary,
  };
}

/**
 * The per-department gap/partial question text (id + text), needed by the
 * route to feed aiProvider.mapRegulatoryExposure() before calling
 * buildSelfAssessmentReport(). Kept separate so the report builder itself
 * stays synchronous and easy to unit test.
 */
export function buildDeptOpenItems(submissions) {
  const byDept = {};
  for (const s of submissions) (byDept[s.department] ||= []).push(s);
  return computeDeptRows(byDept)
    .filter(d => d.openItems > 0) // no point spending a prompt on a department with nothing open
    .map(d => ({ dept: d.dept, gapQuestions: d.gapQuestions, partialQuestions: d.partialQuestions }));
}

export { scoreBand, scoreSubmission, FALLBACK_REFERENCE };
