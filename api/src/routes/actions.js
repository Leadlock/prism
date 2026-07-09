import { Router } from "express";
import { buildUpdate, mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = Router();

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "VIEWER"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "actions", ip: req.ip });
  }
  const { questId, status } = req.query;
  const conditions = ["company_id = $1"];
  const values = [req.user.companyId];

  if (questId) {
    values.push(questId);
    conditions.push(`quest_id = $${values.length}`);
  }

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const result = await query(
    `SELECT *,
      CASE WHEN due_date IS NOT NULL AND due_date < NOW() AND COALESCE(UPPER(status), 'OPEN') NOT IN ('CLOSED', 'DONE', 'COMPLETED') THEN true ELSE false END AS is_overdue
     FROM actions WHERE ${conditions.join(" AND ")}
     ORDER BY
       CASE WHEN due_date IS NOT NULL AND due_date < NOW() AND COALESCE(UPPER(status),'OPEN') NOT IN ('CLOSED','DONE','COMPLETED') THEN 0 ELSE 1 END,
       due_date ASC NULLS LAST,
       created_at DESC`,
    values
  );
  res.json(mapRows(result));
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const {
    actionId,
    month,
    moduleId,
    questId,
    defeatedQuest,
    currentLevel,
    targetLevel,
    immediateActionRequired,
    owner,
    dueDate,
    status,
    closureEvidenceLink,
    reviewer,
    closureDate,
    notes
  } = req.body;

  const result = await query(
    "INSERT INTO actions (action_id, month, module_id, quest_id, company_id, defeated_quest, current_level, target_level, immediate_action_required, owner, due_date, status, closure_evidence_link, reviewer, closure_date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *",
    [
      actionId || null,
      month || null,
      moduleId || null,
      questId || null,
      req.user.companyId,
      defeatedQuest || null,
      currentLevel ?? null,
      targetLevel ?? null,
      immediateActionRequired ?? null,
      owner || null,
      dueDate || null,
      status || null,
      closureEvidenceLink || null,
      reviewer || null,
      closureDate || null,
      notes || null
    ]
  );

  res.status(201).json(mapRow(result));
}));

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const data = {
    action_id: req.body.actionId,
    month: req.body.month,
    module_id: req.body.moduleId,
    quest_id: req.body.questId,
    defeated_quest: req.body.defeatedQuest,
    current_level: req.body.currentLevel,
    target_level: req.body.targetLevel,
    immediate_action_required: req.body.immediateActionRequired,
    owner: req.body.owner,
    due_date: req.body.dueDate,
    status: req.body.status,
    closure_evidence_link: req.body.closureEvidenceLink,
    reviewer: req.body.reviewer,
    closure_date: req.body.closureDate,
    notes: req.body.notes,
    updated_at: new Date()
  };

  const hasUpdates = Object.keys(data).some((key) => key !== "updated_at" && data[key] !== undefined);
  if (!hasUpdates) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const update = buildUpdate(data);
  const actionResult = await query(
    `UPDATE actions SET ${update.set} WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING *`,
    [...update.values, parseInt(req.params.id), req.user.companyId]
  );

  if (actionResult.rows.length === 0) {
    return res.status(404).json({ error: "Action not found" });
  }

  res.json(mapRow(actionResult));
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    "DELETE FROM actions WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Action not found" });
  }
  res.status(204).send();
}));

export default router;
