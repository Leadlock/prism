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

const SCORE_VALUE = { YES: 1, PARTIAL: 0.5, NO: 0 };

// Design tokens — a "light through a prism" palette: a violet/indigo/sky
// banner gradient standing in for the spectrum, with the same five spectrum
// hues reused as the risk-band scale everywhere a score is shown, so the
// coloring always means the same thing across the report.
const INK = "#1E1B2E";
const TEXT_MUTED = "#5B5570";
const TEXT_FAINT = "#8B85A0";
const SURFACE = "#FFFFFF";
const SURFACE_MUTED = "#F7F6FC";
const PAGE_BG = "#EEECF7";
const BORDER = "#E4E1F2";
const INDIGO = "#4338CA";
const VIOLET = "#6D28D9";
const SPECTRUM = "linear-gradient(90deg,#DC2626,#D97706,#EAB308,#22C55E,#0EA5E9,#6D28D9)";
const BANNER_GRADIENT = "linear-gradient(120deg,#3730A3 0%,#6D28D9 55%,#0EA5E9 120%)";
const SERIF = "Georgia,'Iowan Old Style','Palatino Linotype',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const SCORE_BANDS = [
  { min: 80, label: "Strong", color: "#15803D", bg: "#DCFCE7" },
  { min: 60, label: "Moderate", color: "#B45309", bg: "#FEF3C7" },
  { min: 40, label: "Developing", color: "#C2410C", bg: "#FFEDD5" },
  { min: 0, label: "Needs work", color: "#B91C1C", bg: "#FEE2E2" },
];
const NOT_ASSESSED_BAND = { label: "Not assessed", color: TEXT_FAINT, bg: SURFACE_MUTED };

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
    provision: "Sec. 6 & 10 — Consent and notice",
    summary: "Valid, informed, and specific consent must be obtained before processing personal data.",
    penalty: "Up to ₹50 crore",
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

function pill(pct) {
  const band = scoreBand(pct);
  return `<span style="display:inline-block;background:${band.bg};color:${band.color};font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;padding:3px 10px;border-radius:20px;white-space:nowrap;">${esc(band.label)}</span>`;
}

// Table-cell-width meter — safe in email clients that don't support
// absolute positioning or CSS gradients on arbitrary elements.
function meterBar(pct, { height = 8 } = {}) {
  const filled = pct === null ? 0 : Math.max(2, Math.min(100, pct));
  const band = scoreBand(pct);
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;height:${height}px;">
    <tr>
      <td width="${filled}%" bgcolor="${band.color}" style="background:${band.color};font-size:1px;line-height:${height}px;border-radius:${height / 2}px 0 0 ${height / 2}px;">&nbsp;</td>
      ${filled < 100 ? `<td width="${100 - filled}%" bgcolor="${BORDER}" style="background:${BORDER};font-size:1px;line-height:${height}px;border-radius:0 ${height / 2}px ${height / 2}px 0;">&nbsp;</td>` : ""}
    </tr>
  </table>`;
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

function buildExecutiveSummary({ deptRows, overallScore, priorityFocus, quickWins, regulatoryExposure, notAssessedCount }) {
  const totalGaps = deptRows.reduce((a, d) => a + d.gapCount, 0);
  const totalPartials = deptRows.reduce((a, d) => a + d.partialCount, 0);
  const scoredDeptCount = deptRows.filter(d => d.avgScore !== null).length;

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
    bullets,
  };
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

function buildRegulatoryExposureFromAI(aiExposureMappings) {
  const byProvision = new Map();
  for (const m of aiExposureMappings) {
    const key = `${m.framework}|${m.provisionId}`;
    if (!byProvision.has(key)) {
      byProvision.set(key, {
        source: "ai",
        framework: m.frameworkName,
        provisionId: m.provisionId,
        provisionLabel: m.provisionId,
        summary: m.title,
        penalty: m.penalty || "Not specified — see official source",
        url: m.url,
        triggeredBy: [],
      });
    }
    byProvision.get(key).triggeredBy.push({ dept: m.dept, rationale: m.rationale, questionCount: m.relatedQuestionIds.length });
  }
  return [...byProvision.values()];
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

// ─── HTML ───────────────────────────────────────────────────────────────────

const rowStyle = "padding:10px 12px;border-bottom:1px solid " + BORDER + ";font-family:" + SANS + ";font-size:13px;color:" + INK + ";vertical-align:top;";
const thStyle = `padding:9px 12px;background:${SURFACE_MUTED};border-bottom:2px solid ${BORDER};text-align:left;font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${TEXT_MUTED};`;

function sectionHeading(label) {
  return `
    <div style="margin:28px 0 12px;">
      <div style="font-family:${SERIF};font-size:16px;font-weight:700;color:${INK};">${esc(label)}</div>
      <div style="height:3px;width:40px;background:${SPECTRUM};border-radius:2px;margin-top:6px;"></div>
    </div>`;
}

function bulletList(items) {
  return `<ul style="margin:0;padding-left:18px;">${items.map(b => `<li style="font-size:13px;color:${INK};margin-bottom:6px;line-height:1.5;">${esc(b)}</li>`).join("")}</ul>`;
}

export function buildSelfAssessmentReportHtml({ companyName, submissions, deptRows, overallScore, executiveSummary, priorityFocus, quickWins, dataQualityNotes, roadmap, riskRewardRows, regulatoryExposure, regulatoryExposureSource, requestedByEmail }) {
  const deptTableRows = deptRows.map(d => `
    <tr>
      <td style="${rowStyle}font-weight:700;">${esc(d.dept)}</td>
      <td style="${rowStyle}color:${TEXT_MUTED};">${d.contributors}</td>
      <td style="${rowStyle}width:140px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:${SERIF};font-size:15px;font-weight:700;padding-right:10px;white-space:nowrap;">${d.avgScore !== null ? `${d.avgScore}%` : "—"}</td>
          <td style="width:70px;">${meterBar(d.avgScore, { height: 6 })}</td>
        </tr></table>
      </td>
      <td style="${rowStyle}">${pill(d.avgScore)}</td>
      <td style="${rowStyle}color:${d.gapCount ? "#B91C1C" : TEXT_MUTED};font-weight:${d.gapCount ? "700" : "400"};">${d.gapCount}</td>
      <td style="${rowStyle}color:${d.partialCount ? "#B45309" : TEXT_MUTED};font-weight:${d.partialCount ? "700" : "400"};">${d.partialCount}</td>
    </tr>`).join("");

  const priorityRows = priorityFocus.map(d => `
    <tr>
      <td style="${rowStyle}font-weight:700;">${esc(d.dept)}</td>
      <td style="${rowStyle}">${d.avgScore !== null ? `${d.avgScore}%` : "—"}</td>
      <td style="${rowStyle}">${d.openItems} (${d.gapCount} gap${d.gapCount !== 1 ? "s" : ""}, ${d.partialCount} partial${d.partialCount !== 1 ? "s" : ""})</td>
      <td style="${rowStyle}">≈ ${d.shareOfOrgWideTotal}% of all open items org-wide</td>
    </tr>`).join("");

  const quickWinRows = quickWins.map(d => `
    <tr>
      <td style="${rowStyle}font-weight:700;">${esc(d.dept)}</td>
      <td style="${rowStyle}">${d.avgScore}% → 100%</td>
      <td style="${rowStyle}">${d.gapCount} gap${d.gapCount !== 1 ? "s" : ""} + ${d.partialCount} partial${d.partialCount !== 1 ? "s" : ""}</td>
    </tr>`).join("");

  const riskRewardTableRows = riskRewardRows.map(r => {
    const riskCellBody = r.riskReasons.length
      ? `<div style="font-weight:600;margin-bottom:6px;">${esc(r.gapsSummary)} in ${esc(r.dept)} fall within scope of:</div>` +
        r.riskReasons.map(rr => `
          <div style="margin-bottom:8px;padding-left:10px;border-left:2px solid #FCA5A5;">
            <div style="font-weight:700;">${esc(rr.framework)} — ${esc(rr.provision)}</div>
            <div style="color:${TEXT_MUTED};margin:2px 0;">${esc(rr.why)}</div>
            <div style="color:#B91C1C;font-weight:700;">Penalty: ${esc(rr.penalty)}</div>
          </div>`).join("")
      : esc(r.riskText);
    return `
    <tr>
      <td style="${rowStyle}font-weight:700;">${esc(r.dept)}</td>
      <td style="${rowStyle}${r.hasGaps ? `border-left:3px solid #DC2626;background:#FEF2F2;` : ""}">${riskCellBody}</td>
      <td style="${rowStyle}border-left:3px solid #059669;background:#ECFDF5;">${esc(r.rewardText)}</td>
    </tr>`;
  }).join("");

  const referenceTableRows = regulatoryExposure.map((row, i) => `
    <tr>
      <td style="${rowStyle}background:${i % 2 ? SURFACE_MUTED : SURFACE};font-weight:700;width:17%;">${esc(row.framework)}</td>
      <td style="${rowStyle}background:${i % 2 ? SURFACE_MUTED : SURFACE};width:21%;">${esc(row.provisionLabel)}</td>
      <td style="${rowStyle}background:${i % 2 ? SURFACE_MUTED : SURFACE};color:${TEXT_MUTED};width:41%;">${esc(row.summary)}</td>
      <td style="${rowStyle}background:${i % 2 ? SURFACE_MUTED : SURFACE};font-weight:700;color:#B91C1C;width:21%;">${esc(row.penalty)}</td>
    </tr>
    <tr>
      <td colspan="4" style="padding:0 12px 10px;border-bottom:1px solid ${BORDER};background:${i % 2 ? SURFACE_MUTED : SURFACE};font-family:${SANS};font-size:11.5px;color:${VIOLET};">
        <strong>Why this applies to you:</strong> ${esc(row.triggeredBy.map(t => t.dept).join("; "))} — self-assessed with open gaps in this exact area.${row.url ? ` <a href="${esc(row.url)}" style="color:${VIOLET};">Official source ↗</a>` : ""}
      </td>
    </tr>`).join("");

  const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const overallBand = scoreBand(overallScore);

  const html = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};border-collapse:collapse;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:100%;background:${SURFACE};border-radius:14px;border-collapse:separate;overflow:hidden;">

        <tr><td bgcolor="${INDIGO}" style="background:${INDIGO};background-image:${BANNER_GRADIENT};padding:26px 32px;">
          <div style="font-family:${SERIF};font-size:21px;font-weight:700;color:#FFFFFF;">Team Self-Assessment Report</div>
          <div style="font-family:${SANS};font-size:12px;color:rgba(255,255,255,0.82);margin-top:6px;">
            ${esc(companyName || "Company")} &nbsp;·&nbsp; ${submissions.length} submission${submissions.length !== 1 ? "s" : ""} across ${deptRows.length} department${deptRows.length !== 1 ? "s" : ""} &nbsp;·&nbsp; Generated ${esc(generatedAt)}${requestedByEmail ? ` &nbsp;·&nbsp; Requested by ${esc(requestedByEmail)}` : ""}
          </div>
        </td></tr>

        <tr><td style="padding:14px 32px 0;">
          <div style="background:${SURFACE_MUTED};border:1px solid ${BORDER};border-radius:8px;padding:10px 14px;font-family:${SANS};font-size:11px;color:${TEXT_MUTED};line-height:1.5;">
            <strong style="color:${INK};">Basis of assessment — trust-based self-reporting.</strong> Each department submitted its own responses; the scores, gaps, and partials in this report reflect what each department reported about itself. No independent verification, evidence review, or third-party validation was performed.
          </div>
        </td></tr>

        <tr><td style="padding:22px 32px 4px;">
          <div style="font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TEXT_MUTED};margin-bottom:8px;">Overall Compliance Score</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:${SERIF};font-size:38px;font-weight:700;color:${INK};line-height:1;">${overallScore !== null ? `${overallScore}%` : "—"}</td>
            <td align="right" style="vertical-align:bottom;padding-bottom:8px;">${pill(overallScore)}</td>
          </tr></table>
          <div style="margin-top:12px;">${meterBar(overallScore, { height: 10 })}</div>
        </td></tr>

        <tr><td style="padding:0 32px;">
          ${sectionHeading("Executive Summary")}
          ${bulletList(executiveSummary.bullets)}
        </td></tr>

        <tr><td style="padding:0 32px;">
          ${sectionHeading("Department Scorecard")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><th style="${thStyle}">Department</th><th style="${thStyle}">Contributors</th><th style="${thStyle}">Score</th><th style="${thStyle}">Status</th><th style="${thStyle}">Gaps</th><th style="${thStyle}">Partial</th></tr>
            ${deptTableRows}
          </table>
        </td></tr>

        ${priorityFocus.length ? `
        <tr><td style="padding:0 32px;">
          ${sectionHeading("Priority Focus Areas")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><th style="${thStyle}">Department</th><th style="${thStyle}">Score</th><th style="${thStyle}">Open Items</th><th style="${thStyle}">Share of Org-Wide Total</th></tr>
            ${priorityRows}
          </table>
        </td></tr>` : ""}

        ${quickWins.length ? `
        <tr><td style="padding:0 32px;">
          ${sectionHeading("Quick-Win Opportunities")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><th style="${thStyle}">Department</th><th style="${thStyle}">Movement If Closed</th><th style="${thStyle}">Remaining Items</th></tr>
            ${quickWinRows}
          </table>
        </td></tr>` : ""}

        <tr><td style="padding:0 32px;">
          ${sectionHeading("Risk vs. Reward — by Department")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><th style="${thStyle}">Department</th><th style="${thStyle}">⚠ Risk — current exposure</th><th style="${thStyle}">✅ Reward — if gaps close</th></tr>
            ${riskRewardTableRows}
          </table>
        </td></tr>

        ${regulatoryExposure.length ? `
        <tr><td style="padding:0 32px;">
          ${sectionHeading("Regulatory Exposure Summary")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><th style="${thStyle}">Framework</th><th style="${thStyle}">Provision</th><th style="${thStyle}">Requirement</th><th style="${thStyle}">Penalty / Fine</th></tr>
            ${referenceTableRows}
          </table>
          <div style="font-family:${SANS};font-size:11px;color:${TEXT_FAINT};margin-top:10px;line-height:1.5;">
            ${regulatoryExposureSource === "ai"
              ? "Each row was mapped from your actual open self-assessment items by AI, grounded against a checked-in index of official provisions — the provision id shown is never invented. Follow \"Official source\" to verify yourself."
              : "AI mapping was not available for this report, so this table falls back to a static, department-bucket-matched reference (not specific to your actual gaps). Penalty figures are commonly-cited public maxima, provided for awareness only — not legal advice."}
          </div>
        </td></tr>` : ""}

        <tr><td style="padding:0 32px;">
          ${sectionHeading("Basis of Assessment & Data Quality Notes")}
          ${bulletList(dataQualityNotes.map(n => n.text))}
        </td></tr>

        <tr><td style="padding:0 32px;">
          ${sectionHeading("Recommended Remediation Roadmap")}
          <div style="font-weight:700;font-family:${SANS};font-size:12.5px;color:${INK};margin-bottom:4px;">Phase 1 — ${esc(roadmap.phase1.label)}</div>
          ${bulletList(roadmap.phase1.actions)}
          ${roadmap.phase2.actions.length ? `<div style="font-weight:700;font-family:${SANS};font-size:12.5px;color:${INK};margin:14px 0 4px;">Phase 2 — ${esc(roadmap.phase2.label)}</div>${bulletList(roadmap.phase2.actions)}` : ""}
          <div style="font-weight:700;font-family:${SANS};font-size:12.5px;color:${INK};margin:14px 0 4px;">Phase 3 — ${esc(roadmap.phase3.label)}</div>
          ${bulletList(roadmap.phase3.actions)}
        </td></tr>

        <tr><td style="height:28px;line-height:28px;font-size:1px;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>`;

  const text = `Team Self-Assessment Report — ${companyName || "Company"}\n` +
    `${submissions.length} submissions across ${deptRows.length} departments. Overall score: ${overallScore !== null ? `${overallScore}%` : "—"} (${overallBand.label})\n` +
    (requestedByEmail ? `Requested by ${requestedByEmail}\n` : "") + `\n` +
    `Executive Summary:\n${executiveSummary.bullets.map(b => `- ${b}`).join("\n")}\n\n` +
    `Department Scorecard:\n` +
    deptRows.map(d => `${d.dept}: ${d.avgScore !== null ? `${d.avgScore}%` : "—"} (${d.contributors} contributor${d.contributors !== 1 ? "s" : ""}, ${d.gapCount} gaps, ${d.partialCount} partial)`).join("\n") +
    `\n\nRisk vs. Reward:\n` +
    riskRewardRows.map(r => `${r.dept}\n  Risk: ${r.riskText}\n  Reward: ${r.rewardText}`).join("\n");

  return { html, text };
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

  const riskRewardRows = buildRiskRewardRows(deptRows, regulatoryExposure);

  const executiveSummary = buildExecutiveSummary({
    deptRows, overallScore, priorityFocus, quickWins, regulatoryExposure,
    notAssessedCount: notAssessedDepts.length,
  });

  const { html, text } = buildSelfAssessmentReportHtml({
    companyName, submissions, deptRows, overallScore, executiveSummary, priorityFocus,
    quickWins, dataQualityNotes, roadmap, riskRewardRows, regulatoryExposure,
    regulatoryExposureSource, requestedByEmail,
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
