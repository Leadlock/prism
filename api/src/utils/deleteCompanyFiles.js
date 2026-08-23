import fs from "fs/promises";
import path from "path";
import { query } from "../db/index.js";

const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR || "./uploads");

function isWithinRoot(root, target) {
  const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return target.startsWith(safeRoot);
}

// Removes everything a company left on disk: its per-tenant uploads directory
// (evidence + vault attachments) and its logo, if it set one. Call this BEFORE
// deleting the company row — company_settings.logo_url disappears the moment
// that row cascades away. Best-effort: logs and continues on failure so a
// disk hiccup never blocks the (authoritative) database deletion.
export async function deleteCompanyFiles(companyId) {
  const root = uploadRoot();

  try {
    const tenantDir = path.resolve(root, String(companyId));
    if (isWithinRoot(root, tenantDir)) {
      await fs.rm(tenantDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[deleteCompanyFiles] failed to remove tenant dir for company ${companyId}:`, err.message);
  }

  try {
    const result = await query("SELECT logo_url FROM company_settings WHERE company_id = $1", [companyId]);
    const logoUrl = result.rows[0]?.logo_url;
    if (logoUrl) {
      const logoPath = path.resolve(root, path.basename(logoUrl));
      if (isWithinRoot(root, logoPath)) {
        await fs.rm(logoPath, { force: true });
      }
    }
  } catch (err) {
    console.error(`[deleteCompanyFiles] failed to remove logo for company ${companyId}:`, err.message);
  }
}
