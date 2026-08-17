import { describe, test, expect, vi } from "vitest";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { storeCredential } from "../../db/integrationCredentials.js";

vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn(() => ({
    key: "aws",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "123456789012" })),
    runTests: vi.fn(async () => ([
      { testKey: "aws.iam.mfa_enforced", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: { userName: "alice" } },
      { testKey: "aws.network.s3_public_access_blocked", severity: "critical", resourceId: "bucket-1", status: "fail", message: "Public access not blocked", evidencePayload: { bucket: "bucket-1" } },
    ])),
  })),
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
});
