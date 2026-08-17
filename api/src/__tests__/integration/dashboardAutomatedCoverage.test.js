import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

describe("GET /api/dashboard — automatedCoverage", () => {
  test("counts distinct controls satisfied by at least one fresh automated evidence item", async () => {
    const company = await createCompany({ domain: "dashauto1.com" });
    const admin = await createUser(company.id, "ADMIN");

    // One question mapped to a test with fresh automated evidence
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'Q1', 'M1', 'MFA enforced?', 'A.9.4.2', 'Access control')`,
      [company.id]
    );
    // A second question with no automated coverage at all
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'Q2', 'M1', 'Backups tested?', 'A.17.1.3', 'Continuity')`,
      [company.id]
    );

    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'fresh', NOW())`,
      [company.id, connRes.rows[0].id]
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.automatedCoverage.count).toBe(1);
    expect(res.body.automatedCoverage.total).toBe(2);
  });

  test("does not count a stale automated evidence item", async () => {
    const company = await createCompany({ domain: "dashauto2.com" });
    const admin = await createUser(company.id, "ADMIN");

    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'Q1', 'M1', 'MFA enforced?', 'A.9.4.2', 'Access control')`,
      [company.id]
    );
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'stale', NOW())`,
      [company.id, connRes.rows[0].id]
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.automatedCoverage.count).toBe(0);
    expect(res.body.automatedCoverage.total).toBe(1);
  });
});
