import { describe, test, expect } from "vitest";
import { getConnector, listConnectorTests } from "../connectors/registry.js";

describe("connector registry", () => {
  test("resolves the aws connector", () => {
    const connector = getConnector("aws");
    expect(connector.key).toBe("aws");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("aws connector exposes exactly the 16 tier-1 tests", () => {
    const tests = listConnectorTests("aws");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "aws.dynamodb.encryption_uses_cmk",
      "aws.dynamodb.point_in_time_recovery_enabled",
      "aws.iam.access_key_age",
      "aws.iam.mfa_enforced",
      "aws.iam.password_policy",
      "aws.kms.key_rotation_enabled",
      "aws.kms.no_wildcard_key_policy",
      "aws.lambda.function_url_not_public",
      "aws.lambda.no_wildcard_resource_policy",
      "aws.logging.cloudtrail_enabled",
      "aws.logging.config_enabled",
      "aws.network.s3_public_access_blocked",
      "aws.network.security_groups_no_open_ingress",
      "aws.rds.automated_backups_enabled",
      "aws.rds.publicly_accessible",
      "aws.rds.storage_encrypted",
    ]);
  });

  test("resolves the azure connector", () => {
    const connector = getConnector("azure");
    expect(connector.key).toBe("azure");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("azure connector exposes exactly the 4 Phase-1 tests", () => {
    const tests = listConnectorTests("azure");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "azure.logging.activity_log_diagnostics_enabled",
      "azure.network.nsg_no_open_ingress",
      "azure.security.defender_enabled",
      "azure.storage.public_access_blocked",
    ]);
  });

  test("resolves the github connector", () => {
    const connector = getConnector("github");
    expect(connector.key).toBe("github");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("github connector exposes exactly the 4 Phase-1 tests", () => {
    const tests = listConnectorTests("github");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "github.org.two_factor_required",
      "github.repo.branch_protection_required_reviews",
      "github.repo.secret_scanning_enabled",
      "github.repo.vulnerability_alerts_enabled",
    ]);
  });

  test("resolves the purview connector", () => {
    const connector = getConnector("purview");
    expect(connector.key).toBe("purview");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("purview connector exposes exactly the 8 datamap + audit tests", () => {
    const tests = listConnectorTests("purview");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "purview.audit.content_recently_available",
      "purview.audit.dlp_alerts_available",
      "purview.audit.subscriptions_active",
      "purview.audit.unified_logging_enabled",
      "purview.datamap.classification_applied",
      "purview.datamap.scan_schedule_configured",
      "purview.datamap.sensitivity_labels_applied",
      "purview.datamap.sources_scanned",
    ]);
  });

  test("throws for an unknown integration", () => {
    expect(() => getConnector("gcp")).toThrow("Unknown integration: gcp");
  });

  // Guardrail: purview_compliance is a catalog-only placeholder (no connector
  // module exists for it) — assert it stays unresolvable so nobody
  // accidentally wires it up as if it were a real, testable connector.
  test("throws for purview_compliance (catalog-only placeholder, no connector module)", () => {
    expect(() => getConnector("purview_compliance")).toThrow("Unknown integration: purview_compliance");
  });
});
