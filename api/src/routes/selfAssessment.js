import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

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

  res.json(result.rows.map(r => ({
    id: r.id,
    department: r.department,
    answers: r.answers,
    submittedAt: r.submitted_at,
    userEmail: r.user_email,
    userName: r.user_name,
  })));
}));

export default router;
