import { describe, test, expect } from "vitest";
import { query } from "../../db/index.js";
import { createCompany } from "../setup/helpers.js";
import { tests as purviewTests } from "../../connectors/purview/index.js";

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

  test("seeds the azure integration with oauth2 auth and its 4 Phase-1 automated tests", async () => {
    const integrationResult = await query(`SELECT * FROM integrations WHERE key = 'azure'`);
    expect(integrationResult.rows.length).toBe(1);
    expect(integrationResult.rows[0].auth_type).toBe("oauth2");
    expect(integrationResult.rows[0].status).toBe("active");

    const testsResult = await query(`SELECT test_key, severity_default FROM automated_tests WHERE integration_key = 'azure' ORDER BY test_key`);
    expect(testsResult.rows.map(r => r.test_key)).toEqual([
      "azure.logging.activity_log_diagnostics_enabled",
      "azure.network.nsg_no_open_ingress",
      "azure.security.defender_enabled",
      "azure.storage.public_access_blocked",
    ]);

    const mappingsResult = await query(`SELECT test_key, iso_reference FROM test_control_mappings WHERE test_key LIKE 'azure.%' ORDER BY test_key`);
    expect(mappingsResult.rows).toEqual([
      { test_key: "azure.logging.activity_log_diagnostics_enabled", iso_reference: "A.12.4.1" },
      { test_key: "azure.network.nsg_no_open_ingress", iso_reference: "A.13.1.1" },
      { test_key: "azure.security.defender_enabled", iso_reference: "A.12.1.1" },
      { test_key: "azure.storage.public_access_blocked", iso_reference: "A.8.2.3" },
    ]);
  });

  test("seeds the github integration with oauth2 auth and its 4 Phase-1 automated tests", async () => {
    const integrationResult = await query(`SELECT * FROM integrations WHERE key = 'github'`);
    expect(integrationResult.rows.length).toBe(1);
    expect(integrationResult.rows[0].auth_type).toBe("oauth2");
    expect(integrationResult.rows[0].status).toBe("active");

    const testsResult = await query(`SELECT test_key, severity_default FROM automated_tests WHERE integration_key = 'github' ORDER BY test_key`);
    expect(testsResult.rows.map(r => r.test_key)).toEqual([
      "github.org.two_factor_required",
      "github.repo.branch_protection_required_reviews",
      "github.repo.secret_scanning_enabled",
      "github.repo.vulnerability_alerts_enabled",
    ]);

    const mappingsResult = await query(`SELECT test_key, iso_reference FROM test_control_mappings WHERE test_key LIKE 'github.%' ORDER BY test_key`);
    expect(mappingsResult.rows).toEqual([
      { test_key: "github.org.two_factor_required", iso_reference: "A.9.4.2" },
      { test_key: "github.repo.branch_protection_required_reviews", iso_reference: "A.14.2.2" },
      { test_key: "github.repo.secret_scanning_enabled", iso_reference: "A.9.4.3" },
      { test_key: "github.repo.vulnerability_alerts_enabled", iso_reference: "A.12.6.1" },
    ]);
  });

  test("seeds the purview integration with oauth2 auth and its 8 automated tests", async () => {
    const integrationResult = await query(`SELECT * FROM integrations WHERE key = 'purview'`);
    expect(integrationResult.rows.length).toBe(1);
    expect(integrationResult.rows[0].auth_type).toBe("oauth2");
    expect(integrationResult.rows[0].status).toBe("active");

    const testsResult = await query(`SELECT test_key, severity_default FROM automated_tests WHERE integration_key = 'purview' ORDER BY test_key`);
    expect(testsResult.rows).toEqual([
      { test_key: "purview.audit.content_recently_available", severity_default: "medium" },
      { test_key: "purview.audit.dlp_alerts_available", severity_default: "high" },
      { test_key: "purview.audit.subscriptions_active", severity_default: "high" },
      { test_key: "purview.audit.unified_logging_enabled", severity_default: "critical" },
      { test_key: "purview.datamap.classification_applied", severity_default: "medium" },
      { test_key: "purview.datamap.scan_schedule_configured", severity_default: "medium" },
      { test_key: "purview.datamap.sensitivity_labels_applied", severity_default: "medium" },
      { test_key: "purview.datamap.sources_scanned", severity_default: "high" },
    ]);

    const mappingsResult = await query(`SELECT test_key, iso_reference FROM test_control_mappings WHERE test_key LIKE 'purview.%' ORDER BY test_key`);
    expect(mappingsResult.rows).toEqual([
      { test_key: "purview.audit.content_recently_available", iso_reference: "A.12.4.1" },
      { test_key: "purview.audit.dlp_alerts_available", iso_reference: "A.13.2.1" },
      { test_key: "purview.audit.subscriptions_active", iso_reference: "A.12.4.1" },
      { test_key: "purview.audit.unified_logging_enabled", iso_reference: "A.12.4.1" },
      { test_key: "purview.datamap.classification_applied", iso_reference: "A.8.2.1" },
      { test_key: "purview.datamap.scan_schedule_configured", iso_reference: "A.8.1.1" },
      { test_key: "purview.datamap.sensitivity_labels_applied", iso_reference: "A.8.2.3" },
      { test_key: "purview.datamap.sources_scanned", iso_reference: "A.8.1.1" },
    ]);
  });

  test("purview connector's own test definitions match what's seeded in init.sql (drift guardrail)", async () => {
    expect(purviewTests.length).toBe(8);

    for (const definition of purviewTests) {
      const dbTestResult = await query(
        `SELECT test_key, title, severity_default FROM automated_tests WHERE test_key = $1`,
        [definition.key]
      );
      expect(dbTestResult.rows.length).toBe(1);
      expect(dbTestResult.rows[0]).toEqual({
        test_key: definition.key,
        title: definition.title,
        severity_default: definition.severityDefault,
      });

      const dbMappingsResult = await query(
        `SELECT iso_reference FROM test_control_mappings WHERE test_key = $1 ORDER BY iso_reference`,
        [definition.key]
      );
      const dbIsoReferences = dbMappingsResult.rows.map((r) => r.iso_reference);
      expect(dbIsoReferences).toEqual([...definition.isoReferences].sort());
    }
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

  test("integration_connections defaults collection_frequency_hours to 24 and auto_collect_enabled to true", async () => {
    const company = await createCompany();
    const result = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    expect(result.rows[0].collection_frequency_hours).toBe(24);
    expect(result.rows[0].auto_collect_enabled).toBe(true);
  });

  test("evidence_collection_runs allows only one running run per connection at a time", async () => {
    const company = await createCompany();
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = conn.rows[0].id;

    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, status) VALUES ($1, $2, 'running')`,
      [company.id, connectionId]
    );

    await expect(
      query(
        `INSERT INTO evidence_collection_runs (company_id, connection_id, status) VALUES ($1, $2, 'running')`,
        [company.id, connectionId]
      )
    ).rejects.toThrow();
  });
});
