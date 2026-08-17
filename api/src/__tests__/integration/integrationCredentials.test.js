import { describe, test, expect } from "vitest";
import { createCompany } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { storeCredential, getActiveCredential, revokeCredentials } from "../../db/integrationCredentials.js";

async function createConnection(companyId) {
  const result = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
    [companyId]
  );
  return result.rows[0];
}

describe("integrationCredentials", () => {
  test("stores an encrypted credential and retrieves the decrypted secret", async () => {
    const company = await createCompany();
    const connection = await createConnection(company.id);

    await storeCredential({
      connectionId: connection.id,
      companyId: company.id,
      authType: "access_key",
      secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" },
    });

    const row = await query(`SELECT ciphertext FROM integration_credentials WHERE connection_id = $1`, [connection.id]);
    expect(row.rows[0].ciphertext).not.toContain("AKIA123");

    const credential = await getActiveCredential(connection.id, company.id);
    expect(credential.authType).toBe("access_key");
    expect(credential.secret.accessKeyId).toBe("AKIA123");
  });

  test("returns null when no active credential exists", async () => {
    const company = await createCompany();
    const connection = await createConnection(company.id);
    const credential = await getActiveCredential(connection.id, company.id);
    expect(credential).toBeNull();
  });

  test("revokeCredentials crypto-shreds the ciphertext", async () => {
    const company = await createCompany();
    const connection = await createConnection(company.id);
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "access_key", secret: { accessKeyId: "AKIA123" } });

    await revokeCredentials(connection.id, company.id);

    const row = await query(`SELECT ciphertext, revoked_at FROM integration_credentials WHERE connection_id = $1`, [connection.id]);
    expect(row.rows[0].ciphertext).toBeNull();
    expect(row.rows[0].revoked_at).not.toBeNull();

    const credential = await getActiveCredential(connection.id, company.id);
    expect(credential).toBeNull();
  });

  test("does not return credentials belonging to a different company", async () => {
    const companyA = await createCompany({ domain: "a.com" });
    const companyB = await createCompany({ domain: "b.com" });
    const connection = await createConnection(companyA.id);
    await storeCredential({ connectionId: connection.id, companyId: companyA.id, authType: "access_key", secret: { accessKeyId: "AKIA123" } });

    const credential = await getActiveCredential(connection.id, companyB.id);
    expect(credential).toBeNull();
  });
});
