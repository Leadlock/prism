import { Router } from "express";
import { mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const VALID_RECURRENCE = ["weekly", "fortnightly", "monthly", "quarterly", "semi-annual", "annual", "none"];

const router = Router();

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const { moduleId } = req.query;
  const values = [req.user.companyId];
  // Prefer company-specific rows over global templates; deduplicate by quest_id
  let sql = `SELECT DISTINCT ON (quest_id) *,
    CASE WHEN next_due_date IS NOT NULL AND next_due_date < NOW() THEN true ELSE false END AS is_overdue
    FROM questions WHERE (company_id = $1 OR company_id IS NULL)`;

  if (moduleId) {
    values.push(moduleId);
    sql += ` AND module_id = $${values.length}`;
  }

  sql += " ORDER BY quest_id ASC, company_id ASC NULLS LAST";
  const result = await query(sql, values);
  res.json(mapRows(result));
}));

router.get("/:questId", authenticate, asyncHandler(async (req, res) => {
  const questionResult = await query(
    "SELECT * FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL)",
    [req.params.questId, req.user.companyId]
  );
  const question = mapRow(questionResult);
  if (!question) {
    return res.status(404).json({ error: "Question not found" });
  }

  const [assessmentsResult, actionsResult, evidenceResult] = await Promise.all([
    query(
      "SELECT * FROM assessments WHERE quest_id = $1 AND company_id = $2 ORDER BY created_at DESC",
      [req.params.questId, req.user.companyId]
    ),
    query(
      "SELECT * FROM actions WHERE quest_id = $1 AND company_id = $2 ORDER BY created_at DESC",
      [req.params.questId, req.user.companyId]
    ),
    query(
      "SELECT * FROM evidence WHERE quest_id = $1 AND company_id = $2 ORDER BY created_at DESC",
      [req.params.questId, req.user.companyId]
    )
  ]);

  question.assessments = mapRows(assessmentsResult);
  question.actions = mapRows(actionsResult);
  question.evidence = mapRows(evidenceResult);

  res.json(question);
}));

// PUT /api/questions/:questId/recurrence - update recurrence settings for a question
router.put("/:questId/recurrence", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { recurrenceInterval, nextDueDate } = req.body;

  if (recurrenceInterval && !VALID_RECURRENCE.includes(recurrenceInterval)) {
    return res.status(400).json({ error: `recurrenceInterval must be one of: ${VALID_RECURRENCE.join(", ")}` });
  }

  // Check if a company-specific copy exists; if not, check global
  let questionResult = await query(
    "SELECT id FROM questions WHERE quest_id = $1 AND company_id = $2",
    [req.params.questId, req.user.companyId]
  );

  let targetCompanyId = req.user.companyId;

  if (questionResult.rows.length === 0) {
    // Fall back to the global question (company_id IS NULL)
    questionResult = await query(
      "SELECT id FROM questions WHERE quest_id = $1 AND company_id IS NULL",
      [req.params.questId]
    );
    if (questionResult.rows.length === 0) {
      return res.status(404).json({ error: "Question not found" });
    }
    targetCompanyId = null;
  }

  const sets = [];
  const values = [];
  let idx = 1;

  if (recurrenceInterval !== undefined) {
    sets.push(`recurrence_interval = $${idx++}`);
    values.push(recurrenceInterval);
  }
  if (nextDueDate !== undefined) {
    sets.push(`next_due_date = $${idx++}`);
    values.push(nextDueDate || null);
  }
  sets.push("updated_at = NOW()");

  values.push(req.params.questId);
  let whereClause;
  if (targetCompanyId === null) {
    whereClause = `quest_id = $${idx++} AND company_id IS NULL`;
  } else {
    whereClause = `quest_id = $${idx++} AND company_id = $${idx}`;
    values.push(targetCompanyId);
  }

  const result = await query(
    `UPDATE questions SET ${sets.join(", ")} WHERE ${whereClause} RETURNING *`,
    values
  );
  res.json(mapRow(result));
}));

export default router;
