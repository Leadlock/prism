import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn(() => ({
    key: "aws",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "123456789012" })),
    runTests: vi.fn(async () => ([
      { testKey: "aws.iam.mfa_enforced", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: {} },
    ])),
  })),
}));

const { default: app } = await import("../../app.js");

describe("GET /api/integrations/catalog", () => {
  test("lists available connector types", async () => {
    const company = await createCompany({ domain: "catalog1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const aws = res.body.find(c => c.key === "aws");
    expect(aws).toBeDefined();
    expect(aws.authType).toBe("iam_role");
    expect(aws.status).toBe("active");
  });

  test("is readable by LEAD but not by CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "catalog2.com" });
    const lead = await createUser(company.id, "LEAD");
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const leadRes = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${lead.token}`);
    expect(leadRes.status).toBe(200);

    const contributorRes = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${contributor.token}`);
    expect(contributorRes.status).toBe(403);
  });
});

describe("POST /api/integrations", () => {
  test("ADMIN can create a pending connection", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ integrationKey: "aws", name: "Prod AWS", config: { roleArn: "arn:aws:iam::123:role/PrismReadOnly", region: "us-east-1" } });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
  });

  test("VIEWER is forbidden", async () => {
    const company = await createCompany();
    const viewer = await createUser(company.id, "VIEWER");
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${viewer.token}`)
      .send({ integrationKey: "aws", name: "Prod AWS" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/integrations/:id/credentials", () => {
  test("stores a credential and marks the connection connected", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'aws', 'Prod AWS', $2) RETURNING *`,
      [company.id, JSON.stringify({ roleArn: "arn:aws:iam::123:role/PrismReadOnly" })]
    );

    const res = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("connected");
    expect(res.body.externalAccountId).toBe("123456789012");

    const credRows = await query(`SELECT ciphertext FROM integration_credentials WHERE connection_id = $1`, [conn.rows[0].id]);
    expect(credRows.rows[0].ciphertext).not.toContain("ext-1");
  });

  test("rotating credentials revokes the previously stored one", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'aws', 'Prod AWS', $2) RETURNING *`,
      [company.id, JSON.stringify({ roleArn: "arn:aws:iam::123:role/PrismReadOnly" })]
    );

    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });

    const res = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-2" } });

    expect(res.status).toBe(200);

    const credRows = await query(
      `SELECT ciphertext, revoked_at FROM integration_credentials WHERE connection_id = $1 ORDER BY created_at ASC`,
      [conn.rows[0].id]
    );
    expect(credRows.rows.length).toBe(2);
    expect(credRows.rows[0].revoked_at).not.toBeNull();
    expect(credRows.rows[0].ciphertext).toBeNull();
    expect(credRows.rows[1].revoked_at).toBeNull();
    expect(credRows.rows[1].ciphertext).not.toBeNull();
  });
});

describe("POST /api/integrations/:id/run", () => {
  test("runs a collection and returns a summary", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });

    const res = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.testsPassed).toBe(1);
  });
});

describe("DELETE /api/integrations/:id", () => {
  test("revokes the connection and crypto-shreds its credential", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });

    const res = await request(app)
      .delete(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(204);

    const credRows = await query(`SELECT ciphertext FROM integration_credentials WHERE connection_id = $1`, [conn.rows[0].id]);
    expect(credRows.rows[0].ciphertext).toBeNull();
  });

  test("company B cannot revoke company A's connection", async () => {
    const companyA = await createCompany({ domain: "a.com" });
    const companyB = await createCompany({ domain: "b.com" });
    const adminB = await createUser(companyB.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [companyA.id]
    );

    const res = await request(app)
      .delete(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${adminB.token}`);
    expect(res.status).toBe(404);
  });
});
