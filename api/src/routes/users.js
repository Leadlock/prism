import { Router } from "express";
import crypto from "crypto";
import { mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sanitiseText } from "../utils/sanitise.js";

const router = Router();

router.get("/", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const result = await query(
    "SELECT id, email, role, created_at FROM users WHERE company_id = $1 ORDER BY created_at ASC",
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.post("/invite", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const { email, role, department } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail || !role) {
    return res.status(400).json({ error: "Email and role required" });
  }
  
  if (role === "AUDITOR") {
    return res.status(400).json({ error: "AUDITOR role cannot be assigned via invite. Please use the Auditor panel to create auditors directly." });
  }
  
  const existingUser = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existingUser.rows.length > 0) {
    return res.status(400).json({ error: "User already exists" });
  }
  
  const existingInvitation = await query(
    "SELECT id FROM invitations WHERE email = $1 AND company_id = $2 AND accepted_at IS NULL",
    [normalizedEmail, req.user.companyId]
  );
  if (existingInvitation.rows.length > 0) {
    return res.status(400).json({ error: "Invitation already sent" });
  }
  
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  const dept = typeof department === "string" ? department.trim() || null : null;
  const invitationResult = await query(
    "INSERT INTO invitations (email, company_id, role, token, expires_at, department) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, role, token, expires_at, department, created_at",
    [normalizedEmail, req.user.companyId, role, token, expiresAt, dept]
  );
  const invitation = mapRow(invitationResult);

  res.status(201).json({
    invitation,
    inviteLink: `${process.env.WEB_URL || req.headers.origin || "http://localhost:5173"}/accept-invite/${token}`
  });
}));

// PUT /api/users/me — update own profile fields
router.put("/me", authenticate, asyncHandler(async (req, res) => {
  const { fullName, department, jobTitle } = req.body;
  const cleanName  = sanitiseText(fullName, 200);
  const cleanDept  = sanitiseText(department, 200);
  const cleanTitle = sanitiseText(jobTitle, 200);
  const updates = [];
  const values = [];

  if (fullName   !== undefined) { values.push(cleanName);  updates.push(`full_name = $${values.length}`); }
  if (department !== undefined) { values.push(cleanDept);  updates.push(`department = $${values.length}`); }
  if (jobTitle   !== undefined) { values.push(cleanTitle); updates.push(`job_title = $${values.length}`); }

  if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });

  values.push(new Date()); updates.push(`updated_at = $${values.length}`);
  values.push(req.user.userId);

  const result = await query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, email, role, full_name, department, job_title`,
    values
  );

  res.json(mapRow(result));
}));

router.put("/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const { role } = req.body;
  const userId = parseInt(req.params.id);
  
  if (userId === req.user.userId) {
    return res.status(400).json({ error: "Cannot change your own role" });
  }
  
  if (role === "AUDITOR") {
    return res.status(400).json({ error: "AUDITOR role cannot be assigned via role update. Please use the Auditor panel to create auditors directly." });
  }
  
  const updatedResult = await query(
    "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3 RETURNING id, email, role, created_at",
    [role, userId, req.user.companyId]
  );
  if (updatedResult.rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json(mapRow(updatedResult));
}));

router.delete("/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  
  if (userId === req.user.userId) {
    return res.status(400).json({ error: "Cannot delete yourself" });
  }
  
  const result = await query(
    "DELETE FROM users WHERE id = $1 AND company_id = $2",
    [userId, req.user.companyId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  res.status(204).send();
}));

router.get("/invitations", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const result = await query(
    "SELECT id, email, role, token, expires_at, created_at FROM invitations WHERE company_id = $1 AND accepted_at IS NULL ORDER BY created_at DESC",
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.delete("/invitations/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const invitationId = parseInt(req.params.id);
  
  const result = await query(
    "DELETE FROM invitations WHERE id = $1 AND company_id = $2",
    [invitationId, req.user.companyId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Invitation not found" });
  }

  res.status(204).send();
}));

export default router;
