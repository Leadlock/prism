import { Router } from "express";
import { mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", authenticate, asyncHandler(async (req, res) => {
  // Return modules for this company, plus any global (company_id IS NULL) modules
  const result = await query(
    "SELECT * FROM modules WHERE company_id = $1 OR company_id IS NULL ORDER BY sort_order ASC, module_id ASC",
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.get("/:moduleId", authenticate, asyncHandler(async (req, res) => {
  const moduleResult = await query(
    "SELECT * FROM modules WHERE module_id = $1 AND (company_id = $2 OR company_id IS NULL)",
    [req.params.moduleId, req.user.companyId]
  );
  const module = mapRow(moduleResult);
  if (!module) {
    return res.status(404).json({ error: "Module not found" });
  }

  const questionsResult = await query(
    "SELECT * FROM questions WHERE module_id = $1 AND (company_id = $2 OR company_id IS NULL) ORDER BY quest_id ASC",
    [req.params.moduleId, req.user.companyId]
  );
  module.questions = mapRows(questionsResult);
  res.json(module);
}));

export default router;
