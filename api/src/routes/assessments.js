import { Router } from "express";
import fs from "fs";
import path from "path";
import { buildUpdate, getClient, mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sanitiseFields } from "../utils/sanitise.js";
import { notifyReviewers } from "../utils/notifyReviewers.js";

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
    // Accepts a single status or a comma-separated list (e.g. "FINISHED,AUDITED"
    // for the auditor queue).
    const statuses = String(reviewStatus).split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      values.push(statuses[0]);
      conditions.push(`review_status = $${values.length}`);
    } else if (statuses.length > 1) {
      const placeholders = statuses.map((s) => {
        values.push(s);
        return `$${values.length}`;
      });
      conditions.push(`review_status IN (${placeholders.join(", ")})`);
    }
  }

  const result = await query(
    `SELECT a.*, act.owner AS action_owner, act.due_date AS action_due_date, act.notes AS action_notes
     FROM assessments a
     LEFT JOIN LATERAL (
       SELECT owner, due_date, notes FROM actions
       WHERE quest_id = a.quest_id AND company_id = a.company_id AND month = a.month
       ORDER BY created_at DESC LIMIT 1
     ) act ON true
     WHERE ${conditions.map(c => `a.${c}`).join(" AND ")} ORDER BY a.created_at DESC`,
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
    reviewStatus,
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
  const claimsCompliant = normalizedAnswer === "IMPLEMENTED" || normalizedAnswer === "YES";

  let linkedEvidenceCount = 0;
  let vaultLinkedCount = 0;

  if (reviewStatus !== "WIP") {
    if (claimsCompliant) {
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

      const vaultResult = await query(
        `SELECT COUNT(*) AS n FROM question_evidence WHERE company_id = $1 AND quest_id = $2`,
        [req.user.companyId, questId || null]
      );
      vaultLinkedCount = parseInt(vaultResult.rows[0].n, 10) || 0;

      if (!hasEvidenceLink && linkedEvidenceCount === 0 && vaultLinkedCount === 0) {
        return res.status(400).json({ error: "Implemented assessments require an evidence upload or evidence link before submission" });
      }
    }

    if (["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED", "NO"].includes(normalizedAnswer)) {
      if (!actionDueDate || !actionOwner || !actionNotes) {
        return res.status(400).json({ error: `${normalizedAnswer.replace(/_/g, " ")} assessments require an action owner, due date, and notes` });
      }
    }
  }

  // F-07: reviewStatus/scoreEligible/reviewedBy/auditedBy must never be trusted
  // verbatim from the client on creation — Tracker.jsx's only two callers always send
  // reviewStatus="WIP" (draft) or, on submit, "Submitted" for an IMPLEMENTED/YES answer
  // (queued for reviewer approval) vs "FINISHED" for anything else (a self-reported gap
  // with nothing for a reviewer to verify — matches the "auto-FINISHED, no review
  // needed" comment on the notifyReviewers call below). A row can never have already
  // been reviewed/audited the moment it's created, and scoreEligible must reflect the
  // actual submitted content rather than an arbitrary client claim.
  const finalReviewStatus = VALID_REVIEW_STATUSES.has(reviewStatus) ? reviewStatus : null;
  if (finalReviewStatus === "AUDITED") {
    return res.status(400).json({ error: "reviewStatus 'AUDITED' cannot be set when creating an assessment" });
  }
  if (finalReviewStatus === "FINISHED" && claimsCompliant) {
    return res.status(400).json({ error: "An IMPLEMENTED/YES assessment cannot be created as FINISHED — submit it for review instead" });
  }
  const computedScoreEligible = finalReviewStatus !== "WIP"
    && claimsCompliant
    && Number(currentLevel) >= 3
    && (hasEvidenceLink || linkedEvidenceCount > 0 || vaultLinkedCount > 0);

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
        finalReviewStatus,
        computedScoreEligible,
        comments || null,
        null, // reviewed_by: never set at creation — nothing has been reviewed yet
        null  // audited_by: never set at creation — nothing has been audited yet
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

    if (reviewStatus !== "WIP" && ["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED", "NO"].includes(normalizedAnswer)) {
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

    // Notify reviewers only for IMPLEMENTED submissions (non-IMPLEMENTED answers are auto-FINISHED, no review needed)
    if (reviewStatus !== "WIP" && (normalizedAnswer === "IMPLEMENTED" || normalizedAnswer === "YES")) {
      notifyReviewers(req.user.companyId, {
        title: `Assessment submitted: ${questId || controlArea || "control"}`,
        body: `Submitted by ${submittedBy}`,
        entityType: "assessment",
        entityId: assessment.id
      });
    }

    res.status(201).json(assessment);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

// PUT /:id is a review/audit-workflow endpoint, not a general assessment editor — the
// only three callers in the product (Review.jsx's approve/reject, Dashboard.jsx's
// auditor approve/reject, and QuestionCard.jsx's "unlock for edit") ever send these
// fields. Control content (answer, currentLevel, controlArea, owner, comments,
// evidenceLink, scoreEligible, question/module/month identity) is only ever set via
// POST, when a new monthly assessment row is created.
const PUT_SUPPORTED_FIELDS = new Set(["reviewStatus", "reviewerNotes", "auditorNotes", "reviewedBy", "auditedBy"]);

// Which reviewStatus values each role's real workflow is allowed to set (F-07):
// CONTRIBUTOR may only unlock their own submission back to WIP for editing — never
// self-approve. ADMIN/LEAD run the reviewer stage (Submitted -> FINISHED / WIP).
// AUDITOR runs the audit stage on top of an already-FINISHED control
// (FINISHED -> AUDITED / WIP) — auditors never set FINISHED, reviewers never set
// AUDITED. The status lifecycle is:
//   WIP -> Submitted -> FINISHED -> AUDITED   (reject at any stage -> WIP)
const REVIEW_STATUS_BY_ROLE = {
  ADMIN: new Set(["FINISHED", "WIP"]),
  LEAD: new Set(["FINISHED", "WIP"]),
  AUDITOR: new Set(["AUDITED", "WIP"]),
  CONTRIBUTOR: new Set(["WIP"]),
};

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR", "AUDITOR"]), asyncHandler(async (req, res) => {
  const assessmentId = parseInt(req.params.id);
  const role = req.user.role;
  const body = req.body || {};

  const unsupportedFields = Object.keys(body).filter((key) => !PUT_SUPPORTED_FIELDS.has(key));
  if (unsupportedFields.length > 0) {
    return res.status(400).json({ error: `This endpoint does not support updating: ${unsupportedFields.join(", ")}` });
  }

  const rawBody = sanitiseFields(body, {
    reviewerNotes: "text", auditorNotes: "text",
  });
  if (rawBody.reviewStatus !== undefined && !VALID_REVIEW_STATUSES.has(rawBody.reviewStatus)) {
    rawBody.reviewStatus = undefined;
  }

  if (rawBody.reviewStatus !== undefined && !REVIEW_STATUS_BY_ROLE[role]?.has(rawBody.reviewStatus)) {
    return res.status(403).json({ error: `Role ${role} may not set reviewStatus to ${rawBody.reviewStatus}` });
  }
  if (rawBody.reviewerNotes !== undefined && role !== "ADMIN" && role !== "LEAD") {
    return res.status(403).json({ error: "Only a reviewer (ADMIN/LEAD) may set reviewerNotes" });
  }
  if (rawBody.auditorNotes !== undefined && role !== "AUDITOR") {
    return res.status(403).json({ error: "Only an AUDITOR may set auditorNotes" });
  }

  // reviewedBy/auditedBy are never taken from the request body (F-07: previously a
  // caller could impersonate an arbitrary reviewer/auditor) — they're derived from
  // the authenticated session whenever that role actually performs the corresponding
  // action, matching the existing approve/reject workflows above.
  const isBeingReviewed = (role === "ADMIN" || role === "LEAD") && rawBody.reviewStatus !== undefined;
  const isBeingAudited  = role === "AUDITOR" && rawBody.reviewStatus !== undefined;

  // A reviewer re-opening a control (approve or reject) invalidates any prior
  // auditor sign-off — the auditor must look at it again — so the audit stamps
  // are cleared. Same when a contributor unlocks their submission for editing.
  const clearsAudit = (isBeingReviewed || role === "CONTRIBUTOR") && rawBody.reviewStatus !== undefined;

  const data = {
    review_status: rawBody.reviewStatus,
    reviewer_notes: rawBody.reviewerNotes,
    auditor_notes: rawBody.auditorNotes,
    reviewed_by: isBeingReviewed ? req.user.email : undefined,
    audited_by: isBeingAudited ? req.user.email : (clearsAudit ? null : undefined),
    reviewed_at: isBeingReviewed ? new Date() : undefined,
    audited_at:  isBeingAudited  ? new Date() : (clearsAudit ? null : undefined),
    updated_at: new Date()
  };
  if (clearsAudit) data.auditor_notes = null;

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

    // Auto-close open actions for this quest when approved (reviewer FINISHED, or
    // auditor AUDITED — the latter is idempotent since it was already FINISHED)
    if (["FINISHED", "AUDITED"].includes(req.body.reviewStatus) && assessment.questId) {
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

      // Notify the user who submitted this assessment about the rejection
      if (assessment.submittedBy) {
        const submitterResult = await client.query(
          "SELECT id FROM users WHERE email = $1 AND company_id = $2 LIMIT 1",
          [assessment.submittedBy, req.user.companyId]
        );
        if (submitterResult.rows.length > 0) {
          const submitterId = submitterResult.rows[0].id;
          const rejectionReason = rawBody.auditorNotes || "No reason provided";
          const title = `Assessment rejected: ${assessment.questId || assessment.controlArea || "control"}`;
          const body = `Rejected by ${req.user.email}. Reason: ${rejectionReason}`;
          await client.query(
            `INSERT INTO notifications (user_id, company_id, title, body, entity_type, entity_id)
             VALUES ($1, $2, $3, $4, 'rejection', $5)`,
            [submitterId, req.user.companyId, title, body, assessment.id]
          );
        }
      }
    }

    await client.query("COMMIT");

    // Notify submitter when their assessment is approved (reviewer) or passes
    // audit (auditor).
    if (["FINISHED", "AUDITED"].includes(req.body.reviewStatus) && assessment.submittedBy) {
      const audited = req.body.reviewStatus === "AUDITED";
      query(
        "SELECT id FROM users WHERE email = $1 AND company_id = $2 LIMIT 1",
        [assessment.submittedBy, req.user.companyId]
      ).then(r => {
        if (r.rows.length > 0) {
          const submitterId = r.rows[0].id;
          return query(
            `INSERT INTO notifications (user_id, company_id, title, body, entity_type, entity_id) VALUES ($1, $2, $3, $4, 'approval', $5)`,
            [submitterId, req.user.companyId,
             `${audited ? "Assessment passed audit" : "Assessment approved"}: ${assessment.questId || assessment.controlArea || "control"}`,
             `${audited ? "Audited" : "Approved"} by ${req.user.email}`,
             assessment.id]
          );
        }
      }).catch(err => console.error("[notify] approval notification failed:", err.message));
    }

    // Notify auditors when a control clears review and is ready for audit sign-off.
    if (req.body.reviewStatus === "FINISHED") {
      notifyReviewers(req.user.companyId, {
        title: `Ready for audit: ${assessment.questId || assessment.controlArea || "control"}`,
        body: `Approved by ${req.user.email} — awaiting auditor sign-off`,
        entityType: "audit",
        entityId: assessment.id,
        roles: ["AUDITOR"],
      });
    }

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
