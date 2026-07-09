import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { buildUpdate, mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { analyzeEvidence } from "../utils/bedrock.js";

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || "./uploads");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "VIEWER", "AUDITOR"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "evidence", ip: req.ip });
  }
  const { questId, moduleId, month } = req.query;
  const conditions = ["company_id = $1"];
  const values = [req.user.companyId];

  if (questId) {
    values.push(questId);
    conditions.push(`quest_id = $${values.length}`);
  }

  if (moduleId) {
    values.push(moduleId);
    conditions.push(`module_id = $${values.length}`);
  }

  if (month) {
    values.push(month);
    conditions.push(`month = $${values.length}`);
  }

  const result = await query(
    `SELECT * FROM evidence WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    values
  );
  res.json(mapRows(result));
}));

router.get("/:id/download", authenticate, requireReadOnly(["ADMIN", "LEAD", "AUDITOR"]), asyncHandler(async (req, res) => {
  const evidenceResult = await query(
    "SELECT evidence_name, file_path FROM evidence WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );
  const evidence = mapRow(evidenceResult);

  if (!evidence || !evidence.filePath) {
    return res.status(404).json({ error: "Evidence file not found" });
  }

  const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const resolvedPath = path.resolve(evidence.filePath);
  const safeRoot = uploadRoot.endsWith(path.sep) ? uploadRoot : `${uploadRoot}${path.sep}`;

  if (!resolvedPath.startsWith(safeRoot)) {
    return res.status(400).json({ error: "Invalid file path" });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: "Evidence file not found" });
  }

  res.download(resolvedPath, evidence.evidenceName || path.basename(resolvedPath));
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
    data.file_path = req.file.path;
    data.evidence_name = req.file.originalname;
  }

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

  res.status(201).json(mapRow(result));
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
    file_path: req.body.filePath,
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
  const result = await query(
    "DELETE FROM evidence WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Evidence not found" });
  }

  res.status(204).send();
}));

router.post("/:id/analyze", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  // Check if AI is enabled for this company
  const settingsResult = await query(
    "SELECT ai_enabled FROM company_settings WHERE company_id = $1",
    [req.user.companyId]
  );
  const settings = mapRow(settingsResult);
  if (settings && settings.aiEnabled === false) {
    return res.status(403).json({ error: "AI features are disabled for your company" });
  }

  const evidenceResult = await query(
    `SELECT e.*, q.required_evidence 
     FROM evidence e 
     LEFT JOIN questions q ON e.quest_id = q.quest_id 
     WHERE e.id = $1 AND e.company_id = $2`,
    [parseInt(req.params.id), req.user.companyId]
  );
  const evidence = mapRow(evidenceResult);

  if (!evidence) {
    return res.status(404).json({ error: "Evidence not found" });
  }

  const analysis = await analyzeEvidence({
    evidenceName: evidence.evidenceName,
    evidenceType: evidence.evidenceType,
    questId: evidence.questId,
    moduleId: evidence.moduleId,
    requiredEvidence: evidence.requiredEvidence,
    filePath: evidence.filePath
  });

  const updateResult = await query(
    `UPDATE evidence 
     SET ai_contributor_comments = $1, ai_reviewer_comments = $2, 
         ai_gaps = $3, ai_suggestions = $4, ai_analyzed_at = NOW()
     WHERE id = $5 AND company_id = $6 
     RETURNING *`,
    [
      Array.isArray(analysis.contributorComments) ? analysis.contributorComments.join("\n") : analysis.contributorComments,
      analysis.reviewerComments,
      JSON.stringify(analysis.gaps || []),
      JSON.stringify(analysis.suggestions || []),
      parseInt(req.params.id),
      req.user.companyId
    ]
  );

  res.json(mapRow(updateResult));
}));

export default router;
