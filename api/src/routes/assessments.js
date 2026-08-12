import { Router } from "express";
import fs from "fs";
import path from "path";
import { buildUpdate, getClient, mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sanitiseFields } from "../utils/sanitise.js";

const router = Router();

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "VIEWER", "AUDITOR"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "assessments", ip: req.ip });
  }
  const { questId, month, moduleId, reviewStatus } = req.query;
  const conditions = ["company_id = $1"];
  const values = [req.user.companyId];

  if (questId) {
    values.push(questId);
    conditions.push(`quest_id = $${values.length}`);
  }

  if (month) {
    values.push(month);
    conditions.push(`month = $${values.length}`);
  }

  if (moduleId) {
    values.push(moduleId);
    conditions.push(`module_id = $${values.length}`);
  }

  if (reviewStatus) {
    values.push(reviewStatus);
    conditions.push(`review_status = $${values.length}`);
  }

  const result = await query(
    `SELECT * FROM assessments WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    values
  );
  res.json(mapRows(result));
}));

const VALID_REVIEW_STATUSES = new Set(["Submitted", "WIP", "FINISHED", "AUDITED"]);

router.post("/", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const raw = sanitiseFields(req.body, {
    controlArea: "text", answer: "text", owner: "text", reviewer: "text",
    comments: "text", evidenceLink: "url", actionOwner: "text", actionNotes: "text",
  });
  if (raw.reviewStatus !== undefined && !VALID_REVIEW_STATUSES.has(raw.reviewStatus)) {
    raw.reviewStatus = null;
  }
  const {
    assessmentId, month, moduleId, questId,
    controlArea = raw.controlArea,
    answer = raw.answer,
    currentLevel, level3Plus,
    evidenceLink = raw.evidenceLink,
    owner = raw.owner,
    reviewer = raw.reviewer,
    reviewStatus, scoreEligible,
    comments = raw.comments,
    evidenceIds = [],
    actionOwner = raw.actionOwner,
    actionDueDate,
    actionNotes = raw.actionNotes
  } = raw;

  const normalizedAnswer = typeof answer === "string" ? answer.trim().toUpperCase() : "";
  const normalizedEvidenceIds = Array.isArray(evidenceIds)
    ? evidenceIds.map((id) => parseInt(id, 10)).filter(Number.isInteger)
    : [];
  const hasEvidenceLink = typeof evidenceLink === "string" && evidenceLink.trim().length > 0;

  if (normalizedAnswer === "IMPLEMENTED" || normalizedAnswer === "YES") {
    let linkedEvidenceCount = 0;
    if (normalizedEvidenceIds.length > 0) {
      const evidenceResult = await query(
        `SELECT COUNT(*) AS n
         FROM evidence
         WHERE company_id = $1
           AND quest_id = $2
           AND ($3::text IS NULL OR month = $3)
           AND id = ANY($4::int[])`,
        [req.user.companyId, questId || null, month || null, normalizedEvidenceIds]
      );
      linkedEvidenceCount = parseInt(evidenceResult.rows[0].n, 10) || 0;
    }

    if (!hasEvidenceLink && linkedEvidenceCount === 0) {
      return res.status(400).json({ error: "Implemented assessments require an evidence upload or evidence link before submission" });
    }
  }

  if (["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED", "NO", "WIP"].includes(normalizedAnswer)) {
    if (!actionDueDate || !actionOwner || !actionNotes) {
      return res.status(400).json({ error: `${normalizedAnswer.replace(/_/g, " ")} assessments require an action owner, due date, and notes` });
    }
  }

  const submittedBy = req.user.email || null;
  const client = await getClient();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "INSERT INTO assessments (assessment_id, month, module_id, quest_id, company_id, control_area, answer, current_level, level3_plus, evidence_link, owner, submitted_by, reviewer, review_status, score_eligible, comments, reviewed_by, audited_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *",
      [
        assessmentId || null,
        month || null,
        moduleId || null,
        questId || null,
        req.user.companyId,
        controlArea || null,
        normalizedAnswer || null,
        currentLevel ?? null,
        level3Plus ?? null,
        evidenceLink || null,
        owner || null,
        submittedBy,
        reviewer || null,
        reviewStatus || null,
        scoreEligible ?? null,
        comments || null,
        req.body.reviewedBy || null,
        req.body.auditedBy || null
      ]
    );

    const assessment = mapRow(result);

    if (normalizedEvidenceIds.length > 0) {
      const evidenceCheckResult = await client.query(
        `SELECT id FROM evidence WHERE company_id = $1 AND id = ANY($2::int[])`,
        [req.user.companyId, normalizedEvidenceIds]
      );
      const validEvidenceIds = evidenceCheckResult.rows.map(r => r.id);
      
      if (validEvidenceIds.length > 0) {
        await client.query(
          `UPDATE evidence
           SET evidence_id = $1, quest_id = $2, module_id = $3, month = $4, updated_at = NOW()
           WHERE company_id = $5 AND id = ANY($6::int[])`,
          [String(assessment.id), questId || null, moduleId || null, month || null, req.user.companyId, validEvidenceIds]
        );
      }
    }

    if (["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED", "NO", "WIP"].includes(normalizedAnswer)) {
      const questionResult = await client.query(
        "SELECT control_area, baseline_question, default_owner FROM questions WHERE quest_id = $1",
        [questId || null]
      );
      const question = questionResult.rows[0] || {};
      const actionResult = await client.query(
        `INSERT INTO actions
         (action_id, month, module_id, quest_id, company_id, defeated_quest, current_level, target_level,
          immediate_action_required, owner, due_date, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10, 'OPEN', $11)
         RETURNING id`,
        [
          `assessment-${assessment.id}`,
          month || null,
          moduleId || null,
          questId || null,
          req.user.companyId,
          controlArea || question.control_area || question.baseline_question || questId || null,
          currentLevel ?? null,
          3,
          actionOwner || question.default_owner || owner || null,
          actionDueDate,
          actionNotes
        ]
      );

      // Auto-create reminders based on company default offsets
      if (actionDueDate && actionResult.rows.length > 0) {
        const actionId = actionResult.rows[0].id;
        const recipientEmail = actionOwner && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actionOwner.trim())
          ? actionOwner.trim()
          : null;

        // Get company default reminder offsets
        const settingsResult = await client.query(
          "SELECT default_reminder_offsets FROM company_settings WHERE company_id = $1",
          [req.user.companyId]
        );
        const offsets = settingsResult.rows[0]?.default_reminder_offsets || [7, 14, 30];

        const dueDate = new Date(actionDueDate);
        for (const offsetDays of offsets) {
          const remindAt = new Date(dueDate);
          remindAt.setDate(remindAt.getDate() - offsetDays);
          // Only create reminder if it's in the future
          if (remindAt > new Date()) {
            await client.query(
              `INSERT INTO reminders (action_id, company_id, quest_id, module_id, reminder_type, remind_at, recipient_email, message)
               VALUES ($1, $2, $3, $4, 'action_due', $5, $6, $7)`,
              [
                actionId,
                req.user.companyId,
                questId || null,
                moduleId || null,
                remindAt.toISOString(),
                recipientEmail,
                `Action for "${controlArea || question.control_area || questId}" is due in ${offsetDays} days`
              ]
            );
          }
        }
      }
    }

    await client.query("COMMIT");
    res.status(201).json(assessment);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR", "AUDITOR"]), asyncHandler(async (req, res) => {
  const assessmentId = parseInt(req.params.id);
  const rawBody = sanitiseFields(req.body, {
    controlArea: "text", answer: "text", owner: "text", reviewer: "text",
    comments: "text", evidenceLink: "url", reviewedBy: "text", auditedBy: "text",
    reviewerNotes: "text", auditorNotes: "text",
  });
  if (rawBody.reviewStatus !== undefined && !VALID_REVIEW_STATUSES.has(rawBody.reviewStatus)) {
    rawBody.reviewStatus = undefined;
  }
  const isBeingReviewed = rawBody.reviewedBy && rawBody.reviewStatus !== undefined;
  const isBeingAudited  = rawBody.auditedBy  && rawBody.reviewStatus !== undefined;

  const data = {
    assessment_id: rawBody.assessmentId,
    month: rawBody.month,
    module_id: rawBody.moduleId,
    quest_id: rawBody.questId,
    control_area: rawBody.controlArea,
    answer: rawBody.answer,
    current_level: rawBody.currentLevel,
    level3_plus: rawBody.level3Plus,
    evidence_link: rawBody.evidenceLink,
    owner: rawBody.owner,
    reviewer: rawBody.reviewer,
    review_status: rawBody.reviewStatus,
    score_eligible: rawBody.scoreEligible,
    comments: rawBody.comments,
    reviewed_by: rawBody.reviewedBy,
    audited_by: rawBody.auditedBy,
    reviewer_notes: rawBody.reviewerNotes,
    auditor_notes: rawBody.auditorNotes,
    reviewed_at: isBeingReviewed ? new Date() : undefined,
    audited_at:  isBeingAudited  ? new Date() : undefined,
    updated_at: new Date()
  };

  const hasUpdates = Object.keys(data).some((key) => key !== "updated_at" && data[key] !== undefined);
  if (!hasUpdates) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const update = buildUpdate(data);
    const assessmentResult = await client.query(
      `UPDATE assessments SET ${update.set} WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING id, assessment_id, month, module_id, quest_id, company_id, control_area, answer, current_level, level3_plus, evidence_link, owner, submitted_by, reviewer, review_status, score_eligible, comments, reviewed_by, audited_by, reviewed_at, audited_at, reviewer_notes, auditor_notes, created_at, updated_at`,
      [...update.values, assessmentId, req.user.companyId]
    );

    if (assessmentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Assessment not found" });
    }

    const assessment = mapRow(assessmentResult);

    // Auto-close open actions for this quest when approved
    if (req.body.reviewStatus === "FINISHED" && assessment.questId) {
      await client.query(
        `UPDATE actions SET status = 'CLOSED', closure_date = NOW(), updated_at = NOW()
         WHERE quest_id = $1 AND company_id = $2
           AND COALESCE(UPPER(status), 'OPEN') NOT IN ('CLOSED', 'DONE', 'COMPLETED')`,
        [assessment.questId, req.user.companyId]
      );

      // Mirror any evidence for this quest that isn't yet in the vault
      await client.query(
        `INSERT INTO evidence_vault
           (company_id, title, file_name, file_type, file_size, storage_path, evidence_link, uploaded_by, legacy_evidence_id)
         SELECT
           e.company_id,
           COALESCE(e.evidence_name, 'Untitled Evidence'),
           e.evidence_name,
           NULL,
           NULL,
           e.file_path,
           e.evidence_link,
           e.uploaded_by,
           e.id
         FROM evidence e
         WHERE e.quest_id = $1 AND e.company_id = $2
           AND (e.file_path IS NOT NULL OR e.evidence_link IS NOT NULL)
           AND NOT EXISTS (
             SELECT 1 FROM evidence_vault ev WHERE ev.legacy_evidence_id = e.id
           )
         ON CONFLICT DO NOTHING`,
        [assessment.questId, req.user.companyId]
      );

      // Link newly mirrored vault items to this quest
      await client.query(
        `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
         SELECT ev.company_id, $1, ev.id, $3
         FROM evidence_vault ev
         WHERE ev.company_id = $2
           AND ev.legacy_evidence_id IN (
             SELECT id FROM evidence WHERE quest_id = $1 AND company_id = $2
           )
         ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
        [assessment.questId, req.user.companyId, req.user.email || null]
      );

      // Lock all vault items linked to this quest
      await client.query(
        `UPDATE evidence_vault SET locked = true
         WHERE id IN (
           SELECT vault_id FROM question_evidence WHERE quest_id = $1 AND company_id = $2
         )`,
        [assessment.questId, req.user.companyId]
      );
    }

    if (req.body.reviewStatus === "WIP" && ["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED", "NO", "WIP"].includes(assessment.answer)) {
      const actionId = `assessment-${assessment.id}`;
      const existingAction = await client.query(
        "SELECT id FROM actions WHERE action_id = $1 AND company_id = $2",
        [actionId, req.user.companyId]
      );

      if (existingAction.rows.length === 0) {
        const questionResult = await client.query(
          "SELECT control_area, baseline_question, default_owner FROM questions WHERE quest_id = $1",
          [assessment.questId]
        );
        const question = questionResult.rows[0] || {};
        
        await client.query(
          `INSERT INTO actions
           (action_id, month, module_id, quest_id, company_id, defeated_quest, current_level, target_level,
            immediate_action_required, owner, due_date, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10, 'OPEN', $11)`,
          [
            actionId,
            assessment.month,
            assessment.moduleId,
            assessment.questId,
            req.user.companyId,
            assessment.controlArea || question.control_area || question.baseline_question || assessment.questId,
            assessment.currentLevel,
            3,
            question.default_owner || assessment.owner,
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            'Rejected by auditor - requires resubmission'
          ]
        );
      } else {
        await client.query(
          "UPDATE actions SET status = 'OPEN', updated_at = NOW() WHERE action_id = $1 AND company_id = $2",
          [actionId, req.user.companyId]
        );
      }
    }

    await client.query("COMMIT");
    res.json(assessment);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const assessmentResult = await query(
    "SELECT id, assessment_id, quest_id, month, company_id FROM assessments WHERE id = $1 AND company_id = $2",
    [id, req.user.companyId]
  );
  if (assessmentResult.rows.length === 0) {
    return res.status(404).json({ error: "Assessment not found" });
  }

  const assessment = mapRow(assessmentResult);

  // Find evidence related to this assessment: only where evidence.evidence_id equals the assessment id
  const evidenceResult = await query(
    "SELECT id, file_path FROM evidence WHERE company_id = $1 AND evidence_id = $2",
    [req.user.companyId, String(assessment.id)]
  );

  const rows = evidenceResult.rows || [];
  const idsToDelete = [];
  const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const safeRoot = uploadRoot.endsWith(path.sep) ? uploadRoot : `${uploadRoot}${path.sep}`;

  for (const r of rows) {
    idsToDelete.push(r.id);
    if (r.file_path) {
      try {
        const resolvedPath = path.resolve(r.file_path); // nosemgrep
        if (resolvedPath.startsWith(safeRoot) && fs.existsSync(resolvedPath)) {
          fs.unlinkSync(resolvedPath);
        }
      } catch (e) {
        // ignore file unlink errors but continue
        console.warn("Failed to remove evidence file", r.file_path, e.message);
      }
    }
  }

  if (idsToDelete.length > 0) {
    await query("DELETE FROM evidence WHERE id = ANY($1::int[])", [idsToDelete]);
  }

  const del = await query(
    "DELETE FROM assessments WHERE id = $1 AND company_id = $2",
    [id, req.user.companyId]
  );
  if (del.rowCount === 0) {
    return res.status(404).json({ error: "Assessment not found" });
  }

  res.status(204).send();
}));

export default router;
