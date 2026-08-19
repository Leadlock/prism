import { describe, test, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { signGithubAppState, verifyGithubAppState } from "../../utils/githubAppState.js";
import { getActiveCredential, storeCredential } from "../../db/integrationCredentials.js";

const CONNECTOR_FIXTURES = {
  aws: {
    key: "aws",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "123456789012" })),
    runTests: vi.fn(async () => ([
      { testKey: "aws.iam.mfa_enforced", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: {} },
    ])),
  },
  github: {
    key: "github",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "42424242" })),
    runTests: vi.fn(async () => ([])),
  },
};

vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn((integrationKey) => CONNECTOR_FIXTURES[integrationKey]),
}));

// GET /github/install-callback resolves the org login via an App-level (JWT)
// Octokit lookup — mocked here so the suite never makes a real GitHub API call.
const getInstallation = vi.fn(async () => ({ data: { account: { login: "acme-corp" } } }));
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn(() => vi.fn(async () => ({ token: "fake-app-jwt" }))),
}));
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    this.rest = { apps: { getInstallation } };
  }),
}));

// GET /aws/setup-info calls real STS via the SDK's default credential chain —
// mocked here so the test suite never depends on (or accidentally hits) a real
// AWS account, regardless of what's in the host/CI environment.
const stsSend = vi.fn();
vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: vi.fn(() => ({ send: stsSend })),
  GetCallerIdentityCommand: vi.fn(),
  AssumeRoleCommand: vi.fn(),
}));

const originalFetch = global.fetch;

const { default: app } = await import("../../app.js");

describe("GET /api/integrations/aws/setup-info", () => {
  test("returns the resolved principal ARN and the read-only permissions policy", async () => {
    stsSend.mockResolvedValueOnce({ Arn: "arn:aws:iam::999999999999:role/prism-backend" });
    const company = await createCompany({ domain: "setupinfo1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/aws/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.principalArn).toBe("arn:aws:iam::999999999999:role/prism-backend");
    expect(res.body.principalError).toBeNull();
    expect(res.body.permissionsPolicy.Statement[0].Action).toContain("iam:ListUsers");
    expect(res.body.permissionsPolicy.Statement[0].Action).toContain("s3:GetBucketPublicAccessBlock");
  });

  test("returns a null principal with an explanatory error when STS is unreachable, but still returns the policy", async () => {
    stsSend.mockRejectedValueOnce(new Error("Could not load credentials from any providers"));
    const company = await createCompany({ domain: "setupinfo2.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/aws/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.principalArn).toBeNull();
    expect(res.body.principalError).toMatch(/no AWS credentials configured/i);
    expect(res.body.permissionsPolicy.Statement[0].Action).toContain("ec2:DescribeSecurityGroups");
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "setupinfo3.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/aws/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/azure/setup-info", () => {
  test("returns a static least-privilege role definition, no live Azure call needed", async () => {
    const company = await createCompany({ domain: "azuresetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/azure/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.roleDefinition.properties.roleName).toBe("Prism Read-Only Evidence Collection");
    const actions = res.body.roleDefinition.properties.permissions[0].actions;
    expect(actions).toContain("Microsoft.Storage/storageAccounts/read");
    expect(actions).toContain("Microsoft.Network/networkSecurityGroups/read");
    expect(actions).toContain("Microsoft.Security/pricings/read");
    expect(actions).toContain("Microsoft.Insights/diagnosticSettings/read");
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "azuresetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/azure/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/:id/github/setup-info", () => {
  test("returns a manifest scoped to this connection and a signed state token", async () => {
    const company = await createCompany({ domain: "githubsetup1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;

    const res = await request(app).get(`/api/integrations/${connectionId}/github/setup-info`).set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.manifest.public).toBe(false);
    expect(res.body.manifest.default_permissions).toEqual({
      organization_administration: "read",
      administration: "read",
      metadata: "read",
    });
    expect(res.body.manifest.hook_attributes.active).toBe(false);
    expect(res.body.manifest.setup_url).toBe(`http://localhost:4000/api/integrations/github/install-callback`);
    expect(typeof res.body.state).toBe("string");

    const decoded = verifyGithubAppState(res.body.state);
    expect(decoded).toEqual({ connectionId, companyId: company.id });
  });

  test("404s for a connection belonging to a different company", async () => {
    const companyA = await createCompany({ domain: "githubsetup2.com" });
    const companyB = await createCompany({ domain: "githubsetup3.com" });
    const adminB = await createUser(companyB.id, "ADMIN");
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Not yours') RETURNING *`,
      [companyA.id]
    );

    const res = await request(app).get(`/api/integrations/${connResult.rows[0].id}/github/setup-info`).set("Authorization", `Bearer ${adminB.token}`);
    expect(res.status).toBe(404);
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "githubsetup4.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'X') RETURNING *`,
      [company.id]
    );

    const res = await request(app).get(`/api/integrations/${connResult.rows[0].id}/github/setup-info`).set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });

  // This route mints the `state` token that is the sole authorization for
  // manifest-callback (which revokes and replaces credentials) and
  // install-callback (which repoints config and connects) — an otherwise
  // read-only AUDITOR must not be able to mint that capability.
  test("is not accessible to AUDITOR", async () => {
    const company = await createCompany({ domain: "githubsetup5.com" });
    const auditor = await createUser(company.id, "AUDITOR");
    // An active, non-expired profile so the 403 below comes from this route's
    // role check, not from auth.js's separate "no auditor profile" guard.
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, active) VALUES ($1, $2, TRUE)`,
      [auditor.id, company.id]
    );
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'X') RETURNING *`,
      [company.id]
    );

    const res = await request(app).get(`/api/integrations/${connResult.rows[0].id}/github/setup-info`).set("Authorization", `Bearer ${auditor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/github/manifest-callback", () => {
  afterEach(() => { global.fetch = originalFetch; });

  test("exchanges the manifest code, stores the App credential, and redirects with an install link", async () => {
    const company = await createCompany({ domain: "githubcallback1.com" });
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;
    const state = signGithubAppState({ connectionId, companyId: company.id });

    global.fetch = vi.fn(async (url) => {
      expect(url).toBe("https://api.github.com/app-manifests/temp-code-123/conversions");
      return {
        ok: true,
        json: async () => ({ id: 987654, pem: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----", client_id: "Iv1.abc", client_secret: "shh", webhook_secret: "wh", slug: "prism-acme", html_url: "https://github.com/apps/prism-acme" }),
      };
    });

    const res = await request(app).get(`/api/integrations/github/manifest-callback?code=temp-code-123&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/settings/integrations/${connectionId}`);
    expect(res.headers.location).toContain("githubInstallUrl=");
    expect(decodeURIComponent(res.headers.location)).toContain("https://github.com/apps/prism-acme/installations/new");

    const credential = await getActiveCredential(connectionId, company.id);
    expect(credential.authType).toBe("oauth2");
    expect(credential.secret.appId).toBe("987654");
    expect(credential.secret.privateKey).toContain("BEGIN RSA PRIVATE KEY");
  });

  test("redirects with an error and touches no data when the state token is invalid", async () => {
    const res = await request(app).get(`/api/integrations/github/manifest-callback?code=whatever&state=not-a-real-token`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("githubError=");
  });

  test("redirects with an error when GitHub's code exchange fails", async () => {
    const company = await createCompany({ domain: "githubcallback2.com" });
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;
    const state = signGithubAppState({ connectionId, companyId: company.id });

    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    const res = await request(app).get(`/api/integrations/github/manifest-callback?code=expired-code&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/settings/integrations/${connectionId}`);
    expect(res.headers.location).toContain("githubError=");

    const credential = await getActiveCredential(connectionId, company.id);
    expect(credential).toBeNull();
  });
});

describe("GET /api/integrations/github/install-callback", () => {
  afterEach(() => { global.fetch = originalFetch; });

  test("resolves the org from the installation, stores config, and connects", async () => {
    const company = await createCompany({ domain: "githubinstall1.com" });
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;
    const state = signGithubAppState({ connectionId, companyId: company.id });
    await storeCredential({ connectionId, companyId: company.id, authType: "oauth2", secret: { appId: "987654", privateKey: "fake-pem" } });

    CONNECTOR_FIXTURES.github.testConnection.mockResolvedValueOnce({ ok: true, externalAccountId: "42424242" });

    const res = await request(app).get(`/api/integrations/github/install-callback?installation_id=555&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`http://localhost:5173/settings/integrations/${connectionId}`);

    const updated = await query(`SELECT * FROM integration_connections WHERE id = $1`, [connectionId]);
    expect(updated.rows[0].status).toBe("connected");
    expect(updated.rows[0].config).toEqual({ installationId: 555, org: "acme-corp" });
    expect(updated.rows[0].external_account_id).toBe("42424242");
  });

  test("redirects with an error and does not connect when the state token is invalid", async () => {
    const res = await request(app).get(`/api/integrations/github/install-callback?installation_id=555&state=garbage`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("githubError=");
  });

  test("marks the connection as error when testConnection fails after install", async () => {
    const company = await createCompany({ domain: "githubinstall2.com" });
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;
    const state = signGithubAppState({ connectionId, companyId: company.id });
    await storeCredential({ connectionId, companyId: company.id, authType: "oauth2", secret: { appId: "987654", privateKey: "fake-pem" } });

    CONNECTOR_FIXTURES.github.testConnection.mockRejectedValueOnce(new Error("installation has no repositories"));

    const res = await request(app).get(`/api/integrations/github/install-callback?installation_id=555&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("githubError=installation%20has%20no%20repositories");

    const updated = await query(`SELECT status FROM integration_connections WHERE id = $1`, [connectionId]);
    expect(updated.rows[0].status).toBe("error");
  });
});

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

describe("GET /api/integrations", () => {
  test("excludes revoked connections from the list", async () => {
    const company = await createCompany({ domain: "listexcl.com" });
    const admin = await createUser(company.id, "ADMIN");
    await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, status) VALUES ($1, 'aws', 'Active AWS', 'connected')`,
      [company.id]
    );
    await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, status) VALUES ($1, 'aws', 'Old AWS', 'revoked')`,
      [company.id]
    );

    const res = await request(app)
      .get("/api/integrations")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe("Active AWS");
  });
});

describe("DELETE /api/integrations/:id", () => {
  test("hard-deletes a connection stuck in error status, cascading its credential", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    // Seeded directly as 'error' — this file's registry mock makes
    // testConnection always succeed, so the only reliable way to exercise
    // the error-status branch is to set the status directly, same as the
    // 'connected' case below.
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, status) VALUES ($1, 'aws', 'Prod AWS', 'error') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO integration_credentials (connection_id, company_id, auth_type, ciphertext, iv, auth_tag) VALUES ($1, $2, 'iam_role', 'ct', 'iv', 'tag')`,
      [conn.rows[0].id, company.id]
    );

    const res = await request(app)
      .delete(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(204);

    const connRows = await query(`SELECT id FROM integration_connections WHERE id = $1`, [conn.rows[0].id]);
    expect(connRows.rowCount).toBe(0);
    const credRows = await query(`SELECT id FROM integration_credentials WHERE connection_id = $1`, [conn.rows[0].id]);
    expect(credRows.rowCount).toBe(0);
  });

  test("soft-revokes a connected connection and crypto-shreds its credential, keeping the row", async () => {
    const company = await createCompany({ domain: "revokeconnected.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, status) VALUES ($1, 'aws', 'Prod AWS', 'connected') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO integration_credentials (connection_id, company_id, auth_type, ciphertext, iv, auth_tag) VALUES ($1, $2, 'iam_role', 'ct', 'iv', 'tag')`,
      [conn.rows[0].id, company.id]
    );

    const res = await request(app)
      .delete(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(204);

    const connRows = await query(`SELECT status FROM integration_connections WHERE id = $1`, [conn.rows[0].id]);
    expect(connRows.rows[0].status).toBe("revoked");
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

describe("GET /api/integrations/:id", () => {
  test("reflects the connection's actual stored auth_type, not the catalog default", async () => {
    const company = await createCompany({ domain: "connauth1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "access_key", secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" } });

    const res = await request(app)
      .get(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.authType).toBe("access_key");
  });

  test("reflects the new auth_type after rotating to a different one", async () => {
    const company = await createCompany({ domain: "connauth2.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });
    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "access_key", secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" } });

    const res = await request(app)
      .get(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.authType).toBe("access_key");
  });

  test("returns a null auth_type when no credential has been stored yet", async () => {
    const company = await createCompany({ domain: "connauth3.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    const res = await request(app)
      .get(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.authType).toBeNull();
  });
});

describe("GET /api/integrations/:id/runs", () => {
  test("lists collection runs for a connection, newest first", async () => {
    const company = await createCompany({ domain: "runs1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = connRes.rows[0].id;
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at, finished_at)
       VALUES ($1, $2, 'manual', 'success', 7, 7, 0, NOW() - interval '2 hours', NOW() - interval '1 hour 55 minutes')`,
      [company.id, connectionId]
    );
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at, finished_at)
       VALUES ($1, $2, 'manual', 'partial_failure', 7, 5, 2, NOW() - interval '1 hour', NOW() - interval '55 minutes')`,
      [company.id, connectionId]
    );

    const res = await request(app).get(`/api/integrations/${connectionId}/runs`).set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].status).toBe("partial_failure");
    expect(res.body[1].status).toBe("success");
  });

  test("returns 404 for a connection belonging to a different company", async () => {
    const companyA = await createCompany({ domain: "runs2a.com" });
    const companyB = await createCompany({ domain: "runs2b.com" });
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [companyA.id]
    );
    const adminB = await createUser(companyB.id, "ADMIN");

    const res = await request(app).get(`/api/integrations/${connRes.rows[0].id}/runs`).set("Authorization", `Bearer ${adminB.token}`);
    expect(res.status).toBe(404);
  });

  test("respects a limit query param", async () => {
    const company = await createCompany({ domain: "runs3.com" });
    const admin = await createUser(company.id, "ADMIN");
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = connRes.rows[0].id;
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at)
         VALUES ($1, $2, 'manual', 'success', 7, 7, 0, NOW() - ($3 || ' minutes')::interval)`,
        [company.id, connectionId, String(i)]
      );
    }

    const res = await request(app).get(`/api/integrations/${connectionId}/runs?limit=2`).set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});
