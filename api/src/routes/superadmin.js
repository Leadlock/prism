import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { query, getClient } from "../db/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deriveSortOrder } from "../utils/prismOrder.js";
import multer from "multer";
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
    `SELECT c.id, c.name, c.domain, c.admin_email, c.industry, c.company_size, c.status, c.is_verified, c.created_at,
            c.plan, c.billing_status, c.trial_ends_at,
            COALESCE(cs.ai_enabled, true) AS ai_enabled,
            c.template_id,
            mt.name AS template_name
     FROM companies c
     LEFT JOIN company_settings cs ON cs.company_id = c.id
     LEFT JOIN module_templates mt ON mt.id = c.template_id
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
    `UPDATE companies
     SET status = $1, is_verified = ($1 = 'approved'), updated_at = NOW()
     WHERE id = $2 RETURNING id, name, domain, status, template_id`,
    [status, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const company = result.rows[0];

  // When approving, reset onboarding so dept selection runs on next login
  if (status === "approved") {
    await query(
      "UPDATE users SET onboarding_completed = FALSE, updated_at = NOW() WHERE company_id = $1 AND role = 'ADMIN'",
      [id]
    );
  }

  // Auto-provision template when approving a company that has one assigned
  let templateProvisioned = false;
  if (status === "approved" && company.template_id) {
    const tplResult = await query("SELECT * FROM module_templates WHERE id = $1", [company.template_id]);
    if (tplResult.rows.length > 0) {
      const template = tplResult.rows[0];
      const modules = typeof template.module_data === "string" ? JSON.parse(template.module_data) : template.module_data;
      const questions = typeof template.question_data === "string" ? JSON.parse(template.question_data) : template.question_data;
      const tplClient = await getClient();
      try {
        await tplClient.query("BEGIN");
        for (const mod of modules) {
          const sortOrder = deriveSortOrder(mod.module_id);
          await tplClient.query(
            `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (company_id, module_id) DO NOTHING`,
            [mod.module_id, company.id, mod.name, mod.primary_owner, mod.frequency, mod.total_quests, mod.purpose, sortOrder]
          );
        }
        for (const q of questions) {
          await tplClient.query(
            `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
             iso_reference, baseline_question, level3_yes_criteria, required_evidence,
             default_owner, frequency, priority, tags)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (company_id, quest_id) DO NOTHING`,
            [q.quest_id, company.id, q.module_id, q.module_name, q.control_area,
             q.iso_reference, q.baseline_question, q.level3_yes_criteria,
             q.required_evidence, q.default_owner, q.frequency, normPriority(q.priority), q.tags || null]
          );
        }
        await tplClient.query("COMMIT");
        templateProvisioned = true;
      } catch (err) {
        await tplClient.query("ROLLBACK");
        console.error("[superadmin] Template provisioning failed:", err.message);
      } finally {
        tplClient.release();
      }
    }
  }

  res.json({ ...company, templateProvisioned });
}));

// PATCH /api/superadmin/companies/:id/unapprove — revoke verification without changing status
router.patch("/companies/:id/unapprove", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    `UPDATE companies SET is_verified = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, name, domain, status`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  res.json({ ...result.rows[0], isVerified: false });
}));

// PATCH /api/superadmin/companies/:id/start-onboarding — wipe dept data + reset onboarding flag (fresh start)
router.patch("/companies/:id/start-onboarding", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM questions WHERE company_id = $1 AND quest_id LIKE 'dept-%'", [id]);
    await client.query("DELETE FROM modules WHERE company_id = $1 AND module_id LIKE 'dept-%'", [id]);
    await client.query(
      "UPDATE users SET onboarding_completed = FALSE, updated_at = NOW() WHERE company_id = $1 AND role = 'ADMIN'",
      [id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ started: true });
}));

// PATCH /api/superadmin/companies/:id/reset-onboarding — re-show policy onboarding for this company's admin(s)
router.patch("/companies/:id/reset-onboarding", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    "UPDATE users SET onboarding_completed = FALSE, updated_at = NOW() WHERE company_id = $1 AND role = 'ADMIN' RETURNING id",
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "No admin users found for this company" });
  }

  res.json({ reset: true, usersUpdated: result.rows.length });
}));

// DELETE /api/superadmin/companies/:id — permanently delete a company and all its data
router.delete("/companies/:id", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const companyCheck = await query("SELECT id, name FROM companies WHERE id = $1", [id]);
  if (companyCheck.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }
  const companyName = companyCheck.rows[0].name;

  // Delete in dependency order inside a transaction so partial failure leaves no orphans
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM reminders WHERE company_id = $1", [id]);
    await client.query("DELETE FROM actions WHERE company_id = $1", [id]);
    await client.query("DELETE FROM evidence WHERE company_id = $1", [id]);
    await client.query("DELETE FROM assessments WHERE company_id = $1", [id]);
    await client.query("DELETE FROM questions WHERE company_id = $1", [id]);
    await client.query("DELETE FROM modules WHERE company_id = $1", [id]);
    await client.query("DELETE FROM invitations WHERE company_id = $1", [id]);
    await client.query("DELETE FROM auditor_profiles WHERE company_id = $1", [id]);
    await client.query("DELETE FROM users WHERE company_id = $1", [id]);
    await client.query("DELETE FROM companies WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

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

// --- Logo multer (for company branding) ---
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || "./uploads"),
  filename: (req, file, cb) => {
    const suffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "logo-" + suffix + path.extname(file.originalname));
  }
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});

// POST /api/superadmin/companies/:id/logo — upload logo for a specific company
router.post("/companies/:id/logo", authenticate, requireSuperAdmin, logoUpload.single("logo"), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const logoUrl = `/uploads/${req.file.filename}`;
  await query(
    `INSERT INTO company_settings (company_id, logo_url)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET logo_url = $2, updated_at = NOW()`,
    [id, logoUrl]
  );
  res.json({ logoUrl });
}));

// PUT /api/superadmin/companies/:id/settings — update branding settings for a company
router.put("/companies/:id/settings", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const { primaryColor } = req.body;
  await query(
    `INSERT INTO company_settings (company_id, primary_color)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET primary_color = $2, updated_at = NOW()`,
    [id, primaryColor || null]
  );
  res.json({ success: true });
}));

// GET /api/superadmin/companies/:id/settings — get branding for a company
router.get("/companies/:id/settings", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const result = await query(
    "SELECT logo_url, primary_color FROM company_settings WHERE company_id = $1",
    [id]
  );
  const row = result.rows[0];
  res.json({ logoUrl: row?.logo_url || null, primaryColor: row?.primary_color || null });
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
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'));
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
    const parsed = await parseExcelImport(filePath);

    const wantsTemplateOnly = (saveAsTemplate === 'true' || saveAsTemplate === true) && !companyId;

    // If no data at all and there are errors, and we're not just saving a template, return 400
    if (!wantsTemplateOnly && parsed.modules.length === 0 && parsed.questions.length === 0 && parsed.errors.length > 0) {
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
           default_owner, frequency, priority, tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (company_id, quest_id) DO NOTHING
           RETURNING id`,
          [q.quest_id, companyId, q.module_id, q.module_name, q.control_area,
           q.iso_reference, q.baseline_question, q.level3_yes_criteria,
           q.required_evidence, q.default_owner, q.frequency, normPriority(q.priority), q.tags || null]
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

// POST /api/superadmin/preview-import — parse Excel and return mapping preview without inserting
router.post("/preview-import", authenticate, requireSuperAdmin, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const filePath = req.file.path;
  try {
    const parsed = await parseExcelImport(filePath);
    res.json({
      modules: parsed.modules,
      questions: parsed.questions,
      errors: parsed.errors,
      totalModules: parsed.modules.length,
      totalQuestions: parsed.questions.length,
    });
  } finally {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
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
         default_owner, frequency, priority, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (company_id, quest_id) DO NOTHING
         RETURNING id`,
        [q.quest_id, companyId, q.module_id, q.module_name, q.control_area,
         q.iso_reference, q.baseline_question, q.level3_yes_criteria,
         q.required_evidence, q.default_owner, q.frequency, normPriority(q.priority), q.tags || null]
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

  // Track which template was assigned to this company
  await query("UPDATE companies SET template_id = $1, updated_at = NOW() WHERE id = $2", [templateId, companyId]);

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

const VALID_PRIORITIES = ["Critical", "High", "Medium", "Low"];
const normPriority = (p) => (VALID_PRIORITIES.includes(p) ? p : "Medium");

// GET /api/superadmin/companies/:id/questions — list questions for a company
router.get("/companies/:id/questions", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const companyCheck = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyCheck.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const result = await query(
    `SELECT q.*,
       COALESCE((
         SELECT COUNT(*)::INT FROM question_dependencies qd
         WHERE qd.company_id = $1 AND qd.quest_id = q.quest_id
       ), 0) AS dependency_count
     FROM questions q
     WHERE q.company_id = $1
     ORDER BY q.quest_id ASC`,
    [id]
  );

  res.json(result.rows);
}));

// POST /api/superadmin/companies/:id/questions — add single question
router.post("/companies/:id/questions", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { questId, moduleId, moduleName, controlArea, isoReference, baselineQuestion, level3YesCriteria, requiredEvidence, defaultOwner, frequency, priority, tags, dueDate } = req.body;

  if (!questId || !moduleId) {
    return res.status(400).json({ error: "questId and moduleId are required" });
  }

  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` });
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
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, iso_reference, baseline_question, level3_yes_criteria, required_evidence, default_owner, frequency, priority, tags, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [questId, id, moduleId, moduleName || null, controlArea || null, isoReference || null, baselineQuestion || null, level3YesCriteria || null, requiredEvidence || null, defaultOwner || null, frequency || null, normPriority(priority), tags || null, dueDate || null]
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

// GET /api/superadmin/companies/:id/questions/:questId/dependencies
router.get("/companies/:id/questions/:questId/dependencies", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id, questId } = req.params;

  const result = await query(
    `WITH q_info AS (
       SELECT DISTINCT ON (quest_id) quest_id, control_area, module_id
       FROM questions
       WHERE company_id = $1 OR company_id IS NULL
       ORDER BY quest_id ASC, company_id ASC NULLS LAST
     )
     SELECT
       qd.depends_on_quest_id AS dep_quest_id,
       qi.control_area,
       qi.module_id
     FROM question_dependencies qd
     LEFT JOIN q_info qi ON qi.quest_id = qd.depends_on_quest_id
     WHERE qd.company_id = $1 AND qd.quest_id = $2
     ORDER BY qd.depends_on_quest_id ASC`,
    [id, questId]
  );

  res.json(result.rows.map(row => ({
    questId: row.dep_quest_id,
    controlArea: row.control_area,
    moduleId: row.module_id,
  })));
}));

// PUT /api/superadmin/companies/:id/questions/:questId/dependencies
router.put("/companies/:id/questions/:questId/dependencies", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id, questId } = req.params;
  const { dependsOn = [] } = req.body;

  if (!Array.isArray(dependsOn)) {
    return res.status(400).json({ error: "dependsOn must be an array of quest IDs" });
  }

  const uniqueDeps = [...new Set(dependsOn)];

  if (uniqueDeps.includes(questId)) {
    return res.status(400).json({ error: "A question cannot depend on itself" });
  }

  const questCheck = await query(
    "SELECT 1 FROM questions WHERE quest_id = $1 AND company_id = $2 LIMIT 1",
    [questId, id]
  );
  if (questCheck.rows.length === 0) {
    return res.status(404).json({ error: "Question not found" });
  }

  for (const depId of uniqueDeps) {
    const depCheck = await query(
      "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
      [depId, id]
    );
    if (depCheck.rows.length === 0) {
      return res.status(400).json({ error: `Dependency question not found: ${depId}` });
    }
  }

  if (uniqueDeps.length > 0) {
    const cycleResult = await query(
      `WITH RECURSIVE reachable AS (
         SELECT unnest($2::text[]) AS q
         UNION
         SELECT qd.depends_on_quest_id
         FROM question_dependencies qd
         INNER JOIN reachable r ON r.q = qd.quest_id
         WHERE qd.company_id = $1 AND qd.quest_id != $3
       )
       SELECT 1 FROM reachable WHERE q = $3 LIMIT 1`,
      [id, uniqueDeps, questId]
    );
    if (cycleResult.rows.length > 0) {
      return res.status(400).json({ error: "Circular dependency detected: the requested dependencies would create a cycle" });
    }
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM question_dependencies WHERE company_id = $1 AND quest_id = $2",
      [id, questId]
    );
    for (const depId of uniqueDeps) {
      await client.query(
        "INSERT INTO question_dependencies (company_id, quest_id, depends_on_quest_id) VALUES ($1, $2, $3)",
        [id, questId, depId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ questId, dependsOn: uniqueDeps });
}));

export default router;
