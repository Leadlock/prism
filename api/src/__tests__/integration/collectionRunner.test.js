import { describe, test, expect, vi } from "vitest";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { storeCredential } from "../../db/integrationCredentials.js";

const CONNECTOR_FIXTURES = {
  aws: {
    key: "aws",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "123456789012" })),
    runTests: vi.fn(async () => ([
      { testKey: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: { userName: "alice" } },
      { testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", resourceId: "bucket-1", status: "fail", message: "Public access not blocked", evidencePayload: { bucket: "bucket-1" } },
    ])),
  },
  azure: {
    key: "azure",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "sub-1" })),
    runTests: vi.fn(async () => ([
      { testKey: "azure.storage.public_access_blocked", title: "Storage accounts block public blob access", severity: "critical", resourceId: "/subscriptions/sub-1/storageAccounts/data1", status: "pass", message: "data1 blocks public blob access", evidencePayload: { accountName: "data1" } },
      { testKey: "azure.network.nsg_no_open_ingress", title: "Network security groups do not expose management ports publicly", severity: "critical", resourceId: "/subscriptions/sub-1/nsg/web", status: "fail", message: "web allows inbound access to ports 22/3389 from *", evidencePayload: { nsgName: "web" } },
    ])),
  },
  github: {
    key: "github",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "42424242" })),
    runTests: vi.fn(async () => ([
      { testKey: "github.org.two_factor_required", title: "Organization requires two-factor authentication", severity: "critical", resourceId: "acme-corp", status: "pass", message: "acme-corp requires two-factor authentication for all members", evidencePayload: { org: "acme-corp" } },
      { testKey: "github.repo.branch_protection_required_reviews", title: "Default branch requires pull request review before merging", severity: "high", resourceId: "acme-corp/api", status: "fail", message: "api has no pull request review protection configured on main", evidencePayload: { repo: "api" } },
    ])),
  },
};

vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn((integrationKey) => CONNECTOR_FIXTURES[integrationKey]),
}));

const { runCollection } = await import("../../utils/collectionRunner.js");

async function setupConnection() {
  const company = await createCompany();
  const admin = await createUser(company.id, "ADMIN");
  await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Access Control')`, [company.id]);
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.9.4.2')`,
    [company.id]
  );
  const connResult = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
    [company.id]
  );
  const connection = connResult.rows[0];
  await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "iam_role", secret: { externalId: "ext-1" } });
  return { company, admin, connection };
}

describe("runCollection", () => {
  test("records a run, generates evidence for a pass, and a finding for a fail", async () => {
    const { company, admin, connection } = await setupConnection();

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(1);

    const linkRows = await query(`SELECT * FROM question_evidence WHERE company_id = $1 AND quest_id = 'Q1'`, [company.id]);
    expect(linkRows.rows.length).toBe(1);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].status).toBe("open");
    expect(findingRows.rows[0].title).toBe("S3 buckets block public access");
    expect(findingRows.rows[0].title).not.toBe("aws.network.s3_public_access_blocked");
  });

  test("throws when there is no active credential", async () => {
    const company = await createCompany();
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'No creds') RETURNING *`,
      [company.id]
    );
    await expect(
      runCollection({ connectionId: connResult.rows[0].id, companyId: company.id, triggerType: "manual" })
    ).rejects.toThrow("No active credential for this connection");
  });

  test("re-running resolves a finding that now passes", async () => {
    const { company, connection } = await setupConnection();
    await query(
      `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title, status)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'user-1', 'critical', 'MFA not enabled', 'open')`,
      [company.id, connection.id]
    );

    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const findingRows = await query(
      `SELECT * FROM findings WHERE company_id = $1 AND test_key = 'aws.iam.mfa_enforced' AND resource_id = 'user-1'`,
      [company.id]
    );
    expect(findingRows.rows[0].status).toBe("resolved");
  });

  test("works identically for a second, differently-shaped connector (azure), proving genericity", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Network Security') `, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.8.2.3')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'azure', 'Prod Azure') RETURNING *`,
      [company.id]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "oauth2", secret: { clientId: "c1", clientSecret: "shh" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(1);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].title).toBe("Network security groups do not expose management ports publicly");
    expect(findingRows.rows[0].test_key).toBe("azure.network.nsg_no_open_ingress");
  });

  test("works identically for a third, differently-shaped connector (github), proving genericity", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Change Management')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.14.2.2')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'github', 'Prod GitHub', $2) RETURNING *`,
      [company.id, JSON.stringify({ installationId: 42, org: "acme-corp" })]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "oauth2", secret: { appId: "1", privateKey: "pem" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(1);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].title).toBe("Default branch requires pull request review before merging");
    expect(findingRows.rows[0].test_key).toBe("github.repo.branch_protection_required_reviews");
  });

  test("rejects with a 409 when a run for the same connection is already 'running'", async () => {
    const { company, admin, connection } = await setupConnection();

    // Simulate another in-flight run by inserting a 'running' row directly —
    // the partial unique index (evidence_collection_runs_running_uq) added in
    // Task 5 only allows one 'running' row per connection_id.
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, triggered_by)
       VALUES ($1, $2, 'manual', 'running', $3)`,
      [company.id, connection.id, admin.id]
    );

    let caught;
    try {
      await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.status).toBe(409);
    expect(caught.message).toBe("A collection run is already in progress for this connection");

    // Only the pre-existing 'running' row should exist — the second attempt never inserted one.
    const runRows = await query(
      `SELECT * FROM evidence_collection_runs WHERE company_id = $1 AND connection_id = $2`,
      [company.id, connection.id]
    );
    expect(runRows.rows.length).toBe(1);
    expect(runRows.rows[0].status).toBe("running");
  });
});
