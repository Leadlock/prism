import { query } from "../db/index.js";

/**
 * Resolve the per-company AI provider override.
 *
 * Returns the stored provider name ('bedrock' | 'azure') or null when the
 * company has no override, in which case callers should let aiProvider.js fall
 * back to the platform default (PRISM_AI_PROVIDER).
 */
export async function getCompanyAiProvider(companyId) {
  const result = await query(
    "SELECT ai_provider FROM company_settings WHERE company_id = $1",
    [companyId]
  );
  return result.rows[0]?.ai_provider || null;
}
