import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { query, mapRow } from "../db/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";

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
