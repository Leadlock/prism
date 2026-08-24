// Builds the HTML for the auto-emailed self-assessment "Team Report".
// Score math intentionally mirrors web/src/utils/deptSelfAssessQuestions.js
// (YES=1, PARTIAL=0.5, NO=0, NA excluded) so the numbers here match what
// admins see in the in-app Team Report.

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
const SKY = "#0EA5E9";
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

function scoreLabel(pct) {
  return scoreBand(pct).label;
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

// Static regulatory/standard reference rows. Figures are commonly-cited
// public maxima as of authoring time — included for awareness, not as a
// substitute for legal advice.
const COMPLIANCE_REFERENCE = [
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

// submissions: [{ department, answers, userEmail, userName, submittedAt }]
export function buildSelfAssessmentReport({ companyName, submissions, requestedByEmail }) {
  const byDept = {};
  for (const s of submissions) {
    (byDept[s.department] ||= []).push(s);
  }

  const deptRows = Object.entries(byDept).map(([dept, subs]) => {
    const scores = subs.map(s => scoreSubmission(s.answers)).filter(v => v !== null);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    const answeredIds = new Set();
    for (const s of subs) for (const id of Object.keys(s.answers || {})) answeredIds.add(id);

    let gapCount = 0, partialCount = 0;
    for (const id of answeredIds) {
      const hasNo = subs.some(s => s.answers?.[id] === "NO");
      const hasPartial = subs.some(s => s.answers?.[id] === "PARTIAL");
      if (hasNo) gapCount++;
      else if (hasPartial) partialCount++;
    }

    return { dept, contributors: subs.length, avgScore, gapCount, partialCount };
  }).sort((a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101));

  const validScores = deptRows.map(d => d.avgScore).filter(v => v !== null);
  const overallScore = validScores.length ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null;

  const deptsWithGaps = new Set(deptRows.filter(d => d.gapCount > 0 || d.partialCount > 0).map(d => d.dept));

  const riskRewardRows = deptRows.map(d => {
    const applicableRefs = COMPLIANCE_REFERENCE.filter(r => r.relatedDepts.includes(d.dept));
    const hasGaps = d.gapCount + d.partialCount > 0;

    const gapParts = [];
    if (d.gapCount) gapParts.push(`${d.gapCount} unresolved gap${d.gapCount !== 1 ? "s" : ""}`);
    if (d.partialCount) gapParts.push(`${d.partialCount} partial control${d.partialCount !== 1 ? "s" : ""}`);
    const gapsSummary = gapParts.join(" and ");

    // Each reason spells out the causal chain: this department has open
    // gaps → those gaps sit in an area a real regulation covers (its
    // "summary" is the plain-English *why*) → here's the penalty that
    // creates. Not just a bare fact, so the reader can see the reasoning.
    let riskReasons = [];
    let riskText;
    if (!hasGaps) {
      riskText = "No material gaps identified — low exposure.";
    } else if (applicableRefs.length) {
      riskReasons = [...new Map(applicableRefs.map(r => [r.provision, r])).values()].map(r => ({
        framework: r.framework,
        provision: r.provision,
        why: r.summary,
        penalty: r.penalty,
      }));
      riskText = `${gapsSummary} in ${d.dept} fall within scope of ${riskReasons.map(r => `${r.framework} ${r.provision.split("—")[0].trim()}`).join("; ")} — penalty ${riskReasons.map(r => r.penalty).join("; ")}.`;
    } else {
      riskText = `${gapsSummary} identified, with no mapped regulatory reference for this department.`;
    }

    let rewardText;
    if (!hasGaps) {
      rewardText = "Already at low risk — maintain current controls.";
    } else {
      const frameworks = [...new Set(applicableRefs.map(r => r.framework))];
      const scoreNote = d.avgScore !== null ? `raise score from ${d.avgScore}% to up to 100%` : "establish a baseline score";
      rewardText = `Closing ${gapsSummary} would ${scoreNote}, avoid the exposure above${frameworks.length ? `, and strengthen ${frameworks.join(" / ")} readiness` : ""}.`;
    }

    return { dept: d.dept, hasGaps, gapsSummary, riskReasons, riskText, rewardText };
  });

  const rowStyle = "padding:10px 12px;border-bottom:1px solid " + BORDER + ";font-family:" + SANS + ";font-size:13px;color:" + INK + ";vertical-align:top;";
  const thStyle = `padding:9px 12px;background:${SURFACE_MUTED};border-bottom:2px solid ${BORDER};text-align:left;font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${TEXT_MUTED};`;

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

  // Only reference rows whose related department(s) actually have an
  // identified NO/PARTIAL answer — this section is meant to show exposure
  // that's real for this company, not every regulation in the abstract.
  // Each row also carries *which* department(s) triggered it and how many
  // gaps, so "why does this apply to us" has a concrete answer.
  const applicableReference = COMPLIANCE_REFERENCE.filter(row => row.relatedDepts.some(d => deptsWithGaps.has(d))).map(row => {
    const triggeredBy = deptRows
      .filter(d => row.relatedDepts.includes(d.dept) && (d.gapCount > 0 || d.partialCount > 0))
      .map(d => {
        const parts = [];
        if (d.gapCount) parts.push(`${d.gapCount} gap${d.gapCount !== 1 ? "s" : ""}`);
        if (d.partialCount) parts.push(`${d.partialCount} partial${d.partialCount !== 1 ? "s" : ""}`);
        return `${d.dept} (${parts.join(", ")})`;
      });
    return { ...row, triggeredBy };
  });

  const referenceTableRows = applicableReference.map((row, i) => `
    <tr>
      <td style="${rowStyle}background:${i % 2 ? SURFACE_MUTED : SURFACE};font-weight:700;width:17%;">${esc(row.framework)}</td>
      <td style="${rowStyle}background:${i % 2 ? SURFACE_MUTED : SURFACE};width:21%;">${esc(row.provision)}</td>
      <td style="${rowStyle}background:${i % 2 ? SURFACE_MUTED : SURFACE};color:${TEXT_MUTED};width:41%;">${esc(row.summary)}</td>
      <td style="${rowStyle}background:${i % 2 ? SURFACE_MUTED : SURFACE};font-weight:700;color:#B91C1C;width:21%;">${esc(row.penalty)}</td>
    </tr>
    <tr>
      <td colspan="4" style="padding:0 12px 10px;border-bottom:1px solid ${BORDER};background:${i % 2 ? SURFACE_MUTED : SURFACE};font-family:${SANS};font-size:11.5px;color:${VIOLET};">
        <strong>Why this applies to you:</strong> ${esc(row.triggeredBy.join("; "))} — self-assessed with open gaps in this exact area.
      </td>
    </tr>`).join("");

  const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  const sectionHeading = (label) => `
    <div style="margin:28px 0 12px;">
      <div style="font-family:${SERIF};font-size:16px;font-weight:700;color:${INK};">${label}</div>
      <div style="height:3px;width:40px;background:${SPECTRUM};border-radius:2px;margin-top:6px;"></div>
    </div>`;

  const overallBand = scoreBand(overallScore);

  const html = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};border-collapse:collapse;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:100%;background:${SURFACE};border-radius:14px;border-collapse:separate;overflow:hidden;">

        <!-- Banner -->
        <tr><td bgcolor="${INDIGO}" style="background:${INDIGO};background-image:${BANNER_GRADIENT};padding:26px 32px;">
          <div style="font-family:${SERIF};font-size:21px;font-weight:700;color:#FFFFFF;">Team Self-Assessment Report</div>
          <div style="font-family:${SANS};font-size:12px;color:rgba(255,255,255,0.82);margin-top:6px;">
            ${esc(companyName || "Company")} &nbsp;·&nbsp; ${submissions.length} submission${submissions.length !== 1 ? "s" : ""} across ${deptRows.length} department${deptRows.length !== 1 ? "s" : ""} &nbsp;·&nbsp; Generated ${esc(generatedAt)}${requestedByEmail ? ` &nbsp;·&nbsp; Requested by ${esc(requestedByEmail)}` : ""}
          </div>
        </td></tr>

        <!-- Overall score -->
        <tr><td style="padding:26px 32px 4px;">
          <div style="font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TEXT_MUTED};margin-bottom:8px;">Overall Compliance Score</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:${SERIF};font-size:38px;font-weight:700;color:${INK};line-height:1;">${overallScore !== null ? `${overallScore}%` : "—"}</td>
            <td align="right" style="vertical-align:bottom;padding-bottom:8px;">${pill(overallScore)}</td>
          </tr></table>
          <div style="margin-top:12px;">${meterBar(overallScore, { height: 10 })}</div>
        </td></tr>

        <!-- Department Scores -->
        <tr><td style="padding:0 32px;">
          ${sectionHeading("Department Scores")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <th style="${thStyle}">Department</th>
              <th style="${thStyle}">Contributors</th>
              <th style="${thStyle}">Score</th>
              <th style="${thStyle}">Status</th>
              <th style="${thStyle}">Gaps</th>
              <th style="${thStyle}">Partial</th>
            </tr>
            ${deptTableRows}
          </table>
        </td></tr>

        <!-- Risk vs Reward -->
        <tr><td style="padding:0 32px;">
          ${sectionHeading("Risk vs. Reward — by Department")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <th style="${thStyle}">Department</th>
              <th style="${thStyle}">⚠ Risk — current exposure</th>
              <th style="${thStyle}">✅ Reward — if gaps close</th>
            </tr>
            ${riskRewardTableRows}
          </table>
        </td></tr>

        ${applicableReference.length ? `
        <!-- Compliance Reference -->
        <tr><td style="padding:0 32px;">
          ${sectionHeading("Compliance & Regulatory Reference")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <th style="${thStyle}">Framework</th>
              <th style="${thStyle}">Provision</th>
              <th style="${thStyle}">Requirement</th>
              <th style="${thStyle}">Penalty / Fine</th>
            </tr>
            ${referenceTableRows}
          </table>
          <div style="font-family:${SANS};font-size:11px;color:${TEXT_FAINT};margin-top:10px;line-height:1.5;">
            Shown here only where a related department has at least one "No" or "Partial" self-assessment answer.
            Penalty figures are commonly-cited public maxima, provided for awareness only — not legal advice.
          </div>
        </td></tr>` : ""}

        <tr><td style="height:28px;line-height:28px;font-size:1px;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>`;

  const text = `Team Self-Assessment Report — ${companyName || "Company"}\n` +
    `${submissions.length} submissions across ${deptRows.length} departments. Overall score: ${overallScore !== null ? `${overallScore}%` : "—"}\n` +
    (requestedByEmail ? `Requested by ${requestedByEmail}\n` : "") + `\n` +
    deptRows.map(d => `${d.dept}: ${d.avgScore !== null ? `${d.avgScore}%` : "—"} (${d.contributors} contributor${d.contributors !== 1 ? "s" : ""}, ${d.gapCount} gaps, ${d.partialCount} partial)`).join("\n") +
    `\n\nRisk vs. Reward:\n` +
    riskRewardRows.map(r => `${r.dept}\n  Risk: ${r.riskText}\n  Reward: ${r.rewardText}`).join("\n");

  return {
    html,
    text,
    overallScore,
    deptRows,
    riskRewardRows,
    complianceReference: applicableReference.map(({ framework, provision, summary, penalty, triggeredBy }) => ({ framework, provision, summary, penalty, triggeredBy })),
  };
}
