import { Router } from "express";
import multer from "multer";
import path from "path";
import { authenticate } from "../middleware/auth.js";
import { query, mapRow } from "../db/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";

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

const router = Router();

// GET /api/settings — get company settings
router.get("/", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.json({ logoUrl: null, primaryColor: null, aiEnabled: false });
  }

  const result = await query(
    "SELECT logo_url, primary_color, ai_enabled FROM company_settings WHERE company_id = $1",
    [companyId]
  );

  if (result.rows.length === 0) {
    return res.json({ logoUrl: null, primaryColor: null, aiEnabled: false });
  }

  const row = result.rows[0];
  res.json({
    logoUrl: row.logo_url || null,
    primaryColor: row.primary_color || null,
    aiEnabled: row.ai_enabled || false
  });
}));

// POST /api/settings/logo — upload company logo
router.post("/logo", authenticate, logoUpload.single("logo"), asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const logoUrl = `/uploads/${req.file.filename}`;

  await query(
    `INSERT INTO company_settings (company_id, logo_url)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET logo_url = $2, updated_at = NOW()`,
    [companyId, logoUrl]
  );

  res.json({ logoUrl });
}));

// GET /api/settings/tech-stack — get technology stack for this company
router.get("/tech-stack", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.json({});

  const result = await query(
    "SELECT technology_stack FROM company_settings WHERE company_id = $1",
    [companyId]
  );

  res.json(result.rows[0]?.technology_stack || {});
}));

// PUT /api/settings/tech-stack — save technology stack for this company
router.put("/tech-stack", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const stack = req.body;
  if (typeof stack !== "object" || Array.isArray(stack)) {
    return res.status(400).json({ error: "Body must be a JSON object" });
  }

  await query(
    `INSERT INTO company_settings (company_id, technology_stack)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET technology_stack = $2, updated_at = NOW()`,
    [companyId, JSON.stringify(stack)]
  );

  res.json({ saved: true });
}));

// PUT /api/settings — update company settings
router.put("/", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.status(400).json({ error: "No company context" });
  }
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin only" });
  }

  const { primaryColor, aiEnabled } = req.body;

  await query(
    `INSERT INTO company_settings (company_id, primary_color, ai_enabled) 
     VALUES ($1, $2, $3) 
     ON CONFLICT (company_id) DO UPDATE SET primary_color = $2, ai_enabled = $3, updated_at = NOW()`,
    [companyId, primaryColor || null, aiEnabled || false]
  );

  res.json({ success: true });
}));

export default router;
