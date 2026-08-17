import { describe, test, expect } from "vitest";
import { getConnector, listConnectorTests } from "../connectors/registry.js";

describe("connector registry", () => {
  test("resolves the aws connector", () => {
    const connector = getConnector("aws");
    expect(connector.key).toBe("aws");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("aws connector exposes exactly the 7 tier-1 tests", () => {
    const tests = listConnectorTests("aws");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "aws.iam.access_key_age",
      "aws.iam.mfa_enforced",
      "aws.iam.password_policy",
      "aws.logging.cloudtrail_enabled",
      "aws.logging.config_enabled",
      "aws.network.s3_public_access_blocked",
      "aws.network.security_groups_no_open_ingress",
    ]);
  });

  test("throws for an unknown integration", () => {
    expect(() => getConnector("azure")).toThrow("Unknown integration: azure");
  });
});
