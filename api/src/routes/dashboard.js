import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = Router();

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "VIEWER", "AUDITOR"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "dashboard", ip: req.ip });
  }
  const cid = req.user.companyId;
  const { month } = req.query;
  const monthCondition = month ? "AND month = $2" : "";
  const monthParams = month ? [cid, month] : [cid];

  const [totalQ, assessed, finished, answerDist, moduleCompletion, evidenceCoverage, actionStatus, maturityDist, overdueQuestions] = await Promise.all([
    query("SELECT COUNT(*) AS n FROM questions WHERE company_id = $1", [cid]),
    query(`SELECT COUNT(DISTINCT quest_id) AS n FROM assessments WHERE company_id = $1 ${monthCondition}`, monthParams),
    query(month ? `
      SELECT COUNT(*) AS n FROM (
        SELECT DISTINCT quest_id FROM assessments
        WHERE company_id = $1 AND review_status = 'FINISHED' AND month = $2
        UNION
        SELECT q.quest_id
        FROM questions q
        JOIN LATERAL (
          SELECT month FROM assessments
          WHERE quest_id = q.quest_id AND company_id = $1
            AND review_status = 'FINISHED' AND month < $2
          ORDER BY month DESC LIMIT 1
        ) latest ON true
        WHERE q.company_id = $1
          AND q.recurrence_interval IN ('quarterly', 'semi-annual', 'annual')
          AND NOT EXISTS (
            SELECT 1 FROM assessments
            WHERE quest_id = q.quest_id AND company_id = $1 AND month = $2
          )
          AND (
            (q.next_due_date IS NOT NULL AND q.next_due_date >= ($2 || '-01')::date)
            OR (q.next_due_date IS NULL AND (
              CASE q.recurrence_interval
                WHEN 'quarterly'   THEN (EXTRACT(YEAR  FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))*12 + EXTRACT(MONTH FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))) < 3
                WHEN 'semi-annual' THEN (EXTRACT(YEAR  FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))*12 + EXTRACT(MONTH FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))) < 6
                WHEN 'annual'      THEN (EXTRACT(YEAR  FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))*12 + EXTRACT(MONTH FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))) < 12
                ELSE FALSE
              END
            ))
          )
      ) AS eff
    ` : `SELECT COUNT(DISTINCT quest_id) AS n FROM assessments WHERE company_id = $1 AND review_status = 'FINISHED'`, monthParams),
    query(`SELECT answer, COUNT(*) AS n FROM assessments WHERE company_id = $1 ${monthCondition} GROUP BY answer`, monthParams),
    query(month ? `
      WITH carried AS (
        SELECT q.module_id, q.quest_id
        FROM questions q
        JOIN LATERAL (
          SELECT month FROM assessments
          WHERE quest_id = q.quest_id AND company_id = $1
            AND review_status = 'FINISHED' AND month < $2
          ORDER BY month DESC LIMIT 1
        ) latest ON true
        WHERE q.company_id = $1
          AND q.recurrence_interval IN ('quarterly', 'semi-annual', 'annual')
          AND NOT EXISTS (
            SELECT 1 FROM assessments
            WHERE quest_id = q.quest_id AND company_id = $1 AND month = $2
          )
          AND (
            (q.next_due_date IS NOT NULL AND q.next_due_date >= ($2 || '-01')::date)
            OR (q.next_due_date IS NULL AND (
              CASE q.recurrence_interval
                WHEN 'quarterly'   THEN (EXTRACT(YEAR  FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))*12 + EXTRACT(MONTH FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))) < 3
                WHEN 'semi-annual' THEN (EXTRACT(YEAR  FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))*12 + EXTRACT(MONTH FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))) < 6
                WHEN 'annual'      THEN (EXTRACT(YEAR  FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))*12 + EXTRACT(MONTH FROM AGE(($2||'-01')::date,(latest.month||'-01')::date))) < 12
                ELSE FALSE
              END
            ))
          )
      )
      SELECT m.module_id, m.name, m.total_quests,
        (COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status = 'FINISHED')
         + COUNT(DISTINCT c.quest_id)) AS finished,
        COUNT(DISTINCT a.quest_id) AS assessed
      FROM modules m
      LEFT JOIN assessments a ON a.module_id = m.module_id AND a.company_id = $1 AND a.month = $2
      LEFT JOIN carried c ON c.module_id = m.module_id
      WHERE (m.company_id = $1 OR m.company_id IS NULL)
      GROUP BY m.module_id, m.name, m.total_quests, m.sort_order
      ORDER BY m.sort_order ASC, m.module_id ASC
    ` : `
      SELECT m.module_id, m.name, m.total_quests,
        COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status = 'FINISHED') AS finished,
        COUNT(DISTINCT a.quest_id) AS assessed
      FROM modules m
      LEFT JOIN assessments a ON a.module_id = m.module_id AND a.company_id = $1
      WHERE (m.company_id = $1 OR m.company_id IS NULL)
      GROUP BY m.module_id, m.name, m.total_quests, m.sort_order
      ORDER BY m.sort_order ASC, m.module_id ASC
    `, monthParams),
    query(`
      SELECT q.module_id,
        COUNT(DISTINCT e.quest_id) AS covered,
        COUNT(DISTINCT q.quest_id) AS total
      FROM questions q
      LEFT JOIN evidence e ON e.quest_id = q.quest_id AND e.company_id = $1 ${month ? 'AND e.month = $2' : ''}
      WHERE q.company_id = $1
      GROUP BY q.module_id
      ORDER BY q.module_id
    `, monthParams),
    query(`SELECT COALESCE(UPPER(status), 'OPEN') AS status, COUNT(*) AS n FROM actions WHERE company_id = $1 GROUP BY COALESCE(UPPER(status), 'OPEN')`, [cid]),
    query(`
      SELECT
        COUNT(*) FILTER (WHERE current_level = 1) AS l1,
        COUNT(*) FILTER (WHERE current_level = 2) AS l2,
        COUNT(*) FILTER (WHERE current_level = 3) AS l3,
        COUNT(*) FILTER (WHERE current_level = 4) AS l4,
        COUNT(*) FILTER (WHERE current_level = 5) AS l5
      FROM assessments
      WHERE company_id = $1 ${monthCondition}
    `, monthParams),
    query(`SELECT COUNT(*) AS n FROM questions WHERE company_id = $1 AND next_due_date IS NOT NULL AND next_due_date < NOW()`, [cid])
  ]);

  res.json({
    overall: {
      total: parseInt(totalQ.rows[0].n),
      assessed: parseInt(assessed.rows[0].n),
      finished: parseInt(finished.rows[0].n)
    },
    answerDistribution: answerDist.rows.map(r => ({ answer: r.answer || "WIP", count: parseInt(r.n) })),
    moduleCompletion: moduleCompletion.rows.map(r => ({
      moduleId: r.module_id,
      name: r.name,
      total: parseInt(r.total_quests) || 0,
      assessed: parseInt(r.assessed),
      finished: parseInt(r.finished)
    })),
    evidenceCoverage: evidenceCoverage.rows.map(r => ({
      moduleId: r.module_id,
      covered: parseInt(r.covered),
      total: parseInt(r.total)
    })),
    actionStatus: actionStatus.rows.map(r => ({ status: r.status || "OPEN", count: parseInt(r.n) })),
    maturityDistribution: {
      l1: parseInt(maturityDist.rows[0]?.l1) || 0,
      l2: parseInt(maturityDist.rows[0]?.l2) || 0,
      l3: parseInt(maturityDist.rows[0]?.l3) || 0,
      l4: parseInt(maturityDist.rows[0]?.l4) || 0,
      l5: parseInt(maturityDist.rows[0]?.l5) || 0,
    },
    overdueQuestions: parseInt(overdueQuestions.rows[0].n) || 0
  });
}));

export default router;
