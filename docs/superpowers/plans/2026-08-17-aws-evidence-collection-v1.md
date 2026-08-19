# AWS Evidence Collection v1 (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend vertical slice of Prism's Automated Evidence Collection feature: an admin can connect an AWS account (IAM role or access key), trigger a manual collection run against 7 Tier-1 AWS checks, have passing checks auto-generate linked Evidence Vault items, have failing checks create structured Findings, and promote a Finding into the existing remediation `actions` workflow — with credentials encrypted at rest and full tenant isolation.

**Architecture:** A pluggable `connectors/` module (mirroring the existing `aiProvider.js` dispatch pattern) exposes `testConnection()`/`runTests()` per integration; a `collectionRunner` orchestrates a run synchronously per request (no job queue yet — that's Phase 2/scheduling, out of scope here per the approved architecture doc's phasing); results fan out into `evidence_vault` (via the existing Vault/`question_evidence` tables) on pass and a new `findings` table on fail; two new Express routers (`/api/integrations`, `/api/findings`) expose it all behind the existing `requireRole`/`requireReadOnly` middleware.

**Tech Stack:** Node.js (ESM) + Express + `pg` (raw SQL, no ORM) + Vitest + Supertest, matching the existing `api/` conventions exactly. New dependencies: `@aws-sdk/client-sts`, `@aws-sdk/client-iam`, `@aws-sdk/client-cloudtrail`, `@aws-sdk/client-config-service`, `@aws-sdk/client-s3`, `@aws-sdk/client-ec2`.

**Spec:** Architecture proposal approved 2026-08-17 (published artifact: "Automated Evidence Architecture"), sections D (pipeline), E (AWS v1 test prioritization), F (database design), G (credential security), H (multi-tenancy), L (Phase 1 scope and acceptance criteria). This plan implements Phase 1 exactly as scoped there: **manual trigger only, read-only AWS checks only, backend + API only** — no scheduling/BullMQ (Phase 2), no frontend UI (a separate follow-up plan), no Tier 2/3 checks, no non-AWS connectors.

## Global Constraints

- ESM modules throughout (`import`/`export`, no `require`) — matches every existing file in `api/src`.
- All new tables carry `company_id NOT NULL REFERENCES companies(id) ON DELETE CASCADE` and every query filters by `req.user.companyId` — no exceptions (per spec §H).
- Integration/credential/finding management routes are `ADMIN`/`LEAD` only via `requireRole`; no new roles are introduced.
- Credentials are never returned by any API response, logged, or written to `audit_logs.detail` — only masked/derived metadata (e.g. `externalAccountId`) ever leaves the encryption boundary (per spec §G).
- `DELETE /api/integrations/:id` crypto-shreds the stored ciphertext (sets it to `NULL`), it does not soft-delete-and-keep-secret.
- No job queue, no BullMQ, no Redis in this plan — `POST /api/integrations/:id/run` executes synchronously within the HTTP request, per spec §L Phase 1 ("manual trigger only... no scheduling yet").
- Every new module ships with tests in the same task that introduces it — unit tests (mocked AWS clients, no real cloud calls) for connector logic, integration tests (real local Postgres via the existing `vitest.integration.config.js` harness) for anything touching the database.
- Follow existing file conventions exactly: `query`/`mapRow`/`mapRows`/`buildUpdate` from `api/src/db/index.js`, `asyncHandler` wrapping every route handler, `authenticate` + `requireRole`/`requireReadOnly` middleware chain, `writeAuditLog` for state-changing operations.

---

## File Structure

```
api/
  init.sql                                    (modified — new tables + catalog seed data)
  package.json                                (modified — 6 new AWS SDK dependencies)
  .env.example                                (modified — CREDENTIAL_ENCRYPTION_KEY)
  vitest.config.js                            (modified — test env var)
  vitest.integration.config.js                (modified — test env var)
  src/
    utils/
      credentialCrypto.js                     (new — AES-256-GCM encrypt/decrypt)
      collectionRunner.js                     (new — orchestrates one collection run)
    db/
      integrationCredentials.js               (new — encrypted credential CRUD)
    connectors/
      registry.js                             (new — integration key → connector module)
      aws/
        credentials.js                        (new — resolves AWS SDK creds: AssumeRole or static keys)
        index.js                              (new — assembles AWS connector: testConnection + runTests)
        tests/
          iam.js                              (new — MFA, password policy, access key age checks)
          logging.js                          (new — CloudTrail, AWS Config checks)
          network.js                          (new — S3 public access, security group checks)
    routes/
      integrations.js                         (new — connections CRUD, credentials, run-now)
      findings.js                             (new — list, update status, promote to action)
      index.js                                (modified — mount the two new routers)
    __tests__/
      credentialCrypto.test.js                (new — unit)
      connectorsAwsCredentials.test.js        (new — unit)
      connectorsAwsIam.test.js                (new — unit)
      connectorsAwsLogging.test.js            (new — unit)
      connectorsAwsNetwork.test.js            (new — unit)
      connectorsRegistry.test.js              (new — unit)
      setup/
        helpers.js                            (modified — truncateAll() covers new tables)
      integration/
        schema.evidenceCollection.test.js     (new)
        integrationCredentials.test.js        (new)
        collectionRunner.test.js              (new)
        integrations.test.js                  (new)
        findings.test.js                      (new)
```

---

### Task 1: Database schema, dependencies, and encryption key config

**Files:**
- Modify: `api/init.sql`
- Modify: `api/package.json`
- Modify: `api/.env.example`
- Modify: `api/vitest.config.js`
- Modify: `api/vitest.integration.config.js`
- Test: `api/src/__tests__/integration/schema.evidenceCollection.test.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: 9 new tables (`integrations`, `integration_connections`, `integration_credentials`, `automated_tests`, `test_control_mappings`, `evidence_collection_runs`, `evidence_test_results`, `automated_evidence_items`, `findings`) + `actions.finding_id` column; catalog rows for the `aws` integration and its 7 tests; `process.env.CREDENTIAL_ENCRYPTION_KEY` available in every test run.

- [ ] **Step 1: Install the AWS SDK dependencies**

Run:
```bash
cd api && npm install @aws-sdk/client-sts @aws-sdk/client-iam @aws-sdk/client-cloudtrail @aws-sdk/client-config-service @aws-sdk/client-s3 @aws-sdk/client-ec2
```
Expected: `api/package.json` gains 6 new entries under `"dependencies"`.

- [ ] **Step 2: Add the new tables to `init.sql`**

Append this block to `api/init.sql`, immediately before the `-- ===== Idempotent upgrade guards (existing databases) =====` section:

```sql
-- ===== Automated Evidence Collection =====

CREATE TABLE IF NOT EXISTS integrations (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('iam_role', 'access_key', 'oauth2', 'api_key')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'beta', 'coming_soon')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  integration_key TEXT NOT NULL REFERENCES integrations(key),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','error','revoked')),
  external_account_id TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integration_connections_company_idx ON integration_connections(company_id);

CREATE TABLE IF NOT EXISTS integration_credentials (
  id SERIAL PRIMARY KEY,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL,
  ciphertext TEXT,
  iv TEXT,
  auth_tag TEXT,
  key_id TEXT NOT NULL DEFAULT 'local-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integration_credentials_connection_idx ON integration_credentials(connection_id);

CREATE TABLE IF NOT EXISTS automated_tests (
  id SERIAL PRIMARY KEY,
  integration_key TEXT NOT NULL REFERENCES integrations(key),
  test_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  severity_default TEXT NOT NULL CHECK (severity_default IN ('critical','high','medium','low')),
  remediation_guidance TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS test_control_mappings (
  id SERIAL PRIMARY KEY,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  framework TEXT NOT NULL DEFAULT 'ISO27001',
  iso_reference TEXT NOT NULL,
  UNIQUE(test_key, framework, iso_reference)
);

CREATE TABLE IF NOT EXISTS evidence_collection_runs (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual','scheduled','retry')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial_failure','failed')),
  tests_run INT NOT NULL DEFAULT 0,
  tests_passed INT NOT NULL DEFAULT 0,
  tests_failed INT NOT NULL DEFAULT 0,
  error_message TEXT,
  triggered_by INT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS evidence_collection_runs_company_idx ON evidence_collection_runs(company_id);
CREATE INDEX IF NOT EXISTS evidence_collection_runs_connection_idx ON evidence_collection_runs(connection_id);

CREATE TABLE IF NOT EXISTS evidence_test_results (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES evidence_collection_runs(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass','fail','warn','error','not_applicable')),
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  message TEXT,
  evidence_payload JSONB,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evidence_test_results_run_idx ON evidence_test_results(run_id);
CREATE INDEX IF NOT EXISTS evidence_test_results_company_idx ON evidence_test_results(company_id);

CREATE TABLE IF NOT EXISTS automated_evidence_items (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  evidence_vault_id INT REFERENCES evidence_vault(id) ON DELETE SET NULL,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  latest_result_id INT REFERENCES evidence_test_results(id) ON DELETE SET NULL,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh','stale','expired')),
  first_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_collection_due_at TIMESTAMPTZ,
  UNIQUE(company_id, connection_id, test_key, resource_id)
);
CREATE INDEX IF NOT EXISTS automated_evidence_items_company_idx ON automated_evidence_items(company_id);

CREATE TABLE IF NOT EXISTS findings (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','suppressed','false_positive')),
  title TEXT NOT NULL,
  description TEXT,
  source_result_id INT REFERENCES evidence_test_results(id) ON DELETE SET NULL,
  linked_action_id INT REFERENCES actions(id) ON DELETE SET NULL,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by INT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(company_id, connection_id, test_key, resource_id)
);
CREATE INDEX IF NOT EXISTS findings_company_idx ON findings(company_id);
CREATE INDEX IF NOT EXISTS findings_status_idx ON findings(company_id, status);

ALTER TABLE actions ADD COLUMN IF NOT EXISTS finding_id INT REFERENCES findings(id) ON DELETE SET NULL;

-- ===== Automated Evidence Collection: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('aws', 'Amazon Web Services', 'cloud', 'iam_role', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('aws', 'aws.iam.mfa_enforced', 'IAM users have MFA enabled', 'Checks every IAM user has at least one registered MFA device.', 'critical', 'Require MFA for all IAM users, ideally via an IAM policy condition or SSO enforcement.'),
  ('aws', 'aws.iam.password_policy', 'Account password policy meets minimum strength', 'Checks the account password policy enforces a 14+ character minimum with mixed case, numbers, and symbols.', 'high', 'Update the account password policy under IAM > Account settings.'),
  ('aws', 'aws.iam.access_key_age', 'IAM access keys are rotated within 90 days', 'Flags active access keys older than 90 days.', 'high', 'Rotate the access key and update any services using it, then deactivate the old key.'),
  ('aws', 'aws.logging.cloudtrail_enabled', 'CloudTrail is enabled and multi-region', 'Checks at least one multi-region CloudTrail trail is actively logging.', 'critical', 'Enable a multi-region CloudTrail trail with log file validation.'),
  ('aws', 'aws.logging.config_enabled', 'AWS Config is recording', 'Checks an AWS Config recorder exists and is actively recording.', 'medium', 'Enable AWS Config in this region and confirm the recorder is turned on.'),
  ('aws', 'aws.network.s3_public_access_blocked', 'S3 buckets block public access', 'Checks every S3 bucket has all four public access block settings enabled.', 'critical', 'Enable "Block all public access" on the bucket, or at the account level.'),
  ('aws', 'aws.network.security_groups_no_open_ingress', 'Security groups do not expose management ports publicly', 'Flags security groups allowing inbound SSH (22) or RDP (3389) from 0.0.0.0/0.', 'critical', 'Restrict the security group rule to specific IP ranges or a bastion/VPN.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, framework, iso_reference) VALUES
  ('aws.iam.mfa_enforced', 'ISO27001', 'A.9.4.2'),
  ('aws.iam.password_policy', 'ISO27001', 'A.9.4.3'),
  ('aws.iam.access_key_age', 'ISO27001', 'A.9.2.4'),
  ('aws.logging.cloudtrail_enabled', 'ISO27001', 'A.12.4.1'),
  ('aws.logging.config_enabled', 'ISO27001', 'A.12.1.1'),
  ('aws.network.s3_public_access_blocked', 'ISO27001', 'A.8.2.3'),
  ('aws.network.security_groups_no_open_ingress', 'ISO27001', 'A.13.1.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

- [ ] **Step 3: Add the encryption key to `.env.example`**

Append to `api/.env.example`:
```
# Base64-encoded 32-byte key used to encrypt integration credentials at rest.
# Generate with: openssl rand -base64 32
CREDENTIAL_ENCRYPTION_KEY=
```

- [ ] **Step 4: Set a test encryption key in both vitest configs**

In `api/vitest.config.js`, add `CREDENTIAL_ENCRYPTION_KEY` to the `env` block:
```js
env: {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "test-secret",
  CREDENTIAL_ENCRYPTION_KEY: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
},
```

In `api/vitest.integration.config.js`, add the same key to its `env` block:
```js
env: {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/prism_test",
  JWT_SECRET: "integration-test-secret",
  PRISM_AI_PROVIDER: "none",
  CREDENTIAL_ENCRYPTION_KEY: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
},
```
(This decodes to exactly 32 bytes — verified: 10× the 3-byte group `0x41 0x41 0x41` plus a final 2-byte group, base64-encoding to `QUFB` × 10 + `QUE=`.)

- [ ] **Step 5: Write the schema verification test**

Create `api/src/__tests__/integration/schema.evidenceCollection.test.js`:
```js
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
```

- [ ] **Step 6: Run the integration tests to verify the schema**

Run: `cd api && npm run test:integration -- schema.evidenceCollection`
Expected: PASS, 6/6 tests. (Requires a local Postgres reachable at `postgresql://postgres:postgres@localhost:5432/prism_test`, per the existing `test:integration` setup — `globalSetup.js` will re-run the now-modified `init.sql`.)

- [ ] **Step 7: Commit**

```bash
git add api/init.sql api/package.json api/package-lock.json api/.env.example api/vitest.config.js api/vitest.integration.config.js api/src/__tests__/integration/schema.evidenceCollection.test.js
git commit -m "feat: add automated evidence collection schema and AWS SDK dependencies"
```

---

### Task 2: Credential encryption utility

**Files:**
- Create: `api/src/utils/credentialCrypto.js`
- Test: `api/src/__tests__/credentialCrypto.test.js`

**Interfaces:**
- Consumes: `process.env.CREDENTIAL_ENCRYPTION_KEY` (set in Task 1)
- Produces: `encryptSecret(plaintext: string): { ciphertext: string, iv: string, authTag: string, keyId: string }` and `decryptSecret({ ciphertext, iv, authTag }): string` — both base64-encoded fields. Task 3 consumes these two functions directly.

- [ ] **Step 1: Write the failing tests**

Create `api/src/__tests__/credentialCrypto.test.js`:
```js
import { describe, test, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../utils/credentialCrypto.js";

describe("credentialCrypto", () => {
  test("round-trips a plaintext secret", () => {
    const plaintext = JSON.stringify({ accessKeyId: "AKIA123", secretAccessKey: "shh" });
    const encrypted = encryptSecret(plaintext);
    expect(encrypted.ciphertext).not.toContain("AKIA123");
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-secret";
    const first = encryptSecret(plaintext);
    const second = encryptSecret(plaintext);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  test("throws when the auth tag has been tampered with", () => {
    const encrypted = encryptSecret("secret-value");
    const tampered = { ...encrypted, authTag: encryptSecret("other").authTag };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  test("throws when CREDENTIAL_ENCRYPTION_KEY is missing", () => {
    const original = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow("CREDENTIAL_ENCRYPTION_KEY is not set");
    process.env.CREDENTIAL_ENCRYPTION_KEY = original;
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run src/__tests__/credentialCrypto.test.js`
Expected: FAIL with "Failed to resolve import" / "Cannot find module" (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `api/src/utils/credentialCrypto.js`:
```js
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_ID = "local-v1";

function loadKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptSecret(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyId: KEY_ID,
  };
}

export function decryptSecret({ ciphertext, iv, authTag }) {
  const key = loadKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/credentialCrypto.test.js`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/utils/credentialCrypto.js api/src/__tests__/credentialCrypto.test.js
git commit -m "feat: add AES-256-GCM credential encryption utility"
```

---

### Task 3: Encrypted credential storage

**Files:**
- Create: `api/src/db/integrationCredentials.js`
- Test: `api/src/__tests__/integration/integrationCredentials.test.js`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` from Task 2; `query`/`mapRow` from `api/src/db/index.js`.
- Produces: `storeCredential({ connectionId, companyId, authType, secret }): Promise<object>`, `getActiveCredential(connectionId, companyId): Promise<{ authType: string, secret: object } | null>`, `revokeCredentials(connectionId, companyId): Promise<void>`. Tasks 9 (`collectionRunner`) and 10 (`routes/integrations.js`) consume all three.

- [ ] **Step 1: Write the failing tests**

Create `api/src/__tests__/integration/integrationCredentials.test.js`:
```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npm run test:integration -- integrationCredentials`
Expected: FAIL — `api/src/db/integrationCredentials.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/src/db/integrationCredentials.js`:
```js
import { query, mapRow } from "./index.js";
import { encryptSecret, decryptSecret } from "../utils/credentialCrypto.js";

export async function storeCredential({ connectionId, companyId, authType, secret }) {
  const encrypted = encryptSecret(JSON.stringify(secret));
  const result = await query(
    `INSERT INTO integration_credentials (connection_id, company_id, auth_type, ciphertext, iv, auth_tag, key_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [connectionId, companyId, authType, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyId]
  );
  return mapRow(result);
}

export async function getActiveCredential(connectionId, companyId) {
  const result = await query(
    `SELECT * FROM integration_credentials
     WHERE connection_id = $1 AND company_id = $2 AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [connectionId, companyId]
  );
  const row = mapRow(result);
  if (!row || !row.ciphertext) return null;
  const secret = JSON.parse(decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }));
  return { authType: row.authType, secret };
}

export async function revokeCredentials(connectionId, companyId) {
  await query(
    `UPDATE integration_credentials
     SET ciphertext = NULL, iv = NULL, auth_tag = NULL, revoked_at = NOW()
     WHERE connection_id = $1 AND company_id = $2 AND revoked_at IS NULL`,
    [connectionId, companyId]
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npm run test:integration -- integrationCredentials`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/db/integrationCredentials.js api/src/__tests__/integration/integrationCredentials.test.js
git commit -m "feat: add encrypted credential storage for integration connections"
```

---

### Task 4: AWS credential resolution (AssumeRole / static keys)

**Files:**
- Create: `api/src/connectors/aws/credentials.js`
- Test: `api/src/__tests__/connectorsAwsCredentials.test.js`

**Interfaces:**
- Consumes: `@aws-sdk/client-sts` (`STSClient`, `AssumeRoleCommand`).
- Produces: `resolveAwsCredentials({ authType, config, secret }): Promise<{ accessKeyId, secretAccessKey, sessionToken? }>`. Consumed by Task 8 (`connectors/aws/index.js`).

- [ ] **Step 1: Write the failing tests**

Create `api/src/__tests__/connectorsAwsCredentials.test.js`:
```js
import { describe, test, expect, vi } from "vitest";

vi.mock("@aws-sdk/client-sts", () => {
  const send = vi.fn().mockResolvedValue({
    Credentials: {
      AccessKeyId: "ASIA-TEMP",
      SecretAccessKey: "temp-secret",
      SessionToken: "temp-token",
    },
  });
  return {
    STSClient: vi.fn(() => ({ send })),
    AssumeRoleCommand: vi.fn((input) => ({ input })),
  };
});

const { resolveAwsCredentials } = await import("../connectors/aws/credentials.js");

describe("resolveAwsCredentials", () => {
  test("returns static credentials for access_key auth", async () => {
    const credentials = await resolveAwsCredentials({
      authType: "access_key",
      config: {},
      secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" },
    });
    expect(credentials).toEqual({ accessKeyId: "AKIA123", secretAccessKey: "shh", sessionToken: undefined });
  });

  test("assumes a role for iam_role auth", async () => {
    const credentials = await resolveAwsCredentials({
      authType: "iam_role",
      config: { roleArn: "arn:aws:iam::123456789012:role/PrismReadOnly", region: "us-east-1" },
      secret: { externalId: "ext-123" },
    });
    expect(credentials.accessKeyId).toBe("ASIA-TEMP");
    expect(credentials.sessionToken).toBe("temp-token");
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveAwsCredentials({ authType: "oauth2", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported AWS auth type: oauth2");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run src/__tests__/connectorsAwsCredentials.test.js`
Expected: FAIL — `api/src/connectors/aws/credentials.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/aws/credentials.js`:
```js
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

export async function resolveAwsCredentials({ authType, config, secret }) {
  if (authType === "access_key") {
    return {
      accessKeyId: secret.accessKeyId,
      secretAccessKey: secret.secretAccessKey,
      sessionToken: secret.sessionToken || undefined,
    };
  }

  if (authType === "iam_role") {
    const sts = new STSClient({ region: config.region || "us-east-1" });
    const result = await sts.send(new AssumeRoleCommand({
      RoleArn: config.roleArn,
      RoleSessionName: "prism-evidence-collection",
      ExternalId: secret.externalId,
      DurationSeconds: 3600,
    }));
    return {
      accessKeyId: result.Credentials.AccessKeyId,
      secretAccessKey: result.Credentials.SecretAccessKey,
      sessionToken: result.Credentials.SessionToken,
    };
  }

  throw new Error(`Unsupported AWS auth type: ${authType}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/connectorsAwsCredentials.test.js`
Expected: PASS, 3/3 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/aws/credentials.js api/src/__tests__/connectorsAwsCredentials.test.js
git commit -m "feat: add AWS credential resolution (AssumeRole and static keys)"
```

---

### Task 5: AWS IAM checks (MFA, password policy, access key age)

**Files:**
- Create: `api/src/connectors/aws/tests/iam.js`
- Test: `api/src/__tests__/connectorsAwsIam.test.js`

**Interfaces:**
- Consumes: `@aws-sdk/client-iam` command classes; an injected IAM client object with a `.send(command)` method (constructed later in Task 8, not here — keeping this module SDK-client-agnostic makes it directly unit-testable with a fake client).
- Produces: `checkMfaEnforced(iam)`, `checkPasswordPolicy(iam)`, `checkAccessKeyAge(iam)` — each `Promise<Array<{ resourceId, status, message, evidencePayload }>>` — and `iamTests`, an array of `{ key, title, severityDefault, isoReferences, run(clients) }`. Task 8 consumes `iamTests`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/__tests__/connectorsAwsIam.test.js`:
```js
import { describe, test, expect, vi } from "vitest";
import {
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
  GetAccountPasswordPolicyCommand,
} from "@aws-sdk/client-iam";
import { checkMfaEnforced, checkPasswordPolicy, checkAccessKeyAge } from "../connectors/aws/tests/iam.js";

function fakeIamClient(responses) {
  return {
    send: vi.fn(async (command) => {
      if (command instanceof ListUsersCommand) return responses.listUsers;
      if (command instanceof ListMFADevicesCommand) return responses.listMfaDevices(command.input.UserName);
      if (command instanceof ListAccessKeysCommand) return responses.listAccessKeys(command.input.UserName);
      if (command instanceof GetAccountPasswordPolicyCommand) return responses.passwordPolicy();
      throw new Error("Unhandled command in fake IAM client");
    }),
  };
}

describe("checkMfaEnforced", () => {
  test("fails a user with no MFA device", async () => {
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "alice", Arn: "arn:aws:iam::123:user/alice" }] },
      listMfaDevices: () => ({ MFADevices: [] }),
    });
    const results = await checkMfaEnforced(iam);
    expect(results).toEqual([{
      resourceId: "arn:aws:iam::123:user/alice",
      status: "fail",
      message: "alice has no MFA device registered",
      evidencePayload: { userName: "alice", mfaDeviceCount: 0 },
    }]);
  });

  test("passes a user with an MFA device", async () => {
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "bob", Arn: "arn:aws:iam::123:user/bob" }] },
      listMfaDevices: () => ({ MFADevices: [{ SerialNumber: "arn:aws:iam::123:mfa/bob" }] }),
    });
    const results = await checkMfaEnforced(iam);
    expect(results[0].status).toBe("pass");
  });

  test("reports not_applicable when there are no IAM users", async () => {
    const iam = fakeIamClient({ listUsers: { Users: [] }, listMfaDevices: () => ({ MFADevices: [] }) });
    const results = await checkMfaEnforced(iam);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No IAM users found", evidencePayload: {} }]);
  });
});

describe("checkPasswordPolicy", () => {
  test("passes a policy meeting the minimum bar", async () => {
    const iam = fakeIamClient({
      passwordPolicy: () => ({
        PasswordPolicy: {
          MinimumPasswordLength: 14, RequireSymbols: true, RequireNumbers: true,
          RequireUppercaseCharacters: true, RequireLowercaseCharacters: true,
        },
      }),
    });
    const results = await checkPasswordPolicy(iam);
    expect(results[0].status).toBe("pass");
  });

  test("fails a policy below the minimum length", async () => {
    const iam = fakeIamClient({
      passwordPolicy: () => ({
        PasswordPolicy: {
          MinimumPasswordLength: 8, RequireSymbols: false, RequireNumbers: true,
          RequireUppercaseCharacters: true, RequireLowercaseCharacters: true,
        },
      }),
    });
    const results = await checkPasswordPolicy(iam);
    expect(results[0].status).toBe("fail");
  });

  test("fails when no password policy is configured", async () => {
    const iam = fakeIamClient({
      passwordPolicy: () => { const err = new Error("no policy"); err.name = "NoSuchEntityException"; throw err; },
    });
    const results = await checkPasswordPolicy(iam);
    expect(results[0]).toEqual({
      resourceId: "account-password-policy", status: "fail",
      message: "No account password policy is configured", evidencePayload: {},
    });
  });
});

describe("checkAccessKeyAge", () => {
  test("fails a key older than 90 days", async () => {
    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "carol" }] },
      listAccessKeys: () => ({ AccessKeyMetadata: [{ AccessKeyId: "AKIAOLD", Status: "Active", CreateDate: oldDate }] }),
    });
    const results = await checkAccessKeyAge(iam);
    expect(results[0].status).toBe("fail");
  });

  test("passes a key within 90 days", async () => {
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "dave" }] },
      listAccessKeys: () => ({ AccessKeyMetadata: [{ AccessKeyId: "AKIANEW", Status: "Active", CreateDate: recentDate }] }),
    });
    const results = await checkAccessKeyAge(iam);
    expect(results[0].status).toBe("pass");
  });

  test("skips inactive keys", async () => {
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "erin" }] },
      listAccessKeys: () => ({ AccessKeyMetadata: [{ AccessKeyId: "AKIAOLD", Status: "Inactive", CreateDate: new Date().toISOString() }] }),
    });
    const results = await checkAccessKeyAge(iam);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No active IAM access keys found", evidencePayload: {} }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run src/__tests__/connectorsAwsIam.test.js`
Expected: FAIL — `api/src/connectors/aws/tests/iam.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/aws/tests/iam.js`:
```js
import {
  GetAccountPasswordPolicyCommand,
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam";

const MAX_ACCESS_KEY_AGE_DAYS = 90;

export async function checkMfaEnforced(iam) {
  const { Users } = await iam.send(new ListUsersCommand({}));
  const users = Users || [];
  const results = [];
  for (const user of users) {
    const { MFADevices } = await iam.send(new ListMFADevicesCommand({ UserName: user.UserName }));
    const hasMfa = (MFADevices || []).length > 0;
    results.push({
      resourceId: user.Arn,
      status: hasMfa ? "pass" : "fail",
      message: hasMfa
        ? `${user.UserName} has at least one MFA device registered`
        : `${user.UserName} has no MFA device registered`,
      evidencePayload: { userName: user.UserName, mfaDeviceCount: (MFADevices || []).length },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No IAM users found", evidencePayload: {} });
  }
  return results;
}

export async function checkPasswordPolicy(iam) {
  try {
    const { PasswordPolicy: policy } = await iam.send(new GetAccountPasswordPolicyCommand({}));
    const meetsBar =
      (policy.MinimumPasswordLength || 0) >= 14 &&
      policy.RequireSymbols &&
      policy.RequireNumbers &&
      policy.RequireUppercaseCharacters &&
      policy.RequireLowercaseCharacters;
    return [{
      resourceId: "account-password-policy",
      status: meetsBar ? "pass" : "fail",
      message: meetsBar
        ? "Account password policy meets minimum bar (14+ chars, mixed case, numbers, symbols)"
        : "Account password policy does not meet minimum bar",
      evidencePayload: policy,
    }];
  } catch (err) {
    if (err.name === "NoSuchEntityException") {
      return [{ resourceId: "account-password-policy", status: "fail", message: "No account password policy is configured", evidencePayload: {} }];
    }
    throw err;
  }
}

export async function checkAccessKeyAge(iam) {
  const { Users } = await iam.send(new ListUsersCommand({}));
  const users = Users || [];
  const results = [];
  for (const user of users) {
    const { AccessKeyMetadata } = await iam.send(new ListAccessKeysCommand({ UserName: user.UserName }));
    for (const key of AccessKeyMetadata || []) {
      if (key.Status !== "Active") continue;
      const ageDays = Math.floor((Date.now() - new Date(key.CreateDate).getTime()) / (1000 * 60 * 60 * 24));
      const pass = ageDays <= MAX_ACCESS_KEY_AGE_DAYS;
      results.push({
        resourceId: key.AccessKeyId,
        status: pass ? "pass" : "fail",
        message: pass
          ? `Access key ${key.AccessKeyId} is ${ageDays} days old (within ${MAX_ACCESS_KEY_AGE_DAYS}-day limit)`
          : `Access key ${key.AccessKeyId} is ${ageDays} days old, exceeding the ${MAX_ACCESS_KEY_AGE_DAYS}-day rotation limit`,
        evidencePayload: { userName: user.UserName, accessKeyId: key.AccessKeyId, ageDays },
      });
    }
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No active IAM access keys found", evidencePayload: {} });
  }
  return results;
}

export const iamTests = [
  { key: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severityDefault: "critical", isoReferences: ["A.9.4.2"], run: (clients) => checkMfaEnforced(clients.iam) },
  { key: "aws.iam.password_policy", title: "Account password policy meets minimum strength", severityDefault: "high", isoReferences: ["A.9.4.3"], run: (clients) => checkPasswordPolicy(clients.iam) },
  { key: "aws.iam.access_key_age", title: "IAM access keys are rotated within 90 days", severityDefault: "high", isoReferences: ["A.9.2.4"], run: (clients) => checkAccessKeyAge(clients.iam) },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/connectorsAwsIam.test.js`
Expected: PASS, 8/8 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/aws/tests/iam.js api/src/__tests__/connectorsAwsIam.test.js
git commit -m "feat: add AWS IAM checks (MFA, password policy, access key age)"
```

---

### Task 6: AWS logging checks (CloudTrail, Config)

**Files:**
- Create: `api/src/connectors/aws/tests/logging.js`
- Test: `api/src/__tests__/connectorsAwsLogging.test.js`

**Interfaces:**
- Consumes: `@aws-sdk/client-cloudtrail`, `@aws-sdk/client-config-service` command classes.
- Produces: `checkCloudTrailEnabled(cloudtrail)`, `checkConfigEnabled(configService)`, and `loggingTests` (same shape as `iamTests`). Task 8 consumes `loggingTests`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/__tests__/connectorsAwsLogging.test.js`:
```js
import { describe, test, expect, vi } from "vitest";
import { DescribeTrailsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { DescribeConfigurationRecordersCommand, DescribeConfigurationRecorderStatusCommand } from "@aws-sdk/client-config-service";
import { checkCloudTrailEnabled, checkConfigEnabled } from "../connectors/aws/tests/logging.js";

describe("checkCloudTrailEnabled", () => {
  test("fails when no trails exist", async () => {
    const cloudtrail = { send: vi.fn(async () => ({ trailList: [] })) };
    const results = await checkCloudTrailEnabled(cloudtrail);
    expect(results).toEqual([{ resourceId: "account", status: "fail", message: "No CloudTrail trails are configured", evidencePayload: {} }]);
  });

  test("passes a logging, multi-region trail", async () => {
    const cloudtrail = {
      send: vi.fn(async (command) => {
        if (command instanceof DescribeTrailsCommand) return { trailList: [{ Name: "org-trail", TrailARN: "arn:trail/org-trail", IsMultiRegionTrail: true }] };
        if (command instanceof GetTrailStatusCommand) return { IsLogging: true };
      }),
    };
    const results = await checkCloudTrailEnabled(cloudtrail);
    expect(results[0].status).toBe("pass");
  });

  test("fails a single-region trail", async () => {
    const cloudtrail = {
      send: vi.fn(async (command) => {
        if (command instanceof DescribeTrailsCommand) return { trailList: [{ Name: "local-trail", TrailARN: "arn:trail/local-trail", IsMultiRegionTrail: false }] };
        if (command instanceof GetTrailStatusCommand) return { IsLogging: true };
      }),
    };
    const results = await checkCloudTrailEnabled(cloudtrail);
    expect(results[0].status).toBe("fail");
  });
});

describe("checkConfigEnabled", () => {
  test("fails when no recorder is configured", async () => {
    const configService = { send: vi.fn(async () => ({ ConfigurationRecorders: [] })) };
    const results = await checkConfigEnabled(configService);
    expect(results[0].status).toBe("fail");
  });

  test("passes an actively recording recorder", async () => {
    const configService = {
      send: vi.fn(async (command) => {
        if (command instanceof DescribeConfigurationRecordersCommand) return { ConfigurationRecorders: [{ name: "default" }] };
        if (command instanceof DescribeConfigurationRecorderStatusCommand) return { ConfigurationRecordersStatus: [{ name: "default", recording: true }] };
      }),
    };
    const results = await checkConfigEnabled(configService);
    expect(results[0].status).toBe("pass");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run src/__tests__/connectorsAwsLogging.test.js`
Expected: FAIL — `api/src/connectors/aws/tests/logging.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/aws/tests/logging.js`:
```js
import { DescribeTrailsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { DescribeConfigurationRecordersCommand, DescribeConfigurationRecorderStatusCommand } from "@aws-sdk/client-config-service";

export async function checkCloudTrailEnabled(cloudtrail) {
  const { trailList } = await cloudtrail.send(new DescribeTrailsCommand({}));
  const trails = trailList || [];
  if (trails.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No CloudTrail trails are configured", evidencePayload: {} }];
  }
  const results = [];
  for (const trail of trails) {
    const status = await cloudtrail.send(new GetTrailStatusCommand({ Name: trail.TrailARN }));
    const pass = Boolean(status.IsLogging) && Boolean(trail.IsMultiRegionTrail);
    results.push({
      resourceId: trail.TrailARN,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${trail.Name} is logging and multi-region`
        : `${trail.Name} is ${status.IsLogging ? "logging" : "not logging"} and ${trail.IsMultiRegionTrail ? "multi-region" : "single-region"}`,
      evidencePayload: { name: trail.Name, isLogging: status.IsLogging, isMultiRegionTrail: trail.IsMultiRegionTrail },
    });
  }
  return results;
}

export async function checkConfigEnabled(configService) {
  const { ConfigurationRecorders } = await configService.send(new DescribeConfigurationRecordersCommand({}));
  const recorders = ConfigurationRecorders || [];
  if (recorders.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No AWS Config recorder is configured", evidencePayload: {} }];
  }
  const { ConfigurationRecordersStatus } = await configService.send(new DescribeConfigurationRecorderStatusCommand({}));
  const results = [];
  for (const recorder of recorders) {
    const recorderStatus = (ConfigurationRecordersStatus || []).find((s) => s.name === recorder.name);
    const pass = Boolean(recorderStatus?.recording);
    results.push({
      resourceId: recorder.name,
      status: pass ? "pass" : "fail",
      message: pass ? `${recorder.name} is actively recording` : `${recorder.name} is not recording`,
      evidencePayload: { name: recorder.name, recording: Boolean(recorderStatus?.recording) },
    });
  }
  return results;
}

export const loggingTests = [
  { key: "aws.logging.cloudtrail_enabled", title: "CloudTrail is enabled and multi-region", severityDefault: "critical", isoReferences: ["A.12.4.1"], run: (clients) => checkCloudTrailEnabled(clients.cloudtrail) },
  { key: "aws.logging.config_enabled", title: "AWS Config is recording", severityDefault: "medium", isoReferences: ["A.12.1.1"], run: (clients) => checkConfigEnabled(clients.configService) },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/connectorsAwsLogging.test.js`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/aws/tests/logging.js api/src/__tests__/connectorsAwsLogging.test.js
git commit -m "feat: add AWS logging checks (CloudTrail, Config)"
```

---

### Task 7: AWS network checks (S3 public access, security groups)

**Files:**
- Create: `api/src/connectors/aws/tests/network.js`
- Test: `api/src/__tests__/connectorsAwsNetwork.test.js`

**Interfaces:**
- Consumes: `@aws-sdk/client-s3`, `@aws-sdk/client-ec2` command classes.
- Produces: `checkS3PublicAccessBlocked(s3)`, `checkSecurityGroupsNoOpenIngress(ec2)`, and `networkTests` (same shape as `iamTests`). Task 8 consumes `networkTests`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/__tests__/connectorsAwsNetwork.test.js`:
```js
import { describe, test, expect, vi } from "vitest";
import { ListBucketsCommand, GetPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { checkS3PublicAccessBlocked, checkSecurityGroupsNoOpenIngress } from "../connectors/aws/tests/network.js";

describe("checkS3PublicAccessBlocked", () => {
  test("reports not_applicable with no buckets", async () => {
    const s3 = { send: vi.fn(async () => ({ Buckets: [] })) };
    const results = await checkS3PublicAccessBlocked(s3);
    expect(results[0].status).toBe("not_applicable");
  });

  test("passes a bucket with all four blocks enabled", async () => {
    const s3 = {
      send: vi.fn(async (command) => {
        if (command instanceof ListBucketsCommand) return { Buckets: [{ Name: "prism-evidence" }] };
        if (command instanceof GetPublicAccessBlockCommand) return {
          PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        };
      }),
    };
    const results = await checkS3PublicAccessBlocked(s3);
    expect(results[0].status).toBe("pass");
  });

  test("fails a bucket with no public access block configuration", async () => {
    const s3 = {
      send: vi.fn(async (command) => {
        if (command instanceof ListBucketsCommand) return { Buckets: [{ Name: "legacy-bucket" }] };
        if (command instanceof GetPublicAccessBlockCommand) { const err = new Error("none"); err.name = "NoSuchPublicAccessBlockConfiguration"; throw err; }
      }),
    };
    const results = await checkS3PublicAccessBlocked(s3);
    expect(results[0]).toEqual({ resourceId: "legacy-bucket", status: "fail", message: "legacy-bucket has no public access block configuration", evidencePayload: {} });
  });
});

describe("checkSecurityGroupsNoOpenIngress", () => {
  test("fails a group open to 0.0.0.0/0 on port 22", async () => {
    const ec2 = { send: vi.fn(async () => ({
      SecurityGroups: [{ GroupId: "sg-1", GroupName: "web", IpPermissions: [{ FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] }],
    })) };
    const results = await checkSecurityGroupsNoOpenIngress(ec2);
    expect(results[0].status).toBe("fail");
  });

  test("passes a group restricted to a specific CIDR", async () => {
    const ec2 = { send: vi.fn(async () => ({
      SecurityGroups: [{ GroupId: "sg-2", GroupName: "internal", IpPermissions: [{ FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: "10.0.0.0/8" }] }] }],
    })) };
    const results = await checkSecurityGroupsNoOpenIngress(ec2);
    expect(results[0].status).toBe("pass");
  });

  test("passes a group open on an unrelated port", async () => {
    const ec2 = { send: vi.fn(async () => ({
      SecurityGroups: [{ GroupId: "sg-3", GroupName: "web", IpPermissions: [{ FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] }],
    })) };
    const results = await checkSecurityGroupsNoOpenIngress(ec2);
    expect(results[0].status).toBe("pass");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run src/__tests__/connectorsAwsNetwork.test.js`
Expected: FAIL — `api/src/connectors/aws/tests/network.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/aws/tests/network.js`:
```js
import { ListBucketsCommand, GetPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";

export async function checkS3PublicAccessBlocked(s3) {
  const { Buckets } = await s3.send(new ListBucketsCommand({}));
  const buckets = Buckets || [];
  if (buckets.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No S3 buckets found", evidencePayload: {} }];
  }
  const results = [];
  for (const bucket of buckets) {
    try {
      const { PublicAccessBlockConfiguration: config } = await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket.Name }));
      const pass = Boolean(
        config?.BlockPublicAcls && config?.BlockPublicPolicy &&
        config?.IgnorePublicAcls && config?.RestrictPublicBuckets
      );
      results.push({
        resourceId: bucket.Name,
        status: pass ? "pass" : "fail",
        message: pass ? `${bucket.Name} blocks all public access` : `${bucket.Name} does not fully block public access`,
        evidencePayload: config || {},
      });
    } catch (err) {
      if (err.name === "NoSuchPublicAccessBlockConfiguration") {
        results.push({ resourceId: bucket.Name, status: "fail", message: `${bucket.Name} has no public access block configuration`, evidencePayload: {} });
      } else {
        throw err;
      }
    }
  }
  return results;
}

const SENSITIVE_PORTS = [22, 3389];

function ruleExposesSensitivePort(perm) {
  const hasOpenCidr = (perm.IpRanges || []).some((r) => r.CidrIp === "0.0.0.0/0");
  if (!hasOpenCidr) return false;
  const from = perm.FromPort ?? 0;
  const to = perm.ToPort ?? 65535;
  return SENSITIVE_PORTS.some((port) => port >= from && port <= to);
}

export async function checkSecurityGroupsNoOpenIngress(ec2) {
  const { SecurityGroups } = await ec2.send(new DescribeSecurityGroupsCommand({}));
  const groups = SecurityGroups || [];
  const results = [];
  for (const group of groups) {
    const openRules = (group.IpPermissions || []).filter(ruleExposesSensitivePort);
    const pass = openRules.length === 0;
    results.push({
      resourceId: group.GroupId,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${group.GroupId} does not expose SSH/RDP to 0.0.0.0/0`
        : `${group.GroupId} allows inbound SSH or RDP from 0.0.0.0/0`,
      evidencePayload: { groupId: group.GroupId, groupName: group.GroupName, openRuleCount: openRules.length },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No security groups found", evidencePayload: {} });
  }
  return results;
}

export const networkTests = [
  { key: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severityDefault: "critical", isoReferences: ["A.8.2.3"], run: (clients) => checkS3PublicAccessBlocked(clients.s3) },
  { key: "aws.network.security_groups_no_open_ingress", title: "Security groups do not expose management ports publicly", severityDefault: "critical", isoReferences: ["A.13.1.1"], run: (clients) => checkSecurityGroupsNoOpenIngress(clients.ec2) },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/connectorsAwsNetwork.test.js`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/aws/tests/network.js api/src/__tests__/connectorsAwsNetwork.test.js
git commit -m "feat: add AWS network checks (S3 public access, security groups)"
```

---

### Task 8: AWS connector assembly and registry

**Files:**
- Create: `api/src/connectors/aws/index.js`
- Create: `api/src/connectors/registry.js`
- Test: `api/src/__tests__/connectorsRegistry.test.js`

**Interfaces:**
- Consumes: `resolveAwsCredentials` (Task 4), `iamTests`/`loggingTests`/`networkTests` (Tasks 5–7).
- Produces: `aws/index.js` exports `key: "aws"`, `tests: Array`, `testConnection({authType, config, secret}): Promise<{ok, externalAccountId}>`, `runTests({authType, config, secret}): Promise<Array<{testKey, severity, resourceId, status, message, evidencePayload}>>`. `registry.js` exports `getConnector(integrationKey): connectorModule` and `listConnectorTests(integrationKey): Array`. Task 9 (`collectionRunner`) and Task 10 (routes) consume `getConnector`.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsRegistry.test.js`:
```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsRegistry.test.js`
Expected: FAIL — `api/src/connectors/registry.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/aws/index.js`:
```js
import { IAMClient } from "@aws-sdk/client-iam";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { ConfigServiceClient } from "@aws-sdk/client-config-service";
import { S3Client } from "@aws-sdk/client-s3";
import { EC2Client } from "@aws-sdk/client-ec2";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { resolveAwsCredentials } from "./credentials.js";
import { iamTests } from "./tests/iam.js";
import { loggingTests } from "./tests/logging.js";
import { networkTests } from "./tests/network.js";

export const key = "aws";

export const tests = [...iamTests, ...loggingTests, ...networkTests];

function buildClients(credentials, region) {
  return {
    iam: new IAMClient({ credentials, region }),
    cloudtrail: new CloudTrailClient({ credentials, region }),
    configService: new ConfigServiceClient({ credentials, region }),
    s3: new S3Client({ credentials, region }),
    ec2: new EC2Client({ credentials, region }),
  };
}

export async function testConnection({ authType, config, secret }) {
  const credentials = await resolveAwsCredentials({ authType, config, secret });
  const sts = new STSClient({ credentials, region: config.region || "us-east-1" });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  return { ok: true, externalAccountId: identity.Account };
}

export async function runTests({ authType, config, secret }) {
  const credentials = await resolveAwsCredentials({ authType, config, secret });
  const clients = buildClients(credentials, config.region || "us-east-1");
  const runResults = [];
  for (const test of tests) {
    const results = await test.run(clients);
    for (const result of results) {
      runResults.push({ testKey: test.key, severity: test.severityDefault, ...result });
    }
  }
  return runResults;
}
```

Create `api/src/connectors/registry.js`:
```js
import * as aws from "./aws/index.js";

const connectors = { [aws.key]: aws };

export function getConnector(integrationKey) {
  const connector = connectors[integrationKey];
  if (!connector) throw new Error(`Unknown integration: ${integrationKey}`);
  return connector;
}

export function listConnectorTests(integrationKey) {
  return getConnector(integrationKey).tests;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsRegistry.test.js`
Expected: PASS, 3/3 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/aws/index.js api/src/connectors/registry.js api/src/__tests__/connectorsRegistry.test.js
git commit -m "feat: assemble the AWS connector and add the connector registry"
```

---

### Task 9: Collection runner (orchestration)

**Files:**
- Create: `api/src/utils/collectionRunner.js`
- Modify: `api/src/__tests__/setup/helpers.js` (extend `truncateAll()`)
- Test: `api/src/__tests__/integration/collectionRunner.test.js`

**Interfaces:**
- Consumes: `getActiveCredential` (Task 3), `getConnector` (Task 8), `writeAuditLog` (existing `api/src/utils/auditLog.js`), `query`/`mapRow` (existing `api/src/db/index.js`).
- Produces: `runCollection({ connectionId, companyId, triggeredBy, triggerType }): Promise<{ id, status, testsRun, testsPassed, testsFailed, ... }>`. Task 10 (`routes/integrations.js`) consumes this directly.

- [ ] **Step 1: Extend `truncateAll()` for the new operational tables**

In `api/src/__tests__/setup/helpers.js`, update the `TRUNCATE` statement to include the new company-scoped tables (catalog tables `integrations`/`automated_tests`/`test_control_mappings` are seeded once by `init.sql` and must NOT be truncated per test, matching how `module_templates` is already excluded):

```js
export async function truncateAll() {
  await query(`
    TRUNCATE
      findings, automated_evidence_items, evidence_test_results, evidence_collection_runs,
      integration_credentials, integration_connections,
      evidence_request_comments, evidence_requests,
      question_evidence, evidence_versions, evidence_vault,
      question_dependencies, module_dependencies,
      notifications, actions, assessments, evidence,
      questions, modules, invitations,
      audit_logs, auditor_profiles, reminders,
      list_items, consent_logs, company_settings,
      users, companies
    RESTART IDENTITY CASCADE
  `);
}
```

- [ ] **Step 2: Write the failing tests**

Create `api/src/__tests__/integration/collectionRunner.test.js`:
```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd api && npm run test:integration -- collectionRunner`
Expected: FAIL — `api/src/utils/collectionRunner.js` does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `api/src/utils/collectionRunner.js`:
```js
import crypto from "crypto";
import { query, mapRow } from "../db/index.js";
import { getActiveCredential } from "../db/integrationCredentials.js";
import { getConnector } from "../connectors/registry.js";
import { writeAuditLog } from "./auditLog.js";

function hashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");
}

async function upsertEvidenceForPass({ companyId, result }) {
  const vaultResult = await query(
    `INSERT INTO evidence_vault (company_id, title, description, uploaded_by)
     VALUES ($1, $2, $3, 'automated') RETURNING *`,
    [companyId, `${result.testKey} — ${result.resourceId}`, result.message]
  );
  const vault = mapRow(vaultResult);

  const mappings = await query(`SELECT iso_reference FROM test_control_mappings WHERE test_key = $1`, [result.testKey]);
  for (const mapping of mappings.rows) {
    const questions = await query(
      `SELECT quest_id FROM questions WHERE company_id = $1 AND iso_reference = $2`,
      [companyId, mapping.iso_reference]
    );
    for (const q of questions.rows) {
      await query(
        `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
         VALUES ($1, $2, $3, 'automated')
         ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
        [companyId, q.quest_id, vault.id]
      );
    }
  }
  return vault.id;
}

async function upsertFinding({ companyId, connectionId, result, sourceResultId }) {
  await query(
    `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title, description, source_result_id, last_detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (company_id, connection_id, test_key, resource_id)
     DO UPDATE SET
       status = CASE WHEN findings.status = 'resolved' THEN 'open' ELSE findings.status END,
       last_detected_at = NOW(),
       source_result_id = EXCLUDED.source_result_id,
       description = EXCLUDED.description`,
    [companyId, connectionId, result.testKey, result.resourceId, result.severity, result.testKey, result.message, sourceResultId]
  );
}

export async function runCollection({ connectionId, companyId, triggeredBy, triggerType = "manual" }) {
  const connectionResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, companyId]
  );
  const connection = mapRow(connectionResult);
  if (!connection) throw new Error("Connection not found");

  const credential = await getActiveCredential(connectionId, companyId);
  if (!credential) throw new Error("No active credential for this connection");

  const runResult = await query(
    `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, triggered_by)
     VALUES ($1, $2, $3, 'running', $4) RETURNING *`,
    [companyId, connectionId, triggerType, triggeredBy || null]
  );
  const run = mapRow(runResult);

  const connector = getConnector(connection.integrationKey);
  let results = [];
  let runFailed = false;
  let errorMessage = null;

  try {
    results = await connector.runTests({ authType: credential.authType, config: connection.config, secret: credential.secret });
  } catch (err) {
    runFailed = true;
    errorMessage = err.message;
  }

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const resultRow = await query(
      `INSERT INTO evidence_test_results (run_id, company_id, test_key, resource_id, status, severity, message, evidence_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [run.id, companyId, result.testKey, result.resourceId, result.status, result.severity, result.message, JSON.stringify(result.evidencePayload || {})]
    );
    const savedResult = mapRow(resultRow);

    if (result.status === "pass") {
      passed++;
      const payloadHash = hashPayload(result.evidencePayload);
      const existing = await query(
        `SELECT * FROM automated_evidence_items WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4`,
        [companyId, connectionId, result.testKey, result.resourceId]
      );
      const existingItem = mapRow(existing);
      let vaultId = existingItem?.evidenceVaultId;
      if (!existingItem || existingItem.payloadHash !== payloadHash) {
        vaultId = await upsertEvidenceForPass({ companyId, result });
      }
      await query(
        `INSERT INTO automated_evidence_items (company_id, connection_id, evidence_vault_id, test_key, resource_id, latest_result_id, payload_hash, status, last_collected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'fresh', NOW())
         ON CONFLICT (company_id, connection_id, test_key, resource_id)
         DO UPDATE SET evidence_vault_id = EXCLUDED.evidence_vault_id, latest_result_id = EXCLUDED.latest_result_id,
           payload_hash = EXCLUDED.payload_hash, status = 'fresh', last_collected_at = NOW()`,
        [companyId, connectionId, vaultId, result.testKey, result.resourceId, savedResult.id, payloadHash]
      );
      await query(
        `UPDATE findings SET status = 'resolved', resolved_at = NOW()
         WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4 AND status = 'open'`,
        [companyId, connectionId, result.testKey, result.resourceId]
      );
    } else if (result.status === "fail") {
      failed++;
      await upsertFinding({ companyId, connectionId, result, sourceResultId: savedResult.id });
    }
  }

  const finalStatus = runFailed ? "failed" : (failed > 0 ? "partial_failure" : "success");

  await query(
    `UPDATE evidence_collection_runs
     SET status = $1, tests_run = $2, tests_passed = $3, tests_failed = $4, error_message = $5, finished_at = NOW()
     WHERE id = $6`,
    [finalStatus, results.length, passed, failed, errorMessage, run.id]
  );

  await query(
    `UPDATE integration_connections SET last_run_at = NOW(), last_run_status = $1, status = $2, updated_at = NOW() WHERE id = $3`,
    [finalStatus, finalStatus === "failed" ? "error" : "connected", connectionId]
  );

  await writeAuditLog({
    userId: triggeredBy,
    companyId,
    action: "COLLECTION_RUN_COMPLETED",
    resource: "evidence_collection_runs",
    detail: { runId: run.id, connectionId, status: finalStatus, testsRun: results.length, testsPassed: passed, testsFailed: failed },
  });

  return { ...run, status: finalStatus, testsRun: results.length, testsPassed: passed, testsFailed: failed };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npm run test:integration -- collectionRunner`
Expected: PASS, 3/3 tests.

- [ ] **Step 6: Commit**

```bash
git add api/src/utils/collectionRunner.js api/src/__tests__/setup/helpers.js api/src/__tests__/integration/collectionRunner.test.js
git commit -m "feat: add collection runner orchestrating tests, evidence, and findings"
```

---

### Task 10: Integrations API routes

**Files:**
- Create: `api/src/routes/integrations.js`
- Modify: `api/src/routes/index.js`
- Test: `api/src/__tests__/integration/integrations.test.js`

**Interfaces:**
- Consumes: `storeCredential`/`revokeCredentials` (Task 3), `getConnector` (Task 8), `runCollection` (Task 9), `query`/`mapRow`/`mapRows` (existing), `authenticate`/`requireRole`/`requireReadOnly` (existing), `writeAuditLog` (existing), `sanitiseFields` (existing).
- Produces: `POST /api/integrations`, `GET /api/integrations`, `GET /api/integrations/:id`, `POST /api/integrations/:id/credentials`, `POST /api/integrations/:id/run`, `DELETE /api/integrations/:id`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/__tests__/integration/integrations.test.js`:
```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: FAIL — `api/src/routes/integrations.js` does not exist yet and isn't mounted.

- [ ] **Step 3: Write the implementation**

Create `api/src/routes/integrations.js`:
```js
import { Router } from "express";
import { query, mapRow, mapRows } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sanitiseFields } from "../utils/sanitise.js";
import { storeCredential, revokeCredentials } from "../db/integrationCredentials.js";
import { getConnector } from "../connectors/registry.js";
import { runCollection } from "../utils/collectionRunner.js";

const router = Router();

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM integration_connections WHERE company_id = $1 ORDER BY created_at DESC`,
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.get("/:id", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [parseInt(req.params.id), req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });
  res.json(connection);
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { integrationKey, name, config } = sanitiseFields(req.body, { name: "text" });
  if (!integrationKey || !name) {
    return res.status(400).json({ error: "integrationKey and name are required" });
  }
  const result = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name, config, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.companyId, integrationKey, name, JSON.stringify(config || {}), req.user.userId]
  );
  const connection = mapRow(result);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_CREATED", resource: "integration_connections", detail: { connectionId: connection.id, integrationKey } });
  res.status(201).json(connection);
}));

router.post("/:id/credentials", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  const { authType, secret } = req.body;
  if (!authType || !secret) {
    return res.status(400).json({ error: "authType and secret are required" });
  }

  await storeCredential({ connectionId, companyId: req.user.companyId, authType, secret });

  const connector = getConnector(connection.integrationKey);
  try {
    const testResult = await connector.testConnection({ authType, config: connection.config, secret });
    await query(
      `UPDATE integration_connections SET status = 'connected', external_account_id = $1, updated_at = NOW() WHERE id = $2`,
      [testResult.externalAccountId || null, connectionId]
    );
  } catch (err) {
    await query(`UPDATE integration_connections SET status = 'error', updated_at = NOW() WHERE id = $1`, [connectionId]);
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_TEST_FAILED", resource: "integration_connections", detail: { connectionId, error: err.message } });
    return res.status(400).json({ error: `Connection test failed: ${err.message}` });
  }

  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CREDENTIAL_STORED", resource: "integration_credentials", detail: { connectionId, authType } });

  const updated = await query(`SELECT * FROM integration_connections WHERE id = $1`, [connectionId]);
  res.json(mapRow(updated));
}));

router.post("/:id/run", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  try {
    const run = await runCollection({ connectionId, companyId: req.user.companyId, triggeredBy: req.user.userId, triggerType: "manual" });
    res.json(run);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `UPDATE integration_connections SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE id = $1 AND company_id = $2 RETURNING *`,
    [connectionId, req.user.companyId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Connection not found" });

  await revokeCredentials(connectionId, req.user.companyId);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_REVOKED", resource: "integration_connections", detail: { connectionId } });

  res.status(204).send();
}));

export default router;
```

Modify `api/src/routes/index.js` — add the import and mount line (see Task 12 for the combined diff; for this task, add just this router):
```js
import integrationRoutes from "./integrations.js";
// ...
router.use("/integrations", integrationRoutes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/integrations.js api/src/routes/index.js api/src/__tests__/integration/integrations.test.js
git commit -m "feat: add integrations API (connections, credentials, run-now)"
```

---

### Task 11: Findings API routes

**Files:**
- Create: `api/src/routes/findings.js`
- Modify: `api/src/routes/index.js`
- Test: `api/src/__tests__/integration/findings.test.js`

**Interfaces:**
- Consumes: `query`/`mapRow`/`mapRows`/`buildUpdate` (existing), `authenticate`/`requireRole`/`requireReadOnly` (existing), `writeAuditLog` (existing).
- Produces: `GET /api/findings`, `PUT /api/findings/:id`, `POST /api/findings/:id/promote`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/__tests__/integration/findings.test.js`:
```js
import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

async function createFinding(companyId) {
  const conn = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
    [companyId]
  );
  const finding = await query(
    `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title, description)
     VALUES ($1, $2, 'aws.network.s3_public_access_blocked', 'bucket-1', 'critical', 'Bucket exposed', 'bucket-1 does not block public access') RETURNING *`,
    [companyId, conn.rows[0].id]
  );
  return finding.rows[0];
}

describe("GET /api/findings", () => {
  test("lists findings scoped to the caller's company", async () => {
    const companyA = await createCompany({ domain: "a.com" });
    const companyB = await createCompany({ domain: "b.com" });
    await createFinding(companyA.id);
    await createFinding(companyB.id);
    const adminA = await createUser(companyA.id, "ADMIN");

    const res = await request(app).get("/api/findings").set("Authorization", `Bearer ${adminA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

describe("PUT /api/findings/:id", () => {
  test("ADMIN can acknowledge a finding", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    const res = await request(app)
      .put(`/api/findings/${finding.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "acknowledged" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
  });

  test("rejects an invalid status", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    const res = await request(app)
      .put(`/api/findings/${finding.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "bogus" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/findings/:id/promote", () => {
  test("creates a linked remediation action", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    const res = await request(app)
      .post(`/api/findings/${finding.id}/promote`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ owner: "security@testcorp.com", dueDate: "2026-09-01" });

    expect(res.status).toBe(201);

    const findingRow = await query(`SELECT linked_action_id FROM findings WHERE id = $1`, [finding.id]);
    expect(findingRow.rows[0].linked_action_id).toBe(res.body.id);
    expect(res.body.findingId).toBe(finding.id);
  });

  test("refuses to promote the same finding twice", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    await request(app).post(`/api/findings/${finding.id}/promote`).set("Authorization", `Bearer ${admin.token}`).send({});
    const res = await request(app).post(`/api/findings/${finding.id}/promote`).set("Authorization", `Bearer ${admin.token}`).send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_PROMOTED");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npm run test:integration -- findings.test`
Expected: FAIL — `api/src/routes/findings.js` does not exist yet and isn't mounted.

- [ ] **Step 3: Write the implementation**

Create `api/src/routes/findings.js`:
```js
import { Router } from "express";
import { query, mapRow, mapRows, buildUpdate } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = Router();

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "VIEWER"]), asyncHandler(async (req, res) => {
  const { status, severity } = req.query;
  const conditions = ["company_id = $1"];
  const values = [req.user.companyId];
  if (status) { values.push(status); conditions.push(`status = $${values.length}`); }
  if (severity) { values.push(severity); conditions.push(`severity = $${values.length}`); }
  const result = await query(
    `SELECT * FROM findings WHERE ${conditions.join(" AND ")} ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       last_detected_at DESC`,
    values
  );
  res.json(mapRows(result));
}));

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ["open", "acknowledged", "resolved", "suppressed", "false_positive"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }
  const data = {
    status,
    resolved_at: status === "resolved" ? new Date() : null,
    resolved_by: status === "resolved" ? req.user.userId : null,
  };
  const update = buildUpdate(data);
  const result = await query(
    `UPDATE findings SET ${update.set} WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING *`,
    [...update.values, parseInt(req.params.id), req.user.companyId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Finding not found" });
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "FINDING_STATUS_CHANGED", resource: "findings", detail: { findingId: parseInt(req.params.id), status } });
  res.json(mapRow(result));
}));

router.post("/:id/promote", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const findingId = parseInt(req.params.id);
  const findingResult = await query(`SELECT * FROM findings WHERE id = $1 AND company_id = $2`, [findingId, req.user.companyId]);
  const finding = mapRow(findingResult);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  if (finding.linkedActionId) return res.status(409).json({ error: "Finding is already linked to an action", code: "ALREADY_PROMOTED" });

  const { owner, dueDate } = req.body;
  const actionResult = await query(
    `INSERT INTO actions (company_id, defeated_quest, owner, due_date, status, notes, finding_id)
     VALUES ($1, $2, $3, $4, 'OPEN', $5, $6) RETURNING *`,
    [req.user.companyId, finding.title, owner || null, dueDate || null, finding.description, findingId]
  );
  const action = mapRow(actionResult);

  await query(`UPDATE findings SET linked_action_id = $1 WHERE id = $2`, [action.id, findingId]);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "FINDING_PROMOTED_TO_ACTION", resource: "findings", detail: { findingId, actionId: action.id } });

  res.status(201).json({ ...action, findingId });
}));

export default router;
```

Modify `api/src/routes/index.js` — add the import and mount line (see Task 12 for the combined diff).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npm run test:integration -- findings.test`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/findings.js api/src/routes/index.js api/src/__tests__/integration/findings.test.js
git commit -m "feat: add findings API (list, update status, promote to action)"
```

---

### Task 12: Wire up routes and run the full suite

**Files:**
- Modify: `api/src/routes/index.js`

**Interfaces:**
- Consumes: `integrationRoutes` (Task 10), `findingRoutes` (Task 11).
- Produces: `/api/integrations/*` and `/api/findings/*` reachable from the running app.

- [ ] **Step 1: Finalize the route mounting**

Ensure `api/src/routes/index.js` has both imports and both mount lines (idempotent if Tasks 10/11 already added them — this step is the checkpoint that both are present together):
```js
import integrationRoutes from "./integrations.js";
import findingRoutes from "./findings.js";
```
```js
router.use("/integrations", integrationRoutes);
router.use("/findings", findingRoutes);
```
Place both alongside the other route mounts, e.g. after `router.use("/self-assessment", selfAssessmentRoutes);`.

- [ ] **Step 2: Run the full unit test suite**

Run: `cd api && npm test`
Expected: PASS — all existing unit tests plus the 6 new unit test files from Tasks 2, 4–8 (`credentialCrypto`, `connectorsAwsCredentials`, `connectorsAwsIam`, `connectorsAwsLogging`, `connectorsAwsNetwork`, `connectorsRegistry`).

- [ ] **Step 3: Run the full integration test suite**

Run: `cd api && npm run test:integration`
Expected: PASS — all existing integration tests plus the 5 new integration test files from Tasks 1, 3, 9, 10, 11. Requires a local Postgres reachable at `postgresql://postgres:postgres@localhost:5432/prism_test`.

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/index.js
git commit -m "feat: mount integrations and findings routes"
```

---

## Self-Review Notes

- **Spec coverage:** §D (pipeline stages) → Tasks 4–9 implement auth/collection/normalization/test/evidence/finding/audit stages end to end. §E (AWS v1 prioritization) → Task 1 seeds exactly the 7 Tier-1 tests; Tasks 5–7 implement them. §F (database design) → Task 1 creates all 9 new tables + the `actions.finding_id` column, matching the spec's table list exactly. §G (credential security) → Tasks 2–3 (encryption, crypto-shred on revoke), Task 4 (IAM-role-preferred AssumeRole), Task 10 (credentials never in responses, every touch audit-logged). §H (multi-tenancy) → every table `company_id`-scoped, every query filtered, cross-tenant isolation explicitly tested in Tasks 10–11. §L Phase 1 acceptance criteria → covered by Tasks 9–11's integration tests (connect → run → evidence generated → finding created → promote → no plaintext secrets → revoke works → cross-tenant isolation).
- **Deferred by design, not oversight:** scheduling/BullMQ (§I, Phase 2), the Settings/Findings frontend UI (§J, a separate follow-up plan), Tier 2/3 AWS checks and non-AWS connectors (§L "what NOT to build yet").
- **Type consistency verified:** `resolveAwsCredentials`, `iamTests`/`loggingTests`/`networkTests`, `getConnector`/`listConnectorTests`, `storeCredential`/`getActiveCredential`/`revokeCredentials`, and `runCollection` are each defined once and consumed with matching signatures in every downstream task.
