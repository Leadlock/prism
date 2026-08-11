import { Router } from "express";
import { mapRow, mapRows, query, getClient } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const VALID_RECURRENCE = ["weekly", "fortnightly", "monthly", "quarterly", "semi-annual", "annual", "none"];
const VALID_PRIORITIES = ["Critical", "High", "Medium", "Low"];

const router = Router();

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const { moduleId } = req.query;
  const values = [req.user.companyId];
  // Prefer company-specific rows over global templates; deduplicate by quest_id
  let sql = `SELECT DISTINCT ON (quest_id) *,
    CASE WHEN next_due_date IS NOT NULL AND next_due_date < NOW() THEN true ELSE false END AS is_overdue,
    COALESCE((
      SELECT COUNT(*)::INT FROM question_dependencies qd
      WHERE qd.company_id = $1 AND qd.quest_id = questions.quest_id
    ), 0) AS dependency_count,
    CASE WHEN EXISTS (
      SELECT 1 FROM question_dependencies qd
      WHERE qd.company_id = $1 AND qd.quest_id = questions.quest_id
        AND NOT EXISTS (
          SELECT 1 FROM assessments a
          WHERE a.quest_id = qd.depends_on_quest_id AND a.company_id = $1
            AND a.review_status = 'FINISHED'
        )
    ) THEN true ELSE false END AS blocked_by_deps,
    COALESCE((
      SELECT COUNT(*)::INT FROM question_dependencies qd
      WHERE qd.company_id = $1 AND qd.quest_id = questions.quest_id
        AND NOT EXISTS (
          SELECT 1 FROM assessments a
          WHERE a.quest_id = qd.depends_on_quest_id AND a.company_id = $1
            AND a.review_status = 'FINISHED'
        )
    ), 0) AS unmet_dep_count,
    (
      SELECT answer FROM assessments
      WHERE quest_id = questions.quest_id AND company_id = $1
        AND review_status = 'FINISHED'
      ORDER BY created_at DESC LIMIT 1
    ) AS latest_answer,
    (
      SELECT comments FROM assessments
      WHERE quest_id = questions.quest_id AND company_id = $1
      ORDER BY created_at DESC LIMIT 1
    ) AS latest_comments,
    (
      SELECT reviewer_notes FROM assessments
      WHERE quest_id = questions.quest_id AND company_id = $1
      ORDER BY created_at DESC LIMIT 1
    ) AS latest_reviewer_notes
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

  const depsResult = await query(
    `WITH q_info AS (
       SELECT DISTINCT ON (quest_id) quest_id, control_area, module_id
       FROM questions
       WHERE (company_id = $1 OR company_id IS NULL)
       ORDER BY quest_id ASC, company_id ASC NULLS LAST
     )
     SELECT
       qd.depends_on_quest_id AS dep_quest_id,
       qi.control_area,
       qi.module_id,
       a.answer AS latest_answer,
       a.review_status AS latest_review_status
     FROM question_dependencies qd
     LEFT JOIN q_info qi ON qi.quest_id = qd.depends_on_quest_id
     LEFT JOIN LATERAL (
       SELECT answer, review_status FROM assessments
       WHERE quest_id = qd.depends_on_quest_id AND company_id = $1
         AND review_status = 'FINISHED'
       ORDER BY created_at DESC LIMIT 1
     ) a ON TRUE
     WHERE qd.company_id = $1 AND qd.quest_id = $2
     ORDER BY qd.depends_on_quest_id ASC`,
    [req.user.companyId, req.params.questId]
  );
  question.dependencies = depsResult.rows.map(row => ({
    questId: row.dep_quest_id,
    controlArea: row.control_area,
    moduleId: row.module_id,
    latestAnswer: row.latest_answer,
    latestReviewStatus: row.latest_review_status,
  }));

  res.json(question);
}));

// PUT /api/questions/:questId - update question fields (priority, dueDate)
router.put("/:questId", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { priority, dueDate } = req.body;

  if (priority === undefined && dueDate === undefined) {
    return res.status(400).json({ error: "No updatable fields provided" });
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` });
  }

  let questionResult = await query(
    "SELECT id FROM questions WHERE quest_id = $1 AND company_id = $2",
    [req.params.questId, req.user.companyId]
  );

  let targetCompanyId = req.user.companyId;

  if (questionResult.rows.length === 0) {
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
  if (priority !== undefined) {
    sets.push(`priority = $${idx++}`);
    values.push(priority);
  }
  if (dueDate !== undefined) {
    sets.push(`due_date = $${idx++}`);
    values.push(dueDate || null);
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

// Detect if adding questId -> newDependsOnIds would create a cycle.
// Traverses the existing dep graph (excluding questId's current outgoing edges,
// which will be replaced) from each proposed dep to see if questId is reachable.
async function detectCycle(companyId, questId, newDependsOnIds) {
  if (newDependsOnIds.length === 0) return false;
  const result = await query(
    `WITH RECURSIVE reachable AS (
       SELECT unnest($2::text[]) AS q
       UNION
       SELECT qd.depends_on_quest_id
       FROM question_dependencies qd
       INNER JOIN reachable r ON r.q = qd.quest_id
       WHERE qd.company_id = $1 AND qd.quest_id != $3
     )
     SELECT 1 FROM reachable WHERE q = $3 LIMIT 1`,
    [companyId, newDependsOnIds, questId]
  );
  return result.rows.length > 0;
}

// GET /api/questions/:questId/dependencies
router.get("/:questId/dependencies", authenticate, asyncHandler(async (req, res) => {
  const { questId } = req.params;
  const companyId = req.user.companyId;

  const result = await query(
    `WITH q_info AS (
       SELECT DISTINCT ON (quest_id) quest_id, control_area, module_id
       FROM questions
       WHERE (company_id = $1 OR company_id IS NULL)
       ORDER BY quest_id ASC, company_id ASC NULLS LAST
     )
     SELECT
       qd.depends_on_quest_id AS dep_quest_id,
       qi.control_area,
       qi.module_id,
       a.answer AS latest_answer,
       a.review_status AS latest_review_status
     FROM question_dependencies qd
     LEFT JOIN q_info qi ON qi.quest_id = qd.depends_on_quest_id
     LEFT JOIN LATERAL (
       SELECT answer, review_status FROM assessments
       WHERE quest_id = qd.depends_on_quest_id AND company_id = $1
         AND review_status = 'FINISHED'
       ORDER BY created_at DESC LIMIT 1
     ) a ON TRUE
     WHERE qd.company_id = $1 AND qd.quest_id = $2
     ORDER BY qd.depends_on_quest_id ASC`,
    [companyId, questId]
  );

  res.json(result.rows.map(row => ({
    questId: row.dep_quest_id,
    controlArea: row.control_area,
    moduleId: row.module_id,
    latestAnswer: row.latest_answer,
    latestReviewStatus: row.latest_review_status,
  })));
}));

// PUT /api/questions/:questId/dependencies — replace all deps for a question (ADMIN/LEAD)
router.put("/:questId/dependencies", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { questId } = req.params;
  const { dependsOn = [] } = req.body;
  const companyId = req.user.companyId;

  if (!Array.isArray(dependsOn)) {
    return res.status(400).json({ error: "dependsOn must be an array of quest IDs" });
  }

  const uniqueDeps = [...new Set(dependsOn)];

  if (uniqueDeps.includes(questId)) {
    return res.status(400).json({ error: "A question cannot depend on itself" });
  }

  const questExists = await query(
    "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
    [questId, companyId]
  );
  if (questExists.rows.length === 0) {
    return res.status(404).json({ error: "Question not found" });
  }

  for (const depId of uniqueDeps) {
    const depExists = await query(
      "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
      [depId, companyId]
    );
    if (depExists.rows.length === 0) {
      return res.status(400).json({ error: `Dependency question not found: ${depId}` });
    }
  }

  if (await detectCycle(companyId, questId, uniqueDeps)) {
    return res.status(400).json({ error: "Circular dependency detected: the requested dependencies would create a cycle" });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM question_dependencies WHERE company_id = $1 AND quest_id = $2",
      [companyId, questId]
    );
    for (const depId of uniqueDeps) {
      await client.query(
        "INSERT INTO question_dependencies (company_id, quest_id, depends_on_quest_id) VALUES ($1, $2, $3)",
        [companyId, questId, depId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ questId, dependsOn: uniqueDeps });
}));

export default router;
