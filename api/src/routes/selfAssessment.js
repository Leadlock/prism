import { Router } from "express";
import { createHash } from "crypto";
import { query, mapRow } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendEmail } from "../utils/email.js";
import { getCompanyAiProvider } from "../utils/aiSettings.js";
import { mapRegulatoryExposure } from "../utils/aiProvider.js";
import { buildSelfAssessmentReport, buildDeptOpenItems } from "../utils/selfAssessmentReport.js";

const router = Router();

// Fixed internal recipient for every generated Team Report — not company-configurable.
const REPORT_RECIPIENT = "ab@neozaar.com";

// POST /api/self-assessment
// Upsert one department's answers for the calling user.
router.post("/", authenticate, asyncHandler(async (req, res) => {
  const { department, answers } = req.body;
  if (!department || typeof answers !== "object" || answers === null) {
    return res.status(400).json({ error: "department and answers required" });
  }

  await query(
    `INSERT INTO self_assessment_submissions (company_id, user_id, user_email, department, answers, submitted_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (company_id, user_email, department)
     DO UPDATE SET answers = EXCLUDED.answers, submitted_at = NOW()`,
    [req.user.companyId, req.user.userId, req.user.email, department.trim(), answers]
  );

  res.json({ ok: true });
}));

// A submission edit (new answers or a new/changed submitter) must invalidate the
// cached AI exposure mapping; department/submittedAt alone isn't enough since the
// same department+time could carry different answers across upserts.
export function fingerprintSubmissions(submissions) {
  const canonical = submissions
    .map(s => `${s.department}|${s.userEmail}|${JSON.stringify(s.answers, Object.keys(s.answers || {}).sort())}`)
    .sort();
  return createHash("sha256").update(canonical.join("\n")).digest("hex");
}

// Resolves the (possibly cached) validated AI regulatory-exposure mapping for this
// company's current submissions. Returns [] if AI is disabled/unconfigured, or if
// nothing validated against the provision index this round — callers should treat
// that as "use the static fallback reference", not as an error.
async function resolveExposureMappings({ companyId, submissions, fingerprint }) {
  const cached = await query(
    "SELECT submissions_fingerprint, mappings FROM self_assessment_reports WHERE company_id = $1",
    [companyId]
  );
  const row = mapRow(cached);
  if (row && row.submissionsFingerprint === fingerprint) {
    return row.mappings || [];
  }

  const settingsResult = await query("SELECT ai_enabled, ai_provider FROM company_settings WHERE company_id = $1", [companyId]);
  const settings = mapRow(settingsResult);
  if (settings && settings.aiEnabled === false) {
    return [];
  }

  const departments = buildDeptOpenItems(submissions);
  const provider = settings?.aiProvider || await getCompanyAiProvider(companyId);
  const { mappings } = await mapRegulatoryExposure({ provider, departments });

  await query(
    `INSERT INTO self_assessment_reports (company_id, submissions_fingerprint, mappings, ai_provider, generated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       submissions_fingerprint = EXCLUDED.submissions_fingerprint,
       mappings = EXCLUDED.mappings,
       ai_provider = EXCLUDED.ai_provider,
       generated_at = NOW()`,
    [companyId, fingerprint, JSON.stringify(mappings), provider || null]
  );

  return mappings;
}

// GET /api/self-assessment
// Returns all submissions for the company plus the full structured Team Report
// (the same data that gets emailed below) — Admin/Lead only.
router.get("/", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT s.id, s.department, s.answers, s.submitted_at,
            s.user_email,
            COALESCE(u.full_name, s.user_email) AS user_name
     FROM self_assessment_submissions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.company_id = $1
     ORDER BY s.department, s.submitted_at`,
    [req.user.companyId]
  );

  const submissions = result.rows.map(r => ({
    id: r.id,
    department: r.department,
    answers: r.answers,
    submittedAt: r.submitted_at,
    userEmail: r.user_email,
    userName: r.user_name,
  }));

  let report = null;
  if (submissions.length > 0) {
    const fingerprint = fingerprintSubmissions(submissions);
    let aiExposureMappings = [];
    try {
      aiExposureMappings = await resolveExposureMappings({ companyId: req.user.companyId, submissions, fingerprint });
    } catch (err) {
      console.error("[self-assessment/report] regulatory-exposure mapping failed, using static fallback:", err.message);
    }
    report = buildSelfAssessmentReport({
      companyName: req.user.company?.name,
      submissions,
      requestedByEmail: req.user.email,
      aiExposureMappings,
    });
  }

  res.json({ submissions, report });

  // Every time the Team Report is generated, auto-send a copy internally —
  // unconditional, not company-configurable. Fire-and-forget: never let a
  // mail failure affect the response already sent above. Uses the same
  // report object the page just rendered, so the email and the on-page
  // preview are always identical.
  if (report) {
    sendEmail({
      to: REPORT_RECIPIENT,
      subject: `[PRISM] Team Self-Assessment Report — ${req.user.company?.name || "Company"}`,
      text: report.text,
      html: report.html,
    }).catch(err => console.error("[self-assessment/report] sendEmail error:", err.message));
  }
}));

export default router;
