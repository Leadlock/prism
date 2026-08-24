import { describe, test, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { getConnector, listConnectorTests, listConnectorKeys } from "../connectors/registry.js";

const REGISTRY_PATH = "../connectors/registry.js";
const realReadFileSync = fs.readFileSync;

// Builds an `fs` mock factory whose `readFileSync` rewrites just the named
// connector's connector.json (via `transformManifest`) and delegates every
// other read straight to the real filesystem.
function mockManifestFor(connectorKey, transformManifest) {
  const manifestSuffix = path.join(connectorKey, "connector.json");
  vi.doMock("fs", async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      default: {
        ...actual.default,
        readFileSync: (filePath, ...args) => {
          if (typeof filePath === "string" && filePath.endsWith(manifestSuffix)) {
            const manifest = JSON.parse(realReadFileSync(filePath, "utf8"));
            transformManifest(manifest);
            return JSON.stringify(manifest);
          }
          return realReadFileSync(filePath, ...args);
        },
      },
    };
  });
}

describe("connector registry", () => {
  test("resolves the aws connector", () => {
    const connector = getConnector("aws");
    expect(connector.key).toBe("aws");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("aws connector exposes the expected tests (spot-check key namespaces)", () => {
    const tests = listConnectorTests("aws");
    expect(tests.length).toBeGreaterThan(16);
    const keys = tests.map((t) => t.key);
    // Core namespaces always present
    expect(keys).toContain("aws.iam.mfa_enforced");
    expect(keys).toContain("aws.iam.password_policy");
    expect(keys).toContain("aws.iam.access_key_age");
    expect(keys).toContain("aws.logging.cloudtrail_enabled");
    expect(keys).toContain("aws.logging.config_enabled");
    expect(keys).toContain("aws.network.s3_public_access_blocked");
    expect(keys).toContain("aws.network.security_groups_no_open_ingress");
    expect(keys).toContain("aws.kms.key_rotation_enabled");
    expect(keys).toContain("aws.rds.storage_encrypted");
    expect(keys).toContain("aws.lambda.function_url_not_public");
    expect(keys).toContain("aws.dynamodb.encryption_uses_cmk");
  });

  test("resolves the azure connector", () => {
    const connector = getConnector("azure");
    expect(connector.key).toBe("azure");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("azure connector exposes exactly the expected tests (Phase-1 plus SQL/Key Vault/Monitor/Policy/Compute/Subscription)", () => {
    const tests = listConnectorTests("azure");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "azure.compute.disk_encryption_enabled",
      "azure.compute.no_public_ip_association",
      "azure.keyvault.purge_protection_enabled",
      "azure.keyvault.rbac_authorization_enabled",
      "azure.logging.activity_log_diagnostics_enabled",
      "azure.monitor.diagnostic_settings_cover_key_resources",
      "azure.network.nsg_no_open_ingress",
      "azure.policy.assignments_compliant",
      "azure.security.defender_enabled",
      "azure.sql.auditing_enabled",
      "azure.sql.public_network_access_disabled",
      "azure.sql.transparent_data_encryption_enabled",
      "azure.storage.public_access_blocked",
      "azure.subscription.limited_owner_assignments",
      "azure.subscription.no_classic_administrators",
    ]);
  });

  test("resolves the github connector", () => {
    const connector = getConnector("github");
    expect(connector.key).toBe("github");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("github connector exposes exactly the 9 tests", () => {
    const tests = listConnectorTests("github");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "github.org.actions_default_workflow_permissions_readonly",
      "github.org.actions_third_party_restricted",
      "github.org.default_repository_permission_restricted",
      "github.org.owners_count_minimized",
      "github.org.two_factor_required",
      "github.repo.branch_protection_required_reviews",
      "github.repo.code_scanning_default_setup_enabled",
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

  test("resolves the zoho connector", () => {
    const connector = getConnector("zoho");
    expect(connector.key).toBe("zoho");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("zoho connector exposes exactly the 42 tier-1 tests", () => {
    const tests = listConnectorTests("zoho");
    expect(tests).toHaveLength(42);
    const keys = tests.map((t) => t.key).sort();
    // Spot-check one key per product
    expect(keys).toContain("zoho.directory.mfa_enforced");
    expect(keys).toContain("zoho.crm.audit_log_enabled");
    expect(keys).toContain("zoho.workdrive.external_sharing_restricted");
    expect(keys).toContain("zoho.analytics.public_view_link_restricted");
    expect(keys).toContain("zoho.recruit.job_posting_visibility_review");
  });

  test("resolves the entra_id connector", () => {
    const connector = getConnector("entra_id");
    expect(connector.key).toBe("entra_id");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("entra_id connector exposes exactly the 15 tests", () => {
    const tests = listConnectorTests("entra_id");
    expect(tests).toHaveLength(15);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toContain("entra_id.mfa.conditional_access_enforced");
    expect(keys).toContain("entra_id.audit.signin_and_directory_logs_available");
    expect(keys).toContain("entra_id.appregistrations.credentials_not_expiring_soon");
    expect(keys).toContain("entra_id.groups.privileged_groups_have_owners");
    expect(keys).toContain("entra_id.users.mfa_registration_reviewed");
    expect(keys).toContain("entra_id.roles.privileged_users_mfa_registered");
    expect(keys).toContain("entra_id.roles.other_privileged_roles_reviewed");
    expect(keys).toContain("entra_id.signins.legacy_auth_signins_absent");
    expect(keys).toContain("entra_id.signins.risky_signins_resolved");
    expect(keys).toContain("entra_id.audit.privileged_role_changes_actor_captured");
  });

  test("resolves the microsoft_365 connector", () => {
    const connector = getConnector("microsoft_365");
    expect(connector.key).toBe("microsoft_365");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("microsoft_365 connector exposes exactly the 9 tests", () => {
    const tests = listConnectorTests("microsoft_365");
    expect(tests).toHaveLength(9);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toContain("microsoft_365.exchange.mailbox_audit_logging_enabled");
    expect(keys).toContain("microsoft_365.sharepoint.external_sharing_restricted");
    expect(keys).toContain("microsoft_365.sharepoint.dlp_policy_configured");
    expect(keys).toContain("microsoft_365.sharepoint.sensitivity_label_policy_enforced");
    expect(keys).toContain("microsoft_365.intune.compliance_policy_assigned_all_platforms");
    expect(keys).toContain("microsoft_365.defenderoffice.safe_links_enabled");
  });

  test("resolves the microsoft_teams connector", () => {
    const connector = getConnector("microsoft_teams");
    expect(connector.key).toBe("microsoft_teams");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("microsoft_teams connector exposes exactly the 8 tests", () => {
    const tests = listConnectorTests("microsoft_teams");
    expect(tests).toHaveLength(8);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toContain("microsoft_teams.externalaccess.federation_domains_restricted");
    expect(keys).toContain("microsoft_teams.client.unsanctioned_storage_providers_disabled");
    expect(keys).toContain("microsoft_teams.policies.meeting_anonymous_join_restricted");
  });

  test("resolves the google_workspace connector", () => {
    const connector = getConnector("google_workspace");
    expect(connector.key).toBe("google_workspace");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("google_workspace connector exposes exactly the 10 tests", () => {
    const tests = listConnectorTests("google_workspace");
    expect(tests).toHaveLength(10);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "google_workspace.admin.super_admin_role_reviewed",
      "google_workspace.audit.log_retention_configured",
      "google_workspace.calendar.external_sharing_restricted",
      "google_workspace.devices.chrome_policy_compliant",
      "google_workspace.drive.external_sharing_restricted",
      "google_workspace.gmail.auto_forwarding_restricted",
      "google_workspace.groups.privileged_group_membership_reviewed",
      "google_workspace.oauth.third_party_app_risk_reviewed",
      "google_workspace.security.two_step_verification_enforced",
      "google_workspace.users.inactive_accounts_reviewed",
    ]);
  });

  test("resolves the gcp connector", () => {
    const connector = getConnector("gcp");
    expect(connector.key).toBe("gcp");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("gcp connector exposes exactly the 10 tests", () => {
    const tests = listConnectorTests("gcp");
    expect(tests).toHaveLength(10);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "gcp.compute.instances_no_public_ip",
      "gcp.compute.shielded_vm_enabled",
      "gcp.iam.owner_role_assignments_limited",
      "gcp.iam.service_account_keys_rotated",
      "gcp.kms.key_rotation_enabled",
      "gcp.logging.data_access_audit_logs_enabled",
      "gcp.network.firewall_no_open_management_ports",
      "gcp.sql.public_access_disabled",
      "gcp.sql.ssl_enforced",
      "gcp.storage.buckets_not_publicly_accessible",
    ]);
  });

  test("resolves the microsoft_defender connector", () => {
    const connector = getConnector("microsoft_defender");
    expect(connector.key).toBe("microsoft_defender");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("microsoft_defender connector exposes exactly the 7 tests", () => {
    const tests = listConnectorTests("microsoft_defender");
    expect(tests).toHaveLength(7);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toContain("microsoft_defender.devices.onboarding_coverage_complete");
    expect(keys).toContain("microsoft_defender.vulnerabilities.critical_cves_remediated");
    expect(keys).toContain("microsoft_defender.alerts.high_severity_triaged_promptly");
  });

  // Findings are only ever created from a failing test result (see
  // collectionRunner.js's upsertFinding), so a check's positive `title` (e.g.
  // "MFA is enabled") reads backwards once it becomes a finding. Every check,
  // across every connector, must carry a distinct `failTitle` describing the
  // actual violation so the Findings list reads correctly.
  test("every connector's checks define a failTitle distinct from their (positive) title", () => {
    for (const connectorKey of listConnectorKeys()) {
      for (const definition of listConnectorTests(connectorKey)) {
        expect(definition.failTitle, `${connectorKey}/${definition.key} is missing a failTitle`).toBeTruthy();
        expect(definition.failTitle, `${connectorKey}/${definition.key}'s failTitle matches its title`).not.toBe(definition.title);
      }
    }
  });

  test("throws for an unknown integration", () => {
    expect(() => getConnector("digitalocean")).toThrow("Unknown integration: digitalocean");
  });

  // Guardrail: purview_compliance is a catalog-only placeholder (no connector
  // module exists for it) — assert it stays unresolvable so nobody
  // accidentally wires it up as if it were a real, testable connector.
  test("throws for purview_compliance (catalog-only placeholder, no connector module)", () => {
    expect(() => getConnector("purview_compliance")).toThrow("Unknown integration: purview_compliance");
  });
});

describe("connector manifest validation (connector.json vs. JS tests)", () => {
  afterEach(() => {
    vi.doUnmock("fs");
    vi.resetModules();
  });

  test("loads cleanly when every connector's manifest matches its JS tests", async () => {
    vi.resetModules();
    await expect(import(REGISTRY_PATH)).resolves.toBeDefined();
  });

  test("throws when a manifest is missing a test key present in the JS tests array", async () => {
    vi.resetModules();
    mockManifestFor("azure", (manifest) => {
      manifest.tests = manifest.tests.filter((t) => t.testKey !== "azure.security.defender_enabled");
    });

    await expect(import(REGISTRY_PATH)).rejects.toThrow(/azure.*azure\.security\.defender_enabled/s);
  });

  test("throws when a manifest has an extra test key not present in the JS tests array", async () => {
    vi.resetModules();
    mockManifestFor("github", (manifest) => {
      manifest.tests.push({
        testKey: "github.repo.nonexistent_check",
        title: "Bogus test not defined in JS",
        severityDefault: "low",
        isoReferences: [],
      });
    });

    await expect(import(REGISTRY_PATH)).rejects.toThrow(/github.*github\.repo\.nonexistent_check/s);
  });
});
