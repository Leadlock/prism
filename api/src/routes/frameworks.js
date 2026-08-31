import { Router } from "express";
import { query, mapRow, mapRows, getClient } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deriveSortOrder } from "../utils/prismOrder.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Given a list of questions that belong to a framework, insert them into the
 * company's question set — deduplicating by (module_id, control_area,
 * baseline_question) fingerprint — and then insert question_framework_controls
 * rows mapping each question to the framework control.
 *
 * Returns { questionsInserted, mappingsInserted }.
 */
export async function importFrameworkQuestions(client, { companyId, frameworkKey, modules, questions }) {
  let questionsInserted = 0;
  let mappingsInserted = 0;

  // Insert modules first (idempotent)
  for (const mod of modules) {
    const sortOrder = deriveSortOrder(mod.module_id);
    await client.query(
      `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order, framework_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id, module_id) DO UPDATE SET framework_key = EXCLUDED.framework_key`,
      [mod.module_id, companyId, mod.name, mod.primary_owner || null, mod.frequency || null,
       mod.total_quests || 0, mod.purpose || null, sortOrder, frameworkKey]
    );
  }

  for (const q of questions) {
    // Deduplication fingerprint: same module + control area + question text
    const fingerprint = {
      moduleId: q.module_id,
      controlArea: (q.control_area || "").trim().toLowerCase(),
      baselineQuestion: (q.baseline_question || "").trim().toLowerCase(),
    };

    // Check if an equivalent question already exists for this company
    const existing = await client.query(
      `SELECT quest_id FROM questions
       WHERE company_id = $1
         AND module_id = $2
         AND LOWER(TRIM(COALESCE(control_area, ''))) = $3
         AND LOWER(TRIM(COALESCE(baseline_question, ''))) = $4
       LIMIT 1`,
      [companyId, fingerprint.moduleId, fingerprint.controlArea, fingerprint.baselineQuestion]
    );

    let questId = existing.rows[0]?.quest_id ?? null;

    if (!questId) {
      // New question — insert it
      const ins = await client.query(
        `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
           iso_reference, baseline_question, level3_yes_criteria, required_evidence,
           default_owner, frequency, priority, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (company_id, quest_id) DO NOTHING
         RETURNING quest_id`,
        [q.quest_id, companyId, q.module_id, q.module_name || null, q.control_area || null,
         q.iso_reference || null, q.baseline_question || null, q.level3_yes_criteria || null,
         q.required_evidence || null, q.default_owner || null, q.frequency || null,
         (["Critical", "High", "Medium", "Low"].includes(q.priority) ? q.priority : "Medium"),
         q.tags || null]
      );
      if (ins.rows.length > 0) {
        questId = ins.rows[0].quest_id;
        questionsInserted++;
      } else {
        // Conflict on quest_id — use the existing one
        questId = q.quest_id;
      }
    }

    if (!questId) continue;

    // Insert framework control mapping (idempotent)
    const controlRef = q.iso_reference || q.control_reference || null;
    if (controlRef) {
      const mapIns = await client.query(
        `INSERT INTO question_framework_controls (company_id, quest_id, framework_key, control_reference)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, quest_id, framework_key, control_reference) DO NOTHING
         RETURNING id`,
        [companyId, questId, frameworkKey, controlRef]
      );
      if (mapIns.rows.length > 0) mappingsInserted++;
    }
  }

  return { questionsInserted, mappingsInserted };
}

// ─── Routes ────────────────────────────────────────────────────────────────────

// GET /api/frameworks
// List the catalog of all supported frameworks.
router.get("/", asyncHandler(async (req, res) => {
  const result = await query("SELECT key, name, description FROM frameworks ORDER BY name ASC");
  res.json(result.rows);
}));

// GET /api/frameworks/mine
// Frameworks currently active for the authenticated company, with question counts.
router.get("/mine", authenticate, asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const result = await query(
    `SELECT f.key, f.name, f.description, cf.activated_at,
       (SELECT COUNT(DISTINCT qfc.quest_id)
        FROM question_framework_controls qfc
        WHERE qfc.company_id = $1 AND qfc.framework_key = f.key) AS question_count,
       (SELECT COUNT(DISTINCT a.quest_id)
        FROM question_framework_controls qfc
        JOIN assessments a ON a.quest_id = qfc.quest_id AND a.company_id = $1 AND a.review_status = 'FINISHED'
        WHERE qfc.company_id = $1 AND qfc.framework_key = f.key) AS answered_count
     FROM company_frameworks cf
     JOIN frameworks f ON f.key = cf.framework_key
     WHERE cf.company_id = $1
     ORDER BY cf.activated_at ASC`,
    [cid]
  );
  res.json(result.rows.map(r => ({
    key: r.key,
    name: r.name,
    description: r.description,
    activatedAt: r.activated_at,
    questionCount: parseInt(r.question_count) || 0,
    answeredCount: parseInt(r.answered_count) || 0,
  })));
}));

// POST /api/frameworks/mine
// Activate a framework for the company.
// Body: { frameworkKey, modules?, questions? }
//   - If modules/questions are supplied they are imported with deduplication.
//   - If omitted the framework is activated without importing questions (useful
//     for frameworks whose questions are already present via a template).
router.post("/mine", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { frameworkKey, modules = [], questions = [] } = req.body;

  if (!frameworkKey) return res.status(400).json({ error: "frameworkKey is required" });

  // Verify framework exists in catalog
  const fwCheck = await query("SELECT key FROM frameworks WHERE key = $1", [frameworkKey]);
  if (fwCheck.rows.length === 0) {
    return res.status(400).json({ error: `Unknown framework: ${frameworkKey}` });
  }

  // Activate in company_frameworks (idempotent)
  await query(
    `INSERT INTO company_frameworks (company_id, framework_key)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [cid, frameworkKey]
  );

  let questionsInserted = 0;
  let mappingsInserted = 0;

  if (questions.length > 0) {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const counts = await importFrameworkQuestions(client, { companyId: cid, frameworkKey, modules, questions });
      questionsInserted = counts.questionsInserted;
      mappingsInserted = counts.mappingsInserted;
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  res.status(201).json({ frameworkKey, questionsInserted, mappingsInserted });
}));

// DELETE /api/frameworks/mine/:key
// Deactivate a framework for the company.
// Questions and their answers are NOT deleted — they remain in the question set.
// Only the company_frameworks row and question_framework_controls mappings are removed.
router.delete("/mine/:key", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { key } = req.params;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM question_framework_controls WHERE company_id = $1 AND framework_key = $2",
      [cid, key]
    );
    await client.query(
      "DELETE FROM company_frameworks WHERE company_id = $1 AND framework_key = $2",
      [cid, key]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.status(204).send();
}));

// GET /api/frameworks/:key/questions
// Questions mapped to a specific framework for the authenticated company,
// with their latest assessment answer and evidence coverage status.
router.get("/:key/questions", authenticate, asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { key } = req.params;

  // Check the company has this framework active
  const cfCheck = await query(
    "SELECT 1 FROM company_frameworks WHERE company_id = $1 AND framework_key = $2",
    [cid, key]
  );
  if (cfCheck.rows.length === 0) {
    return res.status(404).json({ error: "Framework not active for this company" });
  }

  const result = await query(
    `SELECT DISTINCT ON (q.quest_id)
       q.*,
       qfc.control_reference,
       CASE WHEN q.next_due_date IS NOT NULL AND q.next_due_date < NOW() THEN true ELSE false END AS is_overdue,
       (SELECT answer FROM assessments
        WHERE quest_id = q.quest_id AND company_id = $1 AND review_status = 'FINISHED'
        ORDER BY created_at DESC LIMIT 1) AS latest_answer,
       EXISTS (
         SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1
       ) AS has_evidence
     FROM question_framework_controls qfc
     JOIN questions q ON q.quest_id = qfc.quest_id AND q.company_id = $1
     WHERE qfc.company_id = $1 AND qfc.framework_key = $2
     ORDER BY q.quest_id ASC, q.company_id ASC NULLS LAST`,
    [cid, key]
  );

  res.json(mapRows(result));
}));

// GET /api/frameworks/:key/dashboard
// Per-framework dashboard: completion by control area, answer distribution,
// evidence coverage, and overall score for this framework only.
router.get("/:key/dashboard", authenticate, asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { key } = req.params;

  const cfCheck = await query(
    "SELECT 1 FROM company_frameworks WHERE company_id = $1 AND framework_key = $2",
    [cid, key]
  );
  if (cfCheck.rows.length === 0) {
    return res.status(404).json({ error: "Framework not active for this company" });
  }

  const [controlAreas, answerDist, evidenceCoverage, totalFinished] = await Promise.all([
    // Per-control-area completion
    query(
      `SELECT
         COALESCE(q.control_area, 'Uncategorised') AS control_area,
         qfc.control_reference,
         COUNT(DISTINCT q.quest_id) AS total,
         COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status = 'FINISHED') AS finished,
         COUNT(DISTINCT a.quest_id) AS assessed
       FROM question_framework_controls qfc
       JOIN questions q ON q.quest_id = qfc.quest_id AND q.company_id = $1
       LEFT JOIN assessments a ON a.quest_id = q.quest_id AND a.company_id = $1
       WHERE qfc.company_id = $1 AND qfc.framework_key = $2
       GROUP BY COALESCE(q.control_area, 'Uncategorised'), qfc.control_reference
       ORDER BY control_area ASC`,
      [cid, key]
    ),

    // Answer distribution within this framework
    query(
      `SELECT a.answer, COUNT(DISTINCT a.quest_id) AS n
       FROM assessments a
       JOIN question_framework_controls qfc ON qfc.quest_id = a.quest_id AND qfc.company_id = $1 AND qfc.framework_key = $2
       WHERE a.company_id = $1
       GROUP BY a.answer`,
      [cid, key]
    ),

    // Evidence coverage within this framework
    query(
      `SELECT
         COUNT(DISTINCT q.quest_id) FILTER (WHERE (
           EXISTS (SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1)
           OR EXISTS (SELECT 1 FROM evidence e WHERE e.quest_id = q.quest_id AND e.company_id = $1)
         )) AS covered,
         COUNT(DISTINCT q.quest_id) AS total
       FROM question_framework_controls qfc
       JOIN questions q ON q.quest_id = qfc.quest_id AND q.company_id = $1
       WHERE qfc.company_id = $1 AND qfc.framework_key = $2`,
      [cid, key]
    ),

    // Total and finished for overall score
    query(
      `SELECT
         COUNT(DISTINCT q.quest_id) AS total,
         COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status = 'FINISHED') AS finished
       FROM question_framework_controls qfc
       JOIN questions q ON q.quest_id = qfc.quest_id AND q.company_id = $1
       LEFT JOIN assessments a ON a.quest_id = q.quest_id AND a.company_id = $1
       WHERE qfc.company_id = $1 AND qfc.framework_key = $2`,
      [cid, key]
    ),
  ]);

  const total = parseInt(totalFinished.rows[0]?.total) || 0;
  const finished = parseInt(totalFinished.rows[0]?.finished) || 0;

  res.json({
    frameworkKey: key,
    overall: {
      total,
      finished,
      completionPct: total > 0 ? Math.round((finished / total) * 100) : 0,
    },
    controlAreas: controlAreas.rows.map(r => ({
      controlArea: r.control_area,
      controlReference: r.control_reference,
      total: parseInt(r.total),
      finished: parseInt(r.finished),
      assessed: parseInt(r.assessed),
    })),
    answerDistribution: answerDist.rows.map(r => ({
      answer: r.answer || "WIP",
      count: parseInt(r.n),
    })),
    evidenceCoverage: {
      covered: parseInt(evidenceCoverage.rows[0]?.covered) || 0,
      total: parseInt(evidenceCoverage.rows[0]?.total) || 0,
    },
  });
}));

export default router;
