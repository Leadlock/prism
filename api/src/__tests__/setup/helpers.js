import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../../db/index.js";

export async function truncateAll() {
  await query(`
    TRUNCATE
      findings, automated_evidence_items, evidence_test_results, evidence_collection_runs,
      integration_credentials, integration_connections,
      evidence_request_comments, evidence_requests,
      question_evidence, evidence_versions, evidence_vault,
      question_dependencies, module_dependencies,
      notifications, actions, assessments, evidence,
      questions, modules, invitations,
      audit_logs, auditor_profiles, reminders,
      list_items, consent_logs, company_settings,
      users, companies
    RESTART IDENTITY CASCADE
  `);
}

export async function createCompany(overrides = {}) {
  const result = await query(
    `INSERT INTO companies (name, domain, admin_email, status, billing_status, is_verified)
     VALUES ($1, $2, $3, 'active', 'active', TRUE) RETURNING *`,
    [
      overrides.name || "Test Corp",
      overrides.domain || `testcorp-${Date.now()}`,
      overrides.adminEmail || "admin@testcorp.com",
    ]
  );
  return result.rows[0];
}

export async function createUser(companyId, role, overrides = {}) {
  const email = overrides.email || `${role.toLowerCase()}-${Date.now()}@testcorp.com`;
  const hash = await bcrypt.hash(overrides.password || "Test@1234", 4);

  const result = await query(
    `INSERT INTO users (email, password_hash, full_name, role, company_id)
     VALUES ($1, $2, $3, $4::role, $5) RETURNING *`,
    [email, hash, overrides.fullName || `Test ${role}`, role, companyId]
  );
  const user = result.rows[0];

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, companyId },
    process.env.JWT_SECRET || "integration-test-secret",
    { expiresIn: "1d" }
  );

  return { ...user, token };
}
