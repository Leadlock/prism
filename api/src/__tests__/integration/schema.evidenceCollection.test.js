import { describe, test, expect } from "vitest";
import { query } from "../../db/index.js";
import { createCompany } from "../setup/helpers.js";

describe("automated evidence collection schema", () => {
  test("integrations catalog is seeded with aws", async () => {
    const result = await query(`SELECT * FROM integrations WHERE key = 'aws'`);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].auth_type).toBe("iam_role");
  });

  test("automated_tests catalog is seeded with 7 aws tests", async () => {
    const result = await query(`SELECT * FROM automated_tests WHERE integration_key = 'aws'`);
    expect(result.rows.length).toBe(7);
  });

  test("test_control_mappings links every aws test to an iso_reference", async () => {
    const result = await query(`SELECT * FROM test_control_mappings WHERE test_key LIKE 'aws.%'`);
    expect(result.rows.length).toBe(7);
  });

  test("integration_connections defaults to pending status", async () => {
    const company = await createCompany();
    const result = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    expect(result.rows[0].status).toBe("pending");
  });

  test("findings enforces unique (company_id, connection_id, test_key, resource_id)", async () => {
    const company = await createCompany();
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = conn.rows[0].id;
    await query(
      `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'user-1', 'critical', 'MFA not enabled')`,
      [company.id, connectionId]
    );
    await expect(
      query(
        `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title)
         VALUES ($1, $2, 'aws.iam.mfa_enforced', 'user-1', 'critical', 'MFA not enabled')`,
        [company.id, connectionId]
      )
    ).rejects.toThrow();
  });

  test("actions has a finding_id column", async () => {
    const result = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'actions' AND column_name = 'finding_id'
    `);
    expect(result.rows.length).toBe(1);
  });
});
