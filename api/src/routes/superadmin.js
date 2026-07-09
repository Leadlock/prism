import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { query, getClient } from "../db/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deriveSortOrder } from "../utils/prismOrder.js";
import multer from "multer";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { parseExcelImport } from "../utils/excelParser.js";

const router = Router();

// Middleware: only SUPERADMIN
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== "SUPERADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};

// GET /api/superadmin/companies — list all companies with AI status
router.get("/companies", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.id, c.name, c.domain, c.admin_email, c.industry, c.company_size, c.status, c.created_at,
            c.plan, c.billing_status, c.trial_ends_at,
            COALESCE(cs.ai_enabled, true) AS ai_enabled
     FROM companies c
     LEFT JOIN company_settings cs ON cs.company_id = c.id
     ORDER BY c.created_at DESC`
  );
  res.json(result.rows);
}));

// PATCH /api/superadmin/companies/:id/status — unified status management
router.patch("/companies/:id/status", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ["approved", "rejected", "suspended"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
  }

  const result = await query(
    "UPDATE companies SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, domain, status",
    [status, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  res.json(result.rows[0]);
}));

// DELETE /api/superadmin/companies/:id — permanently delete a company and all its data
router.delete("/companies/:id", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const companyCheck = await query("SELECT id, name FROM companies WHERE id = $1", [id]);
  if (companyCheck.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }
  const companyName = companyCheck.rows[0].name;

  // Delete in dependency order (children before parent)
  await query("DELETE FROM reminders WHERE company_id = $1", [id]);
  await query("DELETE FROM actions WHERE company_id = $1", [id]);
  await query("DELETE FROM evidence WHERE company_id = $1", [id]);
  await query("DELETE FROM assessments WHERE company_id = $1", [id]);
  await query("DELETE FROM questions WHERE company_id = $1", [id]);
  await query("DELETE FROM modules WHERE company_id = $1", [id]);
  await query("DELETE FROM invitations WHERE company_id = $1", [id]);
  await query("DELETE FROM auditor_profiles WHERE company_id = $1", [id]);
  await query("DELETE FROM users WHERE company_id = $1", [id]);
  await query("DELETE FROM companies WHERE id = $1", [id]);

  res.json({ deleted: true, companyName });
}));

// PATCH /api/superadmin/companies/:id/ai-toggle — toggle AI for a company
// PATCH /api/superadmin/companies/:id/billing — set plan and/or billing_status, optionally extend trial
router.patch("/companies/:id/billing", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plan, billingStatus, trialDays } = req.body;

  const validPlans = ["lite", "pro", "enterprise"];
  const validStatuses = ["trial", "active", "expired"];

  if (plan && !validPlans.includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  if (billingStatus && !validStatuses.includes(billingStatus)) return res.status(400).json({ error: "Invalid billing status" });

  const sets = [];
  const vals = [];
  let i = 1;

  if (plan)          { sets.push(`plan = $${i++}`);           vals.push(plan); }
  if (billingStatus) { sets.push(`billing_status = $${i++}`); vals.push(billingStatus); }
  if (trialDays)     { sets.push(`trial_ends_at = NOW() + ($${i++} || ' days')::INTERVAL`); vals.push(String(trialDays)); }
  sets.push(`updated_at = NOW()`);
  vals.push(id);

  await query(`UPDATE companies SET ${sets.join(", ")} WHERE id = $${i}`, vals);

  // If upgrading to pro/enterprise, auto-enable AI
  if (plan === "pro" || plan === "enterprise") {
    await query(
      `INSERT INTO company_settings (company_id, ai_enabled)
       VALUES ($1, TRUE)
       ON CONFLICT (company_id) DO UPDATE SET ai_enabled = TRUE, updated_at = NOW()`,
      [id]
    );
  }

  const updated = await query(
    "SELECT plan, billing_status, trial_ends_at FROM companies WHERE id = $1", [id]
  );
  res.json(updated.rows[0]);
}));

// PATCH /api/superadmin/companies/:id/ai-toggle — toggle AI for a company
router.patch("/companies/:id/ai-toggle", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { aiEnabled } = req.body;

  if (typeof aiEnabled !== "boolean") {
    return res.status(400).json({ error: "aiEnabled must be a boolean" });
  }

  // Validate company exists
  const companyCheck = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyCheck.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  // Upsert company_settings
  await query(
    `INSERT INTO company_settings (company_id, ai_enabled)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET ai_enabled = $2, updated_at = NOW()`,
    [id, aiEnabled]
  );

  res.json({ companyId: parseInt(id), aiEnabled });
}));

// --- Multer Configuration ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.resolve('uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx and .xls files are allowed'));
    }
  },
});

// POST /api/superadmin/import-modules — Excel import with optional template save
router.post("/import-modules", authenticate, requireSuperAdmin, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = req.file.path;
  const { companyId, saveAsTemplate, templateName } = req.body;

  let result;
  const client = await getClient();

  try {
    // Parse the Excel file
    const parsed = parseExcelImport(filePath);

    // If no data at all and there are errors, return 400
    if (parsed.modules.length === 0 && parsed.questions.length === 0 && parsed.errors.length > 0) {
      return res.status(400).json({ errors: parsed.errors });
    }

    await client.query('BEGIN');

    let templateId = null;
    let modulesInserted = 0;
    let questionsInserted = 0;

    // Save as template if requested
    if (saveAsTemplate === 'true' || saveAsTemplate === true) {
      const tplName = templateName || req.file.originalname;
      const tpl = await client.query(
        `INSERT INTO module_templates (name, description, file_name, module_data, question_data, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tplName, '', req.file.originalname, JSON.stringify(parsed.modules), JSON.stringify(parsed.questions), req.user.userId || null]
      );
      templateId = tpl.rows[0].id;
    }

    // If companyId provided, insert modules + questions
    if (companyId) {
      for (const mod of parsed.modules) {
        const sortOrder = deriveSortOrder(mod.module_id);
        const insertResult = await client.query(
          `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (company_id, module_id) DO NOTHING
           RETURNING id`,
          [mod.module_id, companyId, mod.name, mod.primary_owner, mod.frequency, mod.total_quests, mod.purpose, sortOrder]
        );
        if (insertResult.rows.length > 0) modulesInserted++;
      }

      for (const q of parsed.questions) {
        const insertResult = await client.query(
          `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
           iso_reference, baseline_question, level3_yes_criteria, required_evidence,
           default_owner, frequency)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (company_id, quest_id) DO NOTHING
           RETURNING id`,
          [q.quest_id, companyId, q.module_id, q.module_name, q.control_area,
           q.iso_reference, q.baseline_question, q.level3_yes_criteria,
           q.required_evidence, q.default_owner, q.frequency]
        );
        if (insertResult.rows.length > 0) questionsInserted++;
      }
    }

    await client.query('COMMIT');

    result = {
      modulesImported: modulesInserted,
      questionsImported: questionsInserted,
      errors: parsed.errors,
      templateId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    // Clean up uploaded file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupErr) {
      // Silently ignore cleanup errors
    }
  }

  res.json(result);
}));

// GET /api/superadmin/templates — list all templates with module/question counts
router.get("/templates", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, description, file_name, module_data, question_data,
            jsonb_array_length(module_data) AS module_count,
            jsonb_array_length(question_data) AS question_count,
            created_at, updated_at
     FROM module_templates
     ORDER BY created_at DESC`
  );
  res.json(result.rows);
}));

// DELETE /api/superadmin/templates/:templateId — delete a template
router.delete("/templates/:templateId", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { templateId } = req.params;

  const result = await query(
    "DELETE FROM module_templates WHERE id = $1 RETURNING id",
    [templateId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Template not found" });
  }

  res.json({ deleted: true, templateId: parseInt(templateId) });
}));

// POST /api/superadmin/templates/:templateId/assign — assign template to company
router.post("/templates/:templateId/assign", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { templateId } = req.params;
  const { companyId } = req.body;

  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  // Verify template exists
  const tplResult = await query("SELECT * FROM module_templates WHERE id = $1", [templateId]);
  if (tplResult.rows.length === 0) {
    return res.status(404).json({ error: "Template not found" });
  }

  // Verify company exists
  const companyResult = await query("SELECT id FROM companies WHERE id = $1", [companyId]);
  if (companyResult.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const template = tplResult.rows[0];
  const modules = typeof template.module_data === 'string' ? JSON.parse(template.module_data) : template.module_data;
  const questions = typeof template.question_data === 'string' ? JSON.parse(template.question_data) : template.question_data;

  const client = await getClient();
  let moduleCount = 0;
  let questionCount = 0;

  try {
    await client.query('BEGIN');

    for (const mod of modules) {
      const sortOrder = deriveSortOrder(mod.module_id);
      const insertResult = await client.query(
        `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_id, module_id) DO NOTHING
         RETURNING id`,
        [mod.module_id, companyId, mod.name, mod.primary_owner, mod.frequency, mod.total_quests, mod.purpose, sortOrder]
      );
      if (insertResult.rows.length > 0) moduleCount++;
    }

    for (const q of questions) {
      const insertResult = await client.query(
        `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
         iso_reference, baseline_question, level3_yes_criteria, required_evidence,
         default_owner, frequency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (company_id, quest_id) DO NOTHING
         RETURNING id`,
        [q.quest_id, companyId, q.module_id, q.module_name, q.control_area,
         q.iso_reference, q.baseline_question, q.level3_yes_criteria,
         q.required_evidence, q.default_owner, q.frequency]
      );
      if (insertResult.rows.length > 0) questionCount++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ assigned: true, moduleCount, questionCount });
}));

// GET /api/superadmin/companies/:id/modules — list modules for a company
router.get("/companies/:id/modules", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify company exists
  const companyResult = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyResult.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const result = await query(
    `SELECT id, module_id, name, primary_owner, frequency, total_quests, purpose, sort_order, created_at
     FROM modules
     WHERE company_id = $1
     ORDER BY sort_order ASC, module_id ASC`,
    [id]
  );
  res.json(result.rows);
}));

// DELETE /api/superadmin/companies/:id/modules — delete all modules and questions for a company
router.delete("/companies/:id/modules", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const companyResult = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyResult.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM questions WHERE company_id = $1", [id]);
    await client.query("DELETE FROM modules WHERE company_id = $1", [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ deleted: true, companyId: parseInt(id) });
}));

// PATCH /api/superadmin/companies/:companyId/modules/:moduleId/order — update sort_order
router.patch("/companies/:companyId/modules/:moduleId/order", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { companyId, moduleId } = req.params;
  const { sortOrder } = req.body;

  if (sortOrder === undefined || sortOrder === null || !Number.isInteger(sortOrder) || sortOrder < 0) {
    return res.status(400).json({ error: "sortOrder must be a non-negative integer" });
  }

  const result = await query(
    `UPDATE modules SET sort_order = $1, updated_at = NOW()
     WHERE module_id = $2 AND company_id = $3
     RETURNING *`,
    [sortOrder, moduleId, companyId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Module not found" });
  }

  res.json(result.rows[0]);
}));

// POST /api/superadmin/companies/:id/modules — add single module
router.post("/companies/:id/modules", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { moduleId, name, primaryOwner, frequency, totalQuests, purpose, sortOrder } = req.body;

  if (!moduleId || !name) {
    return res.status(400).json({ error: "moduleId and name are required" });
  }

  // Check duplicate
  const existing = await query(
    "SELECT id FROM modules WHERE module_id = $1 AND company_id = $2",
    [moduleId, id]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "Module ID already exists for this company" });
  }

  const finalSortOrder = sortOrder !== undefined && sortOrder !== null ? sortOrder : deriveSortOrder(moduleId);

  const result = await query(
    `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [moduleId, id, name, primaryOwner || null, frequency || null, totalQuests || null, purpose || null, finalSortOrder]
  );

  res.status(201).json(result.rows[0]);
}));

// DELETE /api/superadmin/companies/:id/modules/:moduleId — delete single module + its questions
router.delete("/companies/:id/modules/:moduleId", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id, moduleId } = req.params;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Delete questions first
    await client.query(
      "DELETE FROM questions WHERE module_id = $1 AND company_id = $2",
      [moduleId, id]
    );

    const result = await client.query(
      "DELETE FROM modules WHERE module_id = $1 AND company_id = $2 RETURNING id",
      [moduleId, id]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Module not found" });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ deleted: true });
}));

// POST /api/superadmin/companies/:id/questions — add single question
router.post("/companies/:id/questions", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { questId, moduleId, moduleName, controlArea, isoReference, baselineQuestion, level3YesCriteria, requiredEvidence, defaultOwner, frequency } = req.body;

  if (!questId || !moduleId) {
    return res.status(400).json({ error: "questId and moduleId are required" });
  }

  // Verify module exists for company
  const moduleCheck = await query(
    "SELECT id FROM modules WHERE module_id = $1 AND company_id = $2",
    [moduleId, id]
  );
  if (moduleCheck.rows.length === 0) {
    return res.status(400).json({ error: "Module not found for this company" });
  }

  const result = await query(
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, iso_reference, baseline_question, level3_yes_criteria, required_evidence, default_owner, frequency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [questId, id, moduleId, moduleName || null, controlArea || null, isoReference || null, baselineQuestion || null, level3YesCriteria || null, requiredEvidence || null, defaultOwner || null, frequency || null]
  );

  res.status(201).json(result.rows[0]);
}));

// DELETE /api/superadmin/companies/:id/questions/:questId — delete single question
router.delete("/companies/:id/questions/:questId", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id, questId } = req.params;

  const result = await query(
    "DELETE FROM questions WHERE quest_id = $1 AND company_id = $2 RETURNING id",
    [questId, id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Question not found" });
  }

  res.json({ deleted: true });
}));

export default router;
