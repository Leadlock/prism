import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendEmail } from "../utils/email.js";
import { buildSelfAssessmentReport } from "../utils/selfAssessmentReport.js";

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

// GET /api/self-assessment
// Returns all submissions for the company.  Admin/Lead only.
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

  const report = submissions.length > 0
    ? buildSelfAssessmentReport({ companyName: req.user.company?.name, submissions, requestedByEmail: req.user.email })
    : null;

  res.json({
    submissions,
    report: report ? {
      overallScore: report.overallScore,
      deptRows: report.deptRows,
      riskRewardRows: report.riskRewardRows,
      complianceReference: report.complianceReference,
      requestedByEmail: req.user.email,
    } : null,
  });

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
