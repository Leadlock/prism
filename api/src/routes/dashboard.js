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
  const { month, priority, tag } = req.query;
  const hasFilter = !!(priority || tag);

  // Step 1: Get filtered quest IDs when priority/tag filters are active
  let filteredQuestIds = null;
  if (hasFilter) {
    let filterSql = "SELECT quest_id FROM questions WHERE company_id = $1";
    const filterParams = [cid];
    let idx = 2;
    if (priority) {
      filterSql += ` AND priority = $${idx++}`;
      filterParams.push(priority);
    }
    if (tag) {
      filterSql += ` AND tags ILIKE '%' || $${idx++} || '%'`;
      filterParams.push(tag);
    }
    const filterResult = await query(filterSql, filterParams);
    filteredQuestIds = filterResult.rows.map(r => r.quest_id);

    if (filteredQuestIds.length === 0) {
      return res.json({
        overall: { total: 0, assessed: 0, finished: 0 },
        answerDistribution: [],
        moduleCompletion: [],
        evidenceCoverage: [],
        actionStatus: [],
        maturityDistribution: { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 },
        overdueQuestions: 0
      });
    }
  }

  // Build params helpers
  // For month queries: [cid, month, ...optionalQuestIds]
  // For non-month queries: [cid, ...optionalQuestIds]
  const monthParams = month ? [cid, month] : [cid];
  const assessParams = hasFilter ? [...monthParams, filteredQuestIds] : monthParams;
  const qfIdx = assessParams.length; // position of quest ids array param
  const questFilter = hasFilter ? `AND quest_id = ANY($${qfIdx})` : "";

  const cidParams = hasFilter ? [cid, filteredQuestIds] : [cid];
  const cidQf = hasFilter ? `AND quest_id = ANY($2)` : "";

  const monthCondition = month ? "AND month = $2" : "";

  const [totalQ, assessed, finished, answerDist, moduleCompletion, evidenceCoverage, actionStatus, maturityDist, overdueQuestions, notesCount, reviewerNotesCount, noNotesCount, openRequests, overdueRequests, completedRequests, requestsByUser, vaultTotalVersions, vaultUpdatedThisMonth, vaultLatestModified, scoreEligible] = await Promise.all([
    // Total questions (filtered by priority/tag)
    hasFilter
      ? query("SELECT $1::int AS n", [filteredQuestIds.length])
      : query("SELECT COUNT(*) AS n FROM questions WHERE company_id = $1", [cid]),

    // Assessed count
    query(
      `SELECT COUNT(DISTINCT quest_id) AS n FROM assessments WHERE company_id = $1 ${monthCondition} ${questFilter}`,
      assessParams
    ),

    // Finished count (simplified: skip carry-forward for filtered view to keep it reliable)
    query(
      month
        ? `SELECT COUNT(DISTINCT quest_id) AS n FROM assessments WHERE company_id = $1 AND review_status = 'FINISHED' AND month = $2 ${questFilter}`
        : `SELECT COUNT(DISTINCT quest_id) AS n FROM assessments WHERE company_id = $1 AND review_status = 'FINISHED' ${hasFilter ? "AND quest_id = ANY($2)" : ""}`,
      assessParams
    ),

    // Answer distribution
    query(
      `SELECT answer, COUNT(*) AS n FROM assessments WHERE company_id = $1 ${monthCondition} ${questFilter} GROUP BY answer`,
      assessParams
    ),

    // Module completion
    hasFilter
      ? query(
          month
            ? `SELECT m.module_id, m.name,
                (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND quest_id = ANY($3)) AS total_quests,
                COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status = 'FINISHED') AS finished,
                COUNT(DISTINCT a.quest_id) AS assessed
              FROM modules m
              LEFT JOIN assessments a ON a.module_id = m.module_id AND a.company_id = $1 AND a.month = $2 AND a.quest_id = ANY($3)
              WHERE (m.company_id = $1 OR m.company_id IS NULL)
              GROUP BY m.module_id, m.name, m.sort_order
              HAVING (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND quest_id = ANY($3)) > 0
              ORDER BY m.sort_order ASC, m.module_id ASC`
            : `SELECT m.module_id, m.name,
                (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND quest_id = ANY($2)) AS total_quests,
                COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status = 'FINISHED') AS finished,
                COUNT(DISTINCT a.quest_id) AS assessed
              FROM modules m
              LEFT JOIN assessments a ON a.module_id = m.module_id AND a.company_id = $1 AND a.quest_id = ANY($2)
              WHERE (m.company_id = $1 OR m.company_id IS NULL)
              GROUP BY m.module_id, m.name, m.sort_order
              HAVING (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND quest_id = ANY($2)) > 0
              ORDER BY m.sort_order ASC, m.module_id ASC`,
          assessParams
        )
      : query(
          month
            ? `SELECT m.module_id, m.name, m.total_quests,
                COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status = 'FINISHED') AS finished,
                COUNT(DISTINCT a.quest_id) AS assessed
              FROM modules m
              LEFT JOIN assessments a ON a.module_id = m.module_id AND a.company_id = $1 AND a.month = $2
              WHERE (m.company_id = $1 OR m.company_id IS NULL)
              GROUP BY m.module_id, m.name, m.total_quests, m.sort_order
              ORDER BY m.sort_order ASC, m.module_id ASC`
            : `SELECT m.module_id, m.name, m.total_quests,
                COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status = 'FINISHED') AS finished,
                COUNT(DISTINCT a.quest_id) AS assessed
              FROM modules m
              LEFT JOIN assessments a ON a.module_id = m.module_id AND a.company_id = $1
              WHERE (m.company_id = $1 OR m.company_id IS NULL)
              GROUP BY m.module_id, m.name, m.total_quests, m.sort_order
              ORDER BY m.sort_order ASC, m.module_id ASC`,
          monthParams
        ),

    // Evidence coverage
    hasFilter
      ? query(
          month
            ? `SELECT q.module_id,
                COUNT(DISTINCT e.quest_id) AS covered,
                COUNT(DISTINCT q.quest_id) AS total
              FROM questions q
              LEFT JOIN evidence e ON e.quest_id = q.quest_id AND e.company_id = $1 AND e.month = $2
              WHERE q.company_id = $1 AND q.quest_id = ANY($3)
              GROUP BY q.module_id
              ORDER BY q.module_id`
            : `SELECT q.module_id,
                COUNT(DISTINCT e.quest_id) AS covered,
                COUNT(DISTINCT q.quest_id) AS total
              FROM questions q
              LEFT JOIN evidence e ON e.quest_id = q.quest_id AND e.company_id = $1
              WHERE q.company_id = $1 AND q.quest_id = ANY($2)
              GROUP BY q.module_id
              ORDER BY q.module_id`,
          assessParams
        )
      : query(
          `SELECT q.module_id,
            COUNT(DISTINCT e.quest_id) AS covered,
            COUNT(DISTINCT q.quest_id) AS total
          FROM questions q
          LEFT JOIN evidence e ON e.quest_id = q.quest_id AND e.company_id = $1 ${month ? 'AND e.month = $2' : ''}
          WHERE q.company_id = $1
          GROUP BY q.module_id
          ORDER BY q.module_id`,
          monthParams
        ),

    // Action status
    query(
      `SELECT COALESCE(UPPER(status), 'OPEN') AS status, COUNT(*) AS n FROM actions WHERE company_id = $1 ${cidQf} GROUP BY COALESCE(UPPER(status), 'OPEN')`,
      cidParams
    ),

    // Maturity distribution
    query(
      `SELECT
        COUNT(*) FILTER (WHERE current_level = 1) AS l1,
        COUNT(*) FILTER (WHERE current_level = 2) AS l2,
        COUNT(*) FILTER (WHERE current_level = 3) AS l3,
        COUNT(*) FILTER (WHERE current_level = 4) AS l4,
        COUNT(*) FILTER (WHERE current_level = 5) AS l5
      FROM assessments
      WHERE company_id = $1 ${monthCondition} ${questFilter}`,
      assessParams
    ),

    // Overdue questions
    hasFilter
      ? query(
          "SELECT COUNT(*) AS n FROM questions WHERE company_id = $1 AND quest_id = ANY($2) AND next_due_date IS NOT NULL AND next_due_date < NOW()",
          [cid, filteredQuestIds]
        )
      : query(
          "SELECT COUNT(*) AS n FROM questions WHERE company_id = $1 AND next_due_date IS NOT NULL AND next_due_date < NOW()",
          [cid]
        ),

    // Questions with internal notes (comments)
    query(
      "SELECT COUNT(DISTINCT quest_id)::INT AS n FROM assessments WHERE company_id = $1 AND comments IS NOT NULL AND comments <> ''",
      [cid]
    ),

    // Questions with reviewer notes
    query(
      "SELECT COUNT(DISTINCT quest_id)::INT AS n FROM assessments WHERE company_id = $1 AND reviewer_notes IS NOT NULL AND reviewer_notes <> ''",
      [cid]
    ),

    // Questions without any notes
    query(
      `SELECT COUNT(DISTINCT q.quest_id)::INT AS n
       FROM questions q
       WHERE q.company_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM assessments a
         WHERE a.company_id = $1 AND a.quest_id = q.quest_id
         AND (
           (a.comments IS NOT NULL AND a.comments <> '')
           OR (a.reviewer_notes IS NOT NULL AND a.reviewer_notes <> '')
         )
       )`,
      [cid]
    ),

    // Open evidence requests
    query(
      "SELECT COUNT(*)::INT AS n FROM evidence_requests WHERE company_id = $1 AND status NOT IN ('Completed', 'Cancelled')",
      [cid]
    ),

    // Overdue evidence requests
    query(
      "SELECT COUNT(*)::INT AS n FROM evidence_requests WHERE company_id = $1 AND status NOT IN ('Completed', 'Cancelled') AND due_date IS NOT NULL AND due_date < CURRENT_DATE",
      [cid]
    ),

    // Completed evidence requests
    query(
      "SELECT COUNT(*)::INT AS n FROM evidence_requests WHERE company_id = $1 AND status = 'Completed'",
      [cid]
    ),

    // Requests by assignee (top 10)
    query(
      `SELECT COALESCE(u.full_name, u.email) AS name, COUNT(er.id)::INT AS n
       FROM evidence_requests er
       JOIN users u ON u.id = er.assignee_id
       WHERE er.company_id = $1 AND er.assignee_id IS NOT NULL
       GROUP BY u.id, u.full_name, u.email
       ORDER BY n DESC LIMIT 10`,
      [cid]
    ),

    // Total evidence versions across all vault items for this company
    query(
      `SELECT COUNT(ev.id)::INT AS n
       FROM evidence_versions ev
       JOIN evidence_vault vault ON vault.id = ev.evidence_id
       WHERE vault.company_id = $1`,
      [cid]
    ),

    // Vault items that had a new version uploaded this calendar month
    query(
      `SELECT COUNT(DISTINCT ev.evidence_id)::INT AS n
       FROM evidence_versions ev
       JOIN evidence_vault vault ON vault.id = ev.evidence_id
       WHERE vault.company_id = $1
         AND DATE_TRUNC('month', ev.uploaded_at) = DATE_TRUNC('month', NOW())`,
      [cid]
    ),

    // Most recently modified vault item (latest version uploaded)
    query(
      `SELECT vault.title, ev.uploaded_at
       FROM evidence_versions ev
       JOIN evidence_vault vault ON vault.id = ev.evidence_id
       WHERE vault.company_id = $1
       ORDER BY ev.uploaded_at DESC LIMIT 1`,
      [cid]
    ),

    // Score-eligible controls (IMPLEMENTED, maturity >= 3, score_eligible = true)
    query(
      `SELECT COUNT(DISTINCT quest_id)::INT AS n FROM assessments WHERE company_id = $1 ${monthCondition} ${questFilter} AND score_eligible = TRUE`,
      assessParams
    )
  ]);

  res.json({
    overall: {
      total: hasFilter ? filteredQuestIds.length : parseInt(totalQ.rows[0].n),
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
    overdueQuestions: parseInt(overdueQuestions.rows[0].n) || 0,
    notesMetrics: {
      withNotes: parseInt(notesCount.rows[0].n) || 0,
      withReviewerNotes: parseInt(reviewerNotesCount.rows[0].n) || 0,
      withoutAnyNotes: parseInt(noNotesCount.rows[0].n) || 0
    },
    requestMetrics: {
      open: parseInt(openRequests.rows[0]?.n) || 0,
      overdue: parseInt(overdueRequests.rows[0]?.n) || 0,
      completed: parseInt(completedRequests.rows[0]?.n) || 0,
      byUser: requestsByUser.rows.map(r => ({ name: r.name, count: r.n }))
    },
    vaultMetrics: {
      totalVersions: parseInt(vaultTotalVersions.rows[0]?.n) || 0,
      updatedThisMonth: parseInt(vaultUpdatedThisMonth.rows[0]?.n) || 0,
      latestModifiedTitle: vaultLatestModified.rows[0]?.title || null,
      latestModifiedAt: vaultLatestModified.rows[0]?.uploaded_at || null
    },
    scoreEligible: {
      count: parseInt(scoreEligible.rows[0]?.n) || 0,
      total: hasFilter ? filteredQuestIds.length : parseInt(totalQ.rows[0].n)
    }
  });
}));

export default router;
