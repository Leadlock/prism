import { Router } from "express";
import multer from "multer";
import { buildUpdate, mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { longRequestTimeout } from "../middleware/timeout.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { analyzeEvidence } from "../utils/aiProvider.js";
import { runEvidenceAnalysis, resolveVaultIdForEvidence } from "../utils/evidenceAnalysis.js";
import { notifyReviewers } from "../utils/notifyReviewers.js";
import { scanBuffer } from "../utils/scanFile.js";
import { saveObject, openObjectStream, withLocalCopy } from "../utils/evidenceStorage.js";
import path from "path";

const router = Router();

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
]);

const evidenceFileFilter = (req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error("File type not allowed"), { status: 400 }), false);
  }
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: evidenceFileFilter });

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "VIEWER", "AUDITOR"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "evidence", ip: req.ip });
  }
  const { questId, moduleId, month } = req.query;
  const conditions = ["e.company_id = $1"];
  const values = [req.user.companyId];

  if (questId) {
    values.push(questId);
    conditions.push(`e.quest_id = $${values.length}`);
  }

  if (moduleId) {
    values.push(moduleId);
    conditions.push(`e.module_id = $${values.length}`);
  }

  if (month) {
    values.push(month);
    conditions.push(`e.month = $${values.length}`);
  }

  // AI analysis now lives on the shared evidence_vault item; fall back to the
  // legacy per-row columns for evidence uploaded/analysed before the move.
  const result = await query(
    `SELECT e.id, e.evidence_id, e.month, e.module_id, e.quest_id, e.company_id,
            e.evidence_type, e.evidence_name, e.evidence_link, e.file_path,
            e.uploaded_by, e.upload_date, e.reviewer, e.approval_status, e.notes,
            COALESCE(ev.ai_contributor_comments, e.ai_contributor_comments) AS ai_contributor_comments,
            COALESCE(ev.ai_reviewer_comments,    e.ai_reviewer_comments)    AS ai_reviewer_comments,
            COALESCE(ev.ai_gaps,                 e.ai_gaps)                 AS ai_gaps,
            COALESCE(ev.ai_suggestions,          e.ai_suggestions)          AS ai_suggestions,
            COALESCE(ev.ai_analyzed_at,          e.ai_analyzed_at)          AS ai_analyzed_at,
            COALESCE(ev.ai_date_warning,         e.ai_date_warning)         AS ai_date_warning,
            e.created_at, e.updated_at
       FROM evidence e
       LEFT JOIN LATERAL (
         SELECT ai_contributor_comments, ai_reviewer_comments, ai_gaps,
                ai_suggestions, ai_analyzed_at, ai_date_warning
           FROM evidence_vault
          WHERE legacy_evidence_id = e.id AND company_id = e.company_id
          ORDER BY updated_at DESC LIMIT 1
       ) ev ON TRUE
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.created_at DESC`,
    values
  );
  res.json(mapRows(result));
}));

router.get("/:id/download", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const evidenceResult = await query(
    "SELECT evidence_name, file_path FROM evidence WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );
  const evidence = mapRow(evidenceResult);

  if (!evidence || !evidence.filePath) {
    return res.status(404).json({ error: "Evidence file not found" });
  }

  const stream = await openObjectStream(req.user.companyId, evidence.filePath);
  if (!stream) return res.status(404).json({ error: "Evidence file not found" });

  const filename = evidence.evidenceName || path.basename(evidence.filePath);
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  stream.on("error", () => { if (!res.headersSent) res.status(404).end(); });
  stream.pipe(res);
}));

// GET /api/evidence/:id/view — serve file inline (auditors can view but not download)
router.get("/:id/view", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "AUDITOR"]), asyncHandler(async (req, res) => {
  const evidenceResult = await query(
    "SELECT evidence_name, file_path FROM evidence WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );
  const evidence = mapRow(evidenceResult);

  if (!evidence || !evidence.filePath) return res.status(404).json({ error: "Evidence file not found" });

  const stream = await openObjectStream(req.user.companyId, evidence.filePath);
  if (!stream) return res.status(404).json({ error: "Evidence file not found" });

  const filename = evidence.evidenceName || path.basename(evidence.filePath);
  res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
  stream.on("error", () => { if (!res.headersSent) res.status(404).end(); });
  stream.pipe(res);
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), upload.single("file"), asyncHandler(async (req, res) => {
  const uploadedBy = req.user?.email || req.body.uploadedBy || null;
  const uploadDate = req.body.uploadDate || new Date();
  const evidenceType = req.body.evidenceType || (req.file ? "FILE" : "LINK");

  const data = {
    evidence_id: req.body.evidenceId || null,
    month: req.body.month || null,
    module_id: req.body.moduleId || null,
    quest_id: req.body.questId || null,
    company_id: req.user.companyId,
    evidence_type: evidenceType,
    evidence_name: req.body.evidenceName || null,
    evidence_link: req.body.evidenceLink || null,
    file_path: req.body.filePath || null,
    uploaded_by: uploadedBy,
    upload_date: uploadDate,
    reviewer: req.body.reviewer || null,
    approval_status: req.body.approvalStatus || null,
    notes: req.body.notes || null
  };

  if (req.file) {
    const scan = await scanBuffer(req.file.buffer, req.file.mimetype);
    if (!scan.safe) return res.status(400).json({ error: `File rejected: ${scan.reason}` });
    data.file_path = await saveObject(req.user.companyId, {
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      scope: "evidence",
      contentType: req.file.mimetype,
    });
    data.evidence_name = req.file.originalname;
  }
  // The stored ref is shared between the evidence row and its vault mirror below.
  const fileRef = req.file ? data.file_path : null;

  const result = await query(
    "INSERT INTO evidence (evidence_id, month, module_id, quest_id, company_id, evidence_type, evidence_name, evidence_link, file_path, uploaded_by, upload_date, reviewer, approval_status, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *",
    [
      data.evidence_id,
      data.month,
      data.module_id,
      data.quest_id,
      data.company_id,
      data.evidence_type,
      data.evidence_name,
      data.evidence_link,
      data.file_path,
      data.uploaded_by,
      data.upload_date,
      data.reviewer,
      data.approval_status,
      data.notes
    ]
  );

  const evidenceRecord = mapRow(result);

  // Mirror into evidence_vault — if a file for this question already exists in the vault, add a new version
  if (data.file_path || data.evidence_link) {
    let vaultItemId = null;

    // For file uploads on a known question, check for an existing linked vault item
    if (req.file && data.quest_id) {
      const existingLink = await query(
        `SELECT qe.vault_id FROM question_evidence qe
         JOIN evidence_vault ev ON ev.id = qe.vault_id
         WHERE qe.quest_id = $1 AND qe.company_id = $2 AND ev.storage_path IS NOT NULL
         ORDER BY ev.updated_at DESC LIMIT 1`,
        [data.quest_id, data.company_id]
      );

      if (existingLink.rows.length > 0) {
        // Re-upload: add a new version to the existing vault item
        const existingId = existingLink.rows[0].vault_id;

        const maxResult = await query(
          "SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM evidence_versions WHERE evidence_id = $1",
          [existingId]
        );
        const nextVer = parseInt(maxResult.rows[0].max_ver) + 1;

        await query(
          `INSERT INTO evidence_versions (evidence_id, version_number, file_name, file_type, file_size, storage_path, uploaded_by, version_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [existingId, nextVer, req.file.originalname, req.file.mimetype, req.file.size, fileRef, data.uploaded_by, "Updated via Tracker"]
        );

        await query(
          `UPDATE evidence_vault SET file_name=$1, file_type=$2, file_size=$3, storage_path=$4, updated_at=NOW() WHERE id=$5`,
          [req.file.originalname, req.file.mimetype, req.file.size, fileRef, existingId]
        );

        // Fetch vault title for notification
        const titleRes = await query("SELECT title FROM evidence_vault WHERE id = $1", [existingId]);
        const vaultTitle = titleRes.rows[0]?.title || "an evidence item";

        notifyReviewers(data.company_id, {
          title: `Evidence updated: ${vaultTitle}`,
          body: `${data.uploaded_by || "A contributor"} uploaded v${nextVer} of "${vaultTitle}" via Tracker (${data.quest_id}).`,
          entityType: "vault_version",
          entityId: existingId,
        });

        vaultItemId = existingId;
      }
    }

    // No existing vault item found — create a new one
    if (!vaultItemId) {
      const vaultResult = await query(
        `INSERT INTO evidence_vault
           (company_id, title, description, file_name, file_type, file_size, storage_path, evidence_link, uploaded_by, legacy_evidence_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          data.company_id,
          data.evidence_name || "Untitled Evidence",
          data.notes || null,
          req.file?.originalname || null,
          req.file?.mimetype || null,
          req.file?.size || null,
          data.file_path || null,
          data.evidence_link || null,
          data.uploaded_by,
          evidenceRecord.id
        ]
      );

      // ON CONFLICT DO NOTHING returns zero rows if a unique constraint fired;
      // fall back to the existing vault item so linking still happens.
      let vaultItem = mapRow(vaultResult);
      if (!vaultItem) {
        const existing = await query(
          "SELECT * FROM evidence_vault WHERE legacy_evidence_id = $1",
          [evidenceRecord.id]
        );
        vaultItem = mapRow(existing);
      }
      if (vaultItem) {
        vaultItemId = vaultItem.id;

        if (data.quest_id) {
          await query(
            `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
            [data.company_id, data.quest_id, vaultItem.id, data.uploaded_by]
          );
        }

        if (req.file) {
          await query(
            `INSERT INTO evidence_versions (evidence_id, version_number, file_name, file_type, file_size, storage_path, uploaded_by, version_notes)
             VALUES ($1, 1, $2, $3, $4, $5, $6, 'Initial version')
             ON CONFLICT (evidence_id, version_number) DO NOTHING`,
            [vaultItem.id, req.file.originalname, req.file.mimetype, req.file.size, fileRef, data.uploaded_by]
          );
        }
      }
    }
  }

  res.status(201).json(evidenceRecord);
}));

router.post("/:id/reassign", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const evidenceId = parseInt(req.params.id);
  const { targetAdminEmail, uploadedBy } = req.body;
  if (!targetAdminEmail) return res.status(400).json({ error: "targetAdminEmail required" });

  const companyResult = await query(
    "SELECT id FROM companies WHERE admin_email = $1",
    [targetAdminEmail]
  );
  const company = mapRow(companyResult);
  if (!company) return res.status(404).json({ error: "Target company not found" });

  const updateResult = await query(
    "UPDATE evidence SET company_id = $1, uploaded_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
    [company.id, uploadedBy || req.user.email || null, evidenceId]
  );

  if (updateResult.rows.length === 0) return res.status(404).json({ error: "Evidence not found" });

  res.json(mapRow(updateResult));
}));

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const data = {
    evidence_id: req.body.evidenceId,
    month: req.body.month,
    module_id: req.body.moduleId,
    quest_id: req.body.questId,
    evidence_type: req.body.evidenceType,
    evidence_name: req.body.evidenceName,
    evidence_link: req.body.evidenceLink,
    // file_path intentionally excluded — only set at upload time, never via API update
    uploaded_by: req.body.uploadedBy || req.user?.email || null,
    upload_date: req.body.uploadDate,
    reviewer: req.body.reviewer,
    approval_status: req.body.approvalStatus,
    notes: req.body.notes,
    updated_at: new Date()
  };

  const hasUpdates = Object.keys(data).some((key) => key !== "updated_at" && data[key] !== undefined);
  if (!hasUpdates) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const update = buildUpdate(data);
  const evidenceResult = await query(
    `UPDATE evidence SET ${update.set} WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING *`,
    [...update.values, parseInt(req.params.id), req.user.companyId]
  );

  if (evidenceResult.rows.length === 0) {
    return res.status(404).json({ error: "Evidence not found" });
  }

  res.json(mapRow(evidenceResult));
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);

  // Block deletion if the evidence belongs to a quest with a finished review
  const evCheck = await query(
    "SELECT quest_id FROM evidence WHERE id = $1 AND company_id = $2",
    [id, req.user.companyId]
  );
  const ev = mapRow(evCheck);
  if (!ev) return res.status(404).json({ error: "Evidence not found" });

  if (ev.questId) {
    const lockCheck = await query(
      "SELECT 1 FROM assessments WHERE quest_id = $1 AND company_id = $2 AND review_status = 'FINISHED' LIMIT 1",
      [ev.questId, req.user.companyId]
    );
    if (lockCheck.rows.length > 0) {
      return res.status(409).json({
        error: "This evidence is locked because the linked control has been approved by a reviewer.",
        code: "LOCKED"
      });
    }
  }

  const result = await query(
    "DELETE FROM evidence WHERE id = $1 AND company_id = $2",
    [id, req.user.companyId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Evidence not found" });
  res.status(204).send();
}));

router.post("/:id/analyze", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), longRequestTimeout(120000), asyncHandler(async (req, res) => {
  // Check if AI is enabled for this company
  const settingsResult = await query(
    "SELECT ai_enabled, ai_provider FROM company_settings WHERE company_id = $1",
    [req.user.companyId]
  );
  const settings = mapRow(settingsResult);
  if (settings && settings.aiEnabled === false) {
    return res.status(403).json({ error: "AI features are disabled for your company" });
  }

  const evidenceId = parseInt(req.params.id);
  const evidenceResult = await query(
    `SELECT e.*, q.required_evidence, q.recurrence_interval
     FROM evidence e
     LEFT JOIN questions q ON e.quest_id = q.quest_id
     WHERE e.id = $1 AND e.company_id = $2`,
    [evidenceId, req.user.companyId]
  );
  const evidence = mapRow(evidenceResult);

  if (!evidence) {
    return res.status(404).json({ error: "Evidence not found" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const provider = settings?.aiProvider || null;

  // Prefer analysing the shared vault item so the result is reused by every
  // question/framework the evidence is linked to. Fall back to the legacy
  // evidence row only when there is no vault mirror (e.g. a link-only record).
  const vaultId = await resolveVaultIdForEvidence(evidenceId, req.user.companyId);

  let analysis;
  if (vaultId) {
    ({ analysis } = await runEvidenceAnalysis({
      vaultId, companyId: req.user.companyId, provider, today,
    }));
  } else {
    const runAnalysis = (filePath) => analyzeEvidence({
      provider,
      evidenceName: evidence.evidenceName,
      evidenceType: evidence.evidenceType,
      questId: evidence.questId,
      moduleId: evidence.moduleId,
      requiredEvidence: evidence.requiredEvidence,
      filePath,
      recurrenceInterval: evidence.recurrenceInterval || null,
      today
    });
    analysis = evidence.evidenceType === "FILE" && evidence.filePath
      ? await withLocalCopy(req.user.companyId, evidence.filePath, runAnalysis)
      : await runAnalysis(null);
  }

  // Dual-write onto the legacy evidence row so the Tracker UI (which reads
  // /api/evidence) keeps showing analysis without a frontend change.
  const updateResult = await query(
    `UPDATE evidence
     SET ai_contributor_comments = $1, ai_reviewer_comments = $2,
         ai_gaps = $3, ai_suggestions = $4, ai_analyzed_at = NOW(),
         ai_date_warning = $5
     WHERE id = $6 AND company_id = $7
     RETURNING *`,
    [
      Array.isArray(analysis.contributorComments) ? analysis.contributorComments.join("\n") : analysis.contributorComments,
      analysis.reviewerComments,
      JSON.stringify(analysis.gaps || []),
      JSON.stringify(analysis.suggestions || []),
      analysis.dateWarning || null,
      evidenceId,
      req.user.companyId
    ]
  );

  res.json(mapRow(updateResult));
}));

export default router;
