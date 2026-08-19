# Azure Evidence Collection (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Microsoft Azure as a second evidence-collection connector alongside AWS — 4 Tier-1 read-only checks (storage public access, NSG open ingress, Defender for Cloud enabled, Activity Log diagnostics enabled), authenticated via a Service Principal (Tenant ID/Client ID/Client Secret), proving the existing connector architecture is genuinely provider-agnostic.

**Architecture:** Mirrors `api/src/connectors/aws/` exactly — a connector module (`key`, `tests`, `testConnection`, `runTests`) registered in `connectors/registry.js`, with credential resolution (`credentials.js`) encapsulated per-connector and zero changes needed to `collectionRunner.js` (already provider-agnostic — verified by reading it in full). Azure SDK clients differ from AWS SDK v3 in two structural ways this plan handles explicitly: they take a `TokenCredential` *instance* (not a plain object) at construction, and most `list()` operations return a `PagedAsyncIterableIterator` (`for await`) rather than a single response object — except `SecurityCenter`'s `pricings.list()`, which returns a plain `Promise<{value: [...]}>`. Both API shapes were verified against the current Microsoft Learn API reference before writing this plan, not assumed from AWS's pattern.

**Tech Stack:** `@azure/identity` (`ClientSecretCredential`), `@azure/arm-storage`, `@azure/arm-network`, `@azure/arm-security`, `@azure/arm-monitor`, `@azure/arm-resources` — six new `api/package.json` dependencies, no others.

**Spec:** `/Users/aum/.claude/plans/fancy-roaming-neumann.md` (the approved plan-mode design doc) — read it for the full rationale, the deferred Phase 2 scope (Graph-API-dependent MFA/password-policy/credential-rotation checks), and the six open questions already resolved during planning (Phase 1 = ARM-only, confirmed with the user).

## Global Constraints

- Every query touching tenant data must filter on `company_id = req.user.companyId` — this plan adds no new tenant-scoped routes beyond the existing `POST /:id/credentials`/`POST /:id/run` pattern already enforcing this; the one new route (`GET /azure/setup-info`) returns a static, non-tenant-scoped role definition, matching `GET /aws/setup-info`'s exact pattern.
- No BullMQ/queue, no scheduling — this plan is backend-only, manual-trigger evidence collection, exactly like the AWS connector.
- Credentials never appear in API responses, every credential touch is audit-logged — already enforced generically by `routes/integrations.js`'s existing `POST /:id/credentials` handler; this plan adds no new credential-touching route.
- `status` on every `evidence_test_results` row must be one of `'pass'|'fail'|'warn'|'error'|'not_applicable'` (DB CHECK constraint, `init.sql:562`) — every Azure test's `run()` function is bound by this exactly like AWS's.
- Exact port-list parity with AWS's NSG-equivalent check: ports 22 and 3389 only, no broader "risky port" heuristics — so the two connectors' evidence stays directly comparable to an auditor (per the approved plan).
- Subscription-level Activity Log diagnostic settings only (not per-resource) — matches AWS's account-wide CloudTrail check's scope exactly (per the approved plan).
- Real Azure SDK API surface only — every client class name, constructor signature, and method name in this plan was verified against the current Microsoft Learn API reference (`learn.microsoft.com/en-us/javascript/api/@azure/...`) during planning, not assumed from memory or from AWS's SDK shape.

---

## File Structure

- Modify: `init.sql` — one `integrations` seed row, four `automated_tests` seed rows, four `test_control_mappings` seed rows (Azure Phase 1)
- Modify: `api/package.json` — six new `@azure/*` dependencies
- Create: `api/src/connectors/azure/credentials.js` — `resolveAzureCredentials({authType, config, secret})`
- Create: `api/src/connectors/azure/tests/network.js` — storage public access + NSG open-ingress checks
- Create: `api/src/connectors/azure/tests/logging.js` — Defender for Cloud + Activity Log diagnostics checks
- Create: `api/src/connectors/azure/index.js` — `key`, `tests`, `buildClients`, `testConnection`, `runTests`
- Modify: `api/src/connectors/registry.js` — register the azure connector
- Modify: `api/src/routes/integrations.js` — `AZURE_READ_ONLY_ROLE_DEFINITION` const + `GET /azure/setup-info`
- Create: `api/src/__tests__/connectorsAzureCredentials.test.js`
- Create: `api/src/__tests__/connectorsAzureNetwork.test.js`
- Create: `api/src/__tests__/connectorsAzureLogging.test.js`
- Create: `api/src/__tests__/connectorsAzureIndex.test.js`
- Modify: `api/src/__tests__/connectorsRegistry.test.js` — the existing "throws for an unknown integration" test uses `"azure"` as its example of an unregistered key; this plan registers azure, so that test must be updated (see Task 6) or it will start failing the moment azure is wired in
- Modify: `api/src/__tests__/integration/collectionRunner.test.js` — prove `collectionRunner.js`'s genericity holds for a second, differently-shaped connector, not just in theory
- Modify: `api/src/__tests__/integration/integrations.test.js` — `GET /azure/setup-info` coverage

---

### Task 1: Schema seed + dependencies

**Files:**
- Modify: `init.sql`
- Modify: `api/package.json`
- Test: `api/src/__tests__/integration/schema.evidenceCollection.test.js`

**Interfaces:**
- Produces: an `integrations` row with `key = 'azure'`, `auth_type = 'oauth2'`; four `automated_tests` rows keyed `azure.*`; four `test_control_mappings` rows mapping each to an ISO 27001 reference. These test keys are consumed verbatim by Task 3/4's `tests` arrays — they must match exactly.

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/schema.evidenceCollection.test.js` (inside its existing top-level `describe` block — read the file first to match its existing style, e.g. `describe("evidence collection schema", ...)`):

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- schema.evidenceCollection.test`
Expected: FAIL — no `azure` row exists in `integrations` yet, `integrationResult.rows.length` is `0`.

- [ ] **Step 3: Write the implementation**

In `init.sql`, immediately after the existing AWS seed block (the `INSERT INTO test_control_mappings ... VALUES ('aws.network.security_groups_no_open_ingress', 'A.13.1.1') ON CONFLICT ...;` line — the last line of the existing "Automated Evidence Collection: catalog seed data" section), append:

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('azure', 'Microsoft Azure', 'cloud', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, severity_default) VALUES
  ('azure', 'azure.logging.activity_log_diagnostics_enabled', 'Activity Log diagnostic settings are configured', 'critical'),
  ('azure', 'azure.security.defender_enabled', 'Microsoft Defender for Cloud is enabled', 'medium'),
  ('azure', 'azure.storage.public_access_blocked', 'Storage accounts block public blob access', 'critical'),
  ('azure', 'azure.network.nsg_no_open_ingress', 'Network security groups do not expose management ports publicly', 'critical')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('azure.logging.activity_log_diagnostics_enabled', 'A.12.4.1'),
  ('azure.security.defender_enabled', 'A.12.1.1'),
  ('azure.storage.public_access_blocked', 'A.8.2.3'),
  ('azure.network.nsg_no_open_ingress', 'A.13.1.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

Then install the six new dependencies:
```bash
cd api && npm install @azure/identity @azure/arm-storage @azure/arm-network @azure/arm-security @azure/arm-monitor @azure/arm-resources
```

Integration tests reload `init.sql` fresh via `globalSetup.js` on every `npm run test:integration` run (it's the schema/seed source of truth), so no separate migration step is needed for the test DB.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- schema.evidenceCollection.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add init.sql api/package.json api/package-lock.json api/src/__tests__/integration/schema.evidenceCollection.test.js
git commit -m "feat: seed Azure connector catalog and Phase-1 automated tests"
```

---

### Task 2: Azure credential resolution

**Files:**
- Create: `api/src/connectors/azure/credentials.js`
- Test: `api/src/__tests__/connectorsAzureCredentials.test.js`

**Interfaces:**
- Produces: `resolveAzureCredentials({authType, config, secret}) => Promise<ClientSecretCredential>`. Unlike `resolveAwsCredentials` (which returns a plain `{accessKeyId, secretAccessKey, sessionToken}` object), this returns a `ClientSecretCredential` *instance* — Azure SDK management clients take a `TokenCredential` object at construction, not a plain credentials bag. Task 5's `buildClients` passes this return value straight into each ARM client's constructor.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsAzureCredentials.test.js`:

```js
import { describe, test, expect, vi } from "vitest";

vi.mock("@azure/identity", () => ({
  ClientSecretCredential: vi.fn(function (tenantId, clientId, clientSecret) {
    this.tenantId = tenantId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }),
}));

const { resolveAzureCredentials } = await import("../connectors/azure/credentials.js");
const { ClientSecretCredential } = await import("@azure/identity");

describe("resolveAzureCredentials", () => {
  test("constructs a ClientSecretCredential from tenantId/clientId/clientSecret for oauth2 auth", async () => {
    const credential = await resolveAzureCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", subscriptionId: "sub-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(ClientSecretCredential).toHaveBeenCalledWith("tenant-1", "client-1", "shh");
    expect(credential).toBeInstanceOf(ClientSecretCredential);
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveAzureCredentials({ authType: "access_key", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported Azure auth type: access_key");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsAzureCredentials.test.js`
Expected: FAIL — `Cannot find module '../connectors/azure/credentials.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/azure/credentials.js`:

```js
import { ClientSecretCredential } from "@azure/identity";

export async function resolveAzureCredentials({ authType, config, secret }) {
  if (authType === "oauth2") {
    return new ClientSecretCredential(config.tenantId, secret.clientId, secret.clientSecret);
  }

  throw new Error(`Unsupported Azure auth type: ${authType}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsAzureCredentials.test.js`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/azure/credentials.js api/src/__tests__/connectorsAzureCredentials.test.js
git commit -m "feat: add Azure Service Principal credential resolution"
```

---

### Task 3: Azure network checks (storage public access, NSG open ingress)

**Files:**
- Create: `api/src/connectors/azure/tests/network.js`
- Test: `api/src/__tests__/connectorsAzureNetwork.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `networkTests` (array of `{key, title, severityDefault, isoReferences, run}`), `checkStoragePublicAccessBlocked(storage)`, `checkNsgNoOpenIngress(network)` — each `run(client)` returns `Promise<Array<{resourceId, status, message, evidencePayload}>>`. `storage`/`network` are Azure SDK client instances (`StorageManagementClient`/`NetworkManagementClient`) whose `.storageAccounts.list()`/`.networkSecurityGroups.listAll()` methods return `PagedAsyncIterableIterator` — verified against the current `@azure/arm-storage`/`@azure/arm-network` API reference. Task 5's `buildClients` supplies these as `clients.storage`/`clients.network`.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsAzureNetwork.test.js`:

```js
import { describe, test, expect } from "vitest";
import { checkStoragePublicAccessBlocked, checkNsgNoOpenIngress } from "../connectors/azure/tests/network.js";

function asyncIterable(items) {
  return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

describe("checkStoragePublicAccessBlocked", () => {
  test("passes an account with public blob access explicitly disabled", async () => {
    const storage = { storageAccounts: { list: () => asyncIterable([{ id: "/subscriptions/s/storageAccounts/a", name: "a", allowBlobPublicAccess: false }]) } };
    const results = await checkStoragePublicAccessBlocked(storage);
    expect(results).toEqual([{ resourceId: "/subscriptions/s/storageAccounts/a", status: "pass", message: "a blocks public blob access", evidencePayload: { accountName: "a", allowBlobPublicAccess: false } }]);
  });

  test("passes an account where the field is unset (Azure's documented default is false)", async () => {
    const storage = { storageAccounts: { list: () => asyncIterable([{ id: "/subscriptions/s/storageAccounts/b", name: "b" }]) } };
    const results = await checkStoragePublicAccessBlocked(storage);
    expect(results[0].status).toBe("pass");
  });

  test("fails an account with public blob access enabled", async () => {
    const storage = { storageAccounts: { list: () => asyncIterable([{ id: "/subscriptions/s/storageAccounts/c", name: "c", allowBlobPublicAccess: true }]) } };
    const results = await checkStoragePublicAccessBlocked(storage);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no storage accounts", async () => {
    const storage = { storageAccounts: { list: () => asyncIterable([]) } };
    const results = await checkStoragePublicAccessBlocked(storage);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No storage accounts found", evidencePayload: {} }]);
  });
});

describe("checkNsgNoOpenIngress", () => {
  test("passes an NSG with no security rules", async () => {
    const network = { networkSecurityGroups: { listAll: () => asyncIterable([{ id: "/subscriptions/s/nsg/x", name: "x", securityRules: [] }]) } };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("pass");
  });

  test("fails an NSG allowing inbound port 22 from *", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/y", name: "y",
          securityRules: [{ name: "allow-ssh", direction: "Inbound", access: "Allow", sourceAddressPrefix: "*", destinationPortRange: "22" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("fail");
  });

  test("fails an NSG allowing inbound port 3389 from Internet via a port range", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/rdp", name: "rdp-box",
          securityRules: [{ name: "allow-rdp-range", direction: "Inbound", access: "Allow", sourceAddressPrefix: "Internet", destinationPortRange: "3300-3400" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("fail");
  });

  test("passes an NSG allowing inbound port 22 only from a specific CIDR", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/z", name: "z",
          securityRules: [{ name: "allow-ssh-office", direction: "Inbound", access: "Allow", sourceAddressPrefix: "203.0.113.0/24", destinationPortRange: "22" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("pass");
  });

  test("passes an NSG allowing 0.0.0.0/0 on an unrelated port (443)", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/web", name: "web",
          securityRules: [{ name: "allow-https", direction: "Inbound", access: "Allow", sourceAddressPrefix: "0.0.0.0/0", destinationPortRange: "443" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("pass");
  });

  test("returns not_applicable when there are no network security groups", async () => {
    const network = { networkSecurityGroups: { listAll: () => asyncIterable([]) } };
    const results = await checkNsgNoOpenIngress(network);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No network security groups found", evidencePayload: {} }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsAzureNetwork.test.js`
Expected: FAIL — `Cannot find module '../connectors/azure/tests/network.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/azure/tests/network.js`:

```js
const RISKY_PORTS = [22, 3389];
const OPEN_SOURCE_PREFIXES = ["*", "0.0.0.0/0", "internet", "any"];

function portRangeIncludesRiskyPort(portRange) {
  if (!portRange) return false;
  if (portRange === "*") return true;
  const single = Number(portRange);
  if (!Number.isNaN(single)) return RISKY_PORTS.includes(single);
  const rangeMatch = portRange.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const [, start, end] = rangeMatch;
    return RISKY_PORTS.some((port) => port >= Number(start) && port <= Number(end));
  }
  return false;
}

function isOpenIngressRule(rule) {
  if (rule.direction !== "Inbound" || rule.access !== "Allow") return false;
  const source = (rule.sourceAddressPrefix || "").toLowerCase();
  if (!OPEN_SOURCE_PREFIXES.includes(source)) return false;
  const ranges = [rule.destinationPortRange, ...(rule.destinationPortRanges || [])];
  return ranges.some(portRangeIncludesRiskyPort);
}

export async function checkStoragePublicAccessBlocked(storage) {
  const results = [];
  for await (const account of storage.storageAccounts.list()) {
    // Azure's own docs: "The default interpretation is false for this property" —
    // an unset/null field means public access is NOT allowed, only an explicit
    // `true` means it is.
    const blocked = account.allowBlobPublicAccess !== true;
    results.push({
      resourceId: account.id,
      status: blocked ? "pass" : "fail",
      message: blocked ? `${account.name} blocks public blob access` : `${account.name} allows public blob access`,
      evidencePayload: { accountName: account.name, allowBlobPublicAccess: account.allowBlobPublicAccess ?? null },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No storage accounts found", evidencePayload: {} });
  }
  return results;
}

export async function checkNsgNoOpenIngress(network) {
  const results = [];
  for await (const nsg of network.networkSecurityGroups.listAll()) {
    const openRules = (nsg.securityRules || []).filter(isOpenIngressRule);
    results.push({
      resourceId: nsg.id,
      status: openRules.length === 0 ? "pass" : "fail",
      message: openRules.length === 0
        ? `${nsg.name} does not expose ports 22/3389 to the internet`
        : `${nsg.name} allows inbound access to ports 22/3389 from ${openRules.map((r) => r.sourceAddressPrefix).join(", ")}`,
      evidencePayload: { nsgName: nsg.name, openRuleNames: openRules.map((r) => r.name) },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No network security groups found", evidencePayload: {} });
  }
  return results;
}

export const networkTests = [
  { key: "azure.storage.public_access_blocked", title: "Storage accounts block public blob access", severityDefault: "critical", isoReferences: ["A.8.2.3"], run: (clients) => checkStoragePublicAccessBlocked(clients.storage) },
  { key: "azure.network.nsg_no_open_ingress", title: "Network security groups do not expose management ports publicly", severityDefault: "critical", isoReferences: ["A.13.1.1"], run: (clients) => checkNsgNoOpenIngress(clients.network) },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsAzureNetwork.test.js`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/azure/tests/network.js api/src/__tests__/connectorsAzureNetwork.test.js
git commit -m "feat: add Azure storage and network security group checks"
```

---

### Task 4: Azure logging checks (Defender for Cloud, Activity Log diagnostics)

**Files:**
- Create: `api/src/connectors/azure/tests/logging.js`
- Test: `api/src/__tests__/connectorsAzureLogging.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `loggingTests` (same shape as Task 3's `networkTests`), `checkDefenderForCloudEnabled(security)`, `checkActivityLogDiagnosticsEnabled(monitor, subscriptionId)`. `security` is a `SecurityCenter` instance whose `.pricings.list()` returns a plain `Promise<{value: Pricing[]}>` — **not** a paged iterator, verified against the current `@azure/arm-security` API reference (this is a genuine, non-obvious difference from Task 3's clients). `monitor` is a `MonitorClient` instance whose `.diagnosticSettings.list(resourceUri)` **does** return a `PagedAsyncIterableIterator` and requires a `resourceUri` argument — for subscription-level Activity Log settings, that URI is `/subscriptions/{subscriptionId}`, which is why this function takes `subscriptionId` as a second parameter (all other check functions in this connector take only their client). Task 5's `buildClients` supplies `clients.security`/`clients.monitor`/`clients.subscriptionId`.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsAzureLogging.test.js`:

```js
import { describe, test, expect } from "vitest";
import { checkDefenderForCloudEnabled, checkActivityLogDiagnosticsEnabled } from "../connectors/azure/tests/logging.js";

function asyncIterable(items) {
  return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

describe("checkDefenderForCloudEnabled", () => {
  test("fails a resource type on the Free tier", async () => {
    const security = { pricings: { list: async () => ({ value: [{ id: "/subscriptions/s/pricings/VirtualMachines", name: "VirtualMachines", pricingTier: "Free" }] }) } };
    const results = await checkDefenderForCloudEnabled(security);
    expect(results).toEqual([{ resourceId: "/subscriptions/s/pricings/VirtualMachines", status: "fail", message: "Defender for Cloud is not enabled for VirtualMachines (tier: Free)", evidencePayload: { resourceType: "VirtualMachines", pricingTier: "Free" } }]);
  });

  test("passes a resource type on the Standard tier", async () => {
    const security = { pricings: { list: async () => ({ value: [{ id: "/subscriptions/s/pricings/StorageAccounts", name: "StorageAccounts", pricingTier: "Standard" }] }) } };
    const results = await checkDefenderForCloudEnabled(security);
    expect(results[0].status).toBe("pass");
  });

  test("evaluates every returned resource type independently", async () => {
    const security = {
      pricings: {
        list: async () => ({
          value: [
            { id: "/subscriptions/s/pricings/VirtualMachines", name: "VirtualMachines", pricingTier: "Standard" },
            { id: "/subscriptions/s/pricings/SqlServers", name: "SqlServers", pricingTier: "Free" },
          ],
        }),
      },
    };
    const results = await checkDefenderForCloudEnabled(security);
    expect(results.length).toBe(2);
    expect(results.find((r) => r.evidencePayload.resourceType === "VirtualMachines").status).toBe("pass");
    expect(results.find((r) => r.evidencePayload.resourceType === "SqlServers").status).toBe("fail");
  });

  test("returns not_applicable when no pricing configurations are returned", async () => {
    const security = { pricings: { list: async () => ({ value: [] }) } };
    const results = await checkDefenderForCloudEnabled(security);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No Defender for Cloud pricing configurations found", evidencePayload: {} }]);
  });
});

describe("checkActivityLogDiagnosticsEnabled", () => {
  test("fails when no diagnostic settings exist for the subscription", async () => {
    const monitor = { diagnosticSettings: { list: () => asyncIterable([]) } };
    const results = await checkActivityLogDiagnosticsEnabled(monitor, "sub-1");
    expect(results).toEqual([{ resourceId: "subscription", status: "fail", message: "No diagnostic settings are configured for the subscription Activity Log", evidencePayload: {} }]);
  });

  test("passes and requests the subscription-scoped resource URI when at least one diagnostic setting exists", async () => {
    let requestedUri = null;
    const monitor = {
      diagnosticSettings: {
        list: (resourceUri) => {
          requestedUri = resourceUri;
          return asyncIterable([{ id: "/subscriptions/sub-1/providers/microsoft.insights/diagnosticSettings/to-log-analytics", name: "to-log-analytics" }]);
        },
      },
    };
    const results = await checkActivityLogDiagnosticsEnabled(monitor, "sub-1");
    expect(requestedUri).toBe("/subscriptions/sub-1");
    expect(results[0].status).toBe("pass");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsAzureLogging.test.js`
Expected: FAIL — `Cannot find module '../connectors/azure/tests/logging.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/azure/tests/logging.js`:

```js
export async function checkDefenderForCloudEnabled(security) {
  const { value: pricings } = await security.pricings.list();
  const results = (pricings || []).map((pricing) => {
    const enabled = pricing.pricingTier === "Standard";
    return {
      resourceId: pricing.id || pricing.name,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? `Defender for Cloud is enabled for ${pricing.name}`
        : `Defender for Cloud is not enabled for ${pricing.name} (tier: ${pricing.pricingTier})`,
      evidencePayload: { resourceType: pricing.name, pricingTier: pricing.pricingTier },
    };
  });
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No Defender for Cloud pricing configurations found", evidencePayload: {} });
  }
  return results;
}

export async function checkActivityLogDiagnosticsEnabled(monitor, subscriptionId) {
  const results = [];
  for await (const setting of monitor.diagnosticSettings.list(`/subscriptions/${subscriptionId}`)) {
    results.push({
      resourceId: setting.id || setting.name,
      status: "pass",
      message: `Diagnostic setting "${setting.name}" is configured for the subscription Activity Log`,
      evidencePayload: { name: setting.name },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "fail", message: "No diagnostic settings are configured for the subscription Activity Log", evidencePayload: {} });
  }
  return results;
}

export const loggingTests = [
  { key: "azure.security.defender_enabled", title: "Microsoft Defender for Cloud is enabled", severityDefault: "medium", isoReferences: ["A.12.1.1"], run: (clients) => checkDefenderForCloudEnabled(clients.security) },
  { key: "azure.logging.activity_log_diagnostics_enabled", title: "Activity Log diagnostic settings are configured", severityDefault: "critical", isoReferences: ["A.12.4.1"], run: (clients) => checkActivityLogDiagnosticsEnabled(clients.monitor, clients.subscriptionId) },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsAzureLogging.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/azure/tests/logging.js api/src/__tests__/connectorsAzureLogging.test.js
git commit -m "feat: add Azure Defender for Cloud and Activity Log diagnostics checks"
```

---

### Task 5: Azure connector assembly + registry wiring

**Files:**
- Create: `api/src/connectors/azure/index.js`
- Modify: `api/src/connectors/registry.js`
- Test: `api/src/__tests__/connectorsAzureIndex.test.js`
- Test: `api/src/__tests__/connectorsRegistry.test.js`

**Interfaces:**
- Consumes: `resolveAzureCredentials` (Task 2), `networkTests` (Task 3), `loggingTests` (Task 4).
- Produces: `key = "azure"`, `tests` (array), `testConnection({authType, config, secret}) => {ok, externalAccountId}`, `runTests({authType, config, secret}) => Array<{testKey, title, severity, resourceId, status, message, evidencePayload}>` — the exact same contract `collectionRunner.js` already calls generically on any connector. `getConnector("azure")` now resolves to this module.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsAzureIndex.test.js`:

```js
import { describe, test, expect, vi } from "vitest";

vi.mock("@azure/identity", () => ({
  ClientSecretCredential: vi.fn(function () {}),
}));
vi.mock("@azure/arm-storage", () => ({
  StorageManagementClient: vi.fn(() => ({
    storageAccounts: { list: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-network", () => ({
  NetworkManagementClient: vi.fn(() => ({
    networkSecurityGroups: { listAll: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-security", () => ({
  SecurityCenter: vi.fn(() => ({
    pricings: { list: async () => ({ value: [] }) },
  })),
}));
vi.mock("@azure/arm-monitor", () => ({
  MonitorClient: vi.fn(() => ({
    diagnosticSettings: { list: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));

const { runTests, tests } = await import("../connectors/azure/index.js");

describe("runTests", () => {
  test("propagates each test's human-readable title alongside its key", async () => {
    const results = await runTests({
      authType: "oauth2",
      config: { tenantId: "tenant-1", subscriptionId: "sub-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(results.length).toBe(4);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
    }

    const nsgResult = results.find((r) => r.testKey === "azure.network.nsg_no_open_ingress");
    expect(nsgResult.title).toBe("Network security groups do not expose management ports publicly");
    expect(nsgResult.status).toBe("not_applicable");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsAzureIndex.test.js`
Expected: FAIL — `Cannot find module '../connectors/azure/index.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/azure/index.js`:

```js
import { StorageManagementClient } from "@azure/arm-storage";
import { NetworkManagementClient } from "@azure/arm-network";
import { SecurityCenter } from "@azure/arm-security";
import { MonitorClient } from "@azure/arm-monitor";
import { ResourceManagementClient } from "@azure/arm-resources";
import { resolveAzureCredentials } from "./credentials.js";
import { networkTests } from "./tests/network.js";
import { loggingTests } from "./tests/logging.js";

export const key = "azure";

export const tests = [...loggingTests, ...networkTests];

function buildClients(credential, subscriptionId) {
  return {
    storage: new StorageManagementClient(credential, subscriptionId),
    network: new NetworkManagementClient(credential, subscriptionId),
    security: new SecurityCenter(credential, subscriptionId),
    monitor: new MonitorClient(credential, subscriptionId),
    subscriptionId,
  };
}

export async function testConnection({ authType, config, secret }) {
  const credential = await resolveAzureCredentials({ authType, config, secret });
  const resources = new ResourceManagementClient(credential, config.subscriptionId);
  // Forces the first page fetch — throws if the Service Principal can't
  // authenticate or lacks access to the subscription. This is Azure's
  // analog of AWS's STS GetCallerIdentity connectivity probe.
  await resources.resourceGroups.list().next();
  return { ok: true, externalAccountId: config.subscriptionId };
}

export async function runTests({ authType, config, secret }) {
  const credential = await resolveAzureCredentials({ authType, config, secret });
  const clients = buildClients(credential, config.subscriptionId);
  const runResults = [];
  for (const test of tests) {
    const results = await test.run(clients);
    for (const result of results) {
      runResults.push({ testKey: test.key, title: test.title, severity: test.severityDefault, ...result });
    }
  }
  return runResults;
}
```

Modify `api/src/connectors/registry.js`:

```js
import * as aws from "./aws/index.js";
import * as azure from "./azure/index.js";

const connectors = { [aws.key]: aws, [azure.key]: azure };
```

(the rest of the file — `getConnector`/`listConnectorTests` — is unchanged).

Modify `api/src/__tests__/connectorsRegistry.test.js` — the existing test uses `"azure"` as its example of an *unregistered* key, which now resolves successfully; replace it with a genuinely-unregistered key and add coverage for the newly-registered azure connector:

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

  test("throws for an unknown integration", () => {
    expect(() => getConnector("gcp")).toThrow("Unknown integration: gcp");
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/connectorsAzureIndex.test.js src/__tests__/connectorsRegistry.test.js`
Expected: PASS, 6/6 total (1 + 5).

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/azure/index.js api/src/connectors/registry.js api/src/__tests__/connectorsAzureIndex.test.js api/src/__tests__/connectorsRegistry.test.js
git commit -m "feat: assemble the Azure connector and register it"
```

---

### Task 6: `azure/setup-info` route

**Files:**
- Modify: `api/src/routes/integrations.js`
- Test: `api/src/__tests__/integration/integrations.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (this route is static — see below).
- Produces: `GET /api/integrations/azure/setup-info` → `{roleDefinition: {...}}`.

Unlike `GET /aws/setup-info` (Prism calls out to AWS STS to resolve its own principal ARN for a trust policy), Azure has no "assumable role"/trust-policy concept at all — a Service Principal is entirely customer-created, with no Prism-side identity to reference. So this endpoint needs no live network call and no `principalArn`/`principalError` fields; it's a static role-definition JSON, kept in lockstep with exactly what `azure/tests/{network,logging}.js` and `azure/index.js`'s `testConnection` actually call (mirroring `AWS_READ_ONLY_POLICY`'s "policy in code = policy in docs" discipline).

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/integrations.test.js` (alongside the existing `describe("GET /api/integrations/aws/setup-info", ...)` block — same file, same pattern):

```js
describe("GET /api/integrations/azure/setup-info", () => {
  test("returns a static least-privilege role definition, no live Azure call needed", async () => {
    const company = await createCompany({ domain: "azuresetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/azure/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.roleDefinition.IsCustom).toBe(true);
    expect(res.body.roleDefinition.Actions).toContain("Microsoft.Storage/storageAccounts/read");
    expect(res.body.roleDefinition.Actions).toContain("Microsoft.Network/networkSecurityGroups/read");
    expect(res.body.roleDefinition.Actions).toContain("Microsoft.Security/pricings/read");
    expect(res.body.roleDefinition.Actions).toContain("Microsoft.Insights/diagnosticSettings/read");
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "azuresetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/azure/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: FAIL — `res.body.roleDefinition` is `undefined` (404, no matching route).

- [ ] **Step 3: Write the implementation**

In `api/src/routes/integrations.js`, add this constant near the existing `AWS_READ_ONLY_POLICY` constant, and the route immediately after the existing `router.get("/aws/setup-info", ...)` handler:

```js
const AZURE_READ_ONLY_ROLE_DEFINITION = {
  Name: "Prism Read-Only Evidence Collection",
  IsCustom: true,
  Description: "Least-privilege read access for Prism's automated ISO 27001 evidence collection.",
  Actions: [
    "Microsoft.Storage/storageAccounts/read",
    "Microsoft.Network/networkSecurityGroups/read",
    "Microsoft.Insights/diagnosticSettings/read",
    "Microsoft.Security/pricings/read",
    "Microsoft.Resources/subscriptions/resourceGroups/read",
  ],
  NotActions: [],
  AssignableScopes: ["/subscriptions/<subscription-id>"],
};

router.get("/azure/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ roleDefinition: AZURE_READ_ONLY_ROLE_DEFINITION });
}));
```

Note `Microsoft.Resources/subscriptions/resourceGroups/read` is included because `azure/index.js`'s `testConnection` (Task 5) calls `resources.resourceGroups.list()` as its connectivity probe — the role definition must grant every action the connector's code actually calls, not just the 4 checks' actions.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/integrations.js api/src/__tests__/integration/integrations.test.js
git commit -m "feat: add Azure setup-info endpoint with least-privilege role definition"
```

---

### Task 7: `collectionRunner` cross-connector regression coverage

**Files:**
- Modify: `api/src/__tests__/integration/collectionRunner.test.js`

**Interfaces:**
- Consumes: nothing new — this task adds test coverage only, no production code changes (per the plan's Global Constraints, `collectionRunner.js` was already verified 100% provider-agnostic).

The existing file's `vi.mock("../../connectors/registry.js", ...)` hardcodes `getConnector` to always return the same AWS-shaped fake object regardless of the `integrationKey` argument passed to it. This task makes the mock argument-aware so a new test can prove `collectionRunner.js` behaves identically end-to-end for a `azure`-keyed connection — not just an AWS-keyed one — locking in the "zero coupling" claim under a second real connector rather than leaving it as an untested assertion.

- [ ] **Step 1: Write the failing test**

Modify `api/src/__tests__/integration/collectionRunner.test.js` — replace the top-level mock:

```js
vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn(() => ({
    key: "aws",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "123456789012" })),
    runTests: vi.fn(async () => ([
      { testKey: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: { userName: "alice" } },
      { testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", resourceId: "bucket-1", status: "fail", message: "Public access not blocked", evidencePayload: { bucket: "bucket-1" } },
    ])),
  })),
}));
```

with an argument-aware version that keeps the exact same AWS behavior for `"aws"` (so the file's three existing tests are unaffected) and adds an azure-shaped fixture:

```js
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
};

vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn((integrationKey) => CONNECTOR_FIXTURES[integrationKey]),
}));
```

Then add a new test to the `describe("runCollection", ...)` block:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- collectionRunner.test`
Expected: FAIL — before Task 1's seed data exists this would fail on the `test_control_mappings`/`questions.iso_reference = 'A.8.2.3'` join finding no match; since Task 1 already landed by this point in the plan, the actual expected failure is that `getConnector` (before this task's mock change) always returns the AWS fixture regardless of `integrationKey`, so `run.testsRun` would be `2` but the finding's `test_key` would be `aws.network.s3_public_access_blocked`, not `azure.network.nsg_no_open_ingress` — the last two assertions fail.

- [ ] **Step 3: Verify the implementation is already correct**

No production code changes — this task is test-only. If Step 2 failed for the reason above, the mock change already applied in Step 1 is the fix; re-run.

- [ ] **Step 4: Run the tests to verify they all pass**

Run: `cd api && npm run test:integration -- collectionRunner.test`
Expected: PASS, 4/4 (the 3 pre-existing tests plus the new one) — confirming the mock's `"aws"` fixture change didn't regress the existing tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/__tests__/integration/collectionRunner.test.js
git commit -m "test: prove collectionRunner is generic across two differently-shaped connectors"
```

---

### Task 8: Full backend suite verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: nothing — this is the plan's final gate before the frontend plan can build on it.

- [ ] **Step 1: Run the full unit suite**

Run: `cd api && npm test`
Expected: PASS — all pre-existing unit tests plus the 4 new files from Tasks 2-5 (`connectorsAzureCredentials`, `connectorsAzureNetwork`, `connectorsAzureLogging`, `connectorsAzureIndex`), plus the updated `connectorsRegistry.test.js`.

- [ ] **Step 2: Run the full integration suite**

Run: `cd api && npm run test:integration`
Expected: PASS — all pre-existing integration tests plus Task 1's schema coverage, Task 6's `azure/setup-info` coverage, and Task 7's cross-connector `collectionRunner` coverage. Requires a local Postgres reachable at `postgresql://postgres:postgres@localhost:5432/prism_test` (a disposable Docker container, same as prior plans in this repo: `docker run -d --name prism-test-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=prism_test -p 5432:5432 postgres:16-alpine`).

- [ ] **Step 3: Confirm no stray changes**

Run: `git status --short`
Expected: clean except any genuinely pre-existing, out-of-scope changes already present before this plan started (do not touch or stage those).

---

## Self-Review Notes

- **Spec coverage:** the approved plan-mode design (`/Users/aum/.claude/plans/fancy-roaming-neumann.md`) names 4 Phase-1 checks, an `oauth2`/Service Principal auth strategy, a `setup-info` endpoint, and explicit verification that `collectionRunner.js`/schema need no changes. Task 1 → seed rows. Task 2 → auth strategy. Tasks 3-4 → the 4 checks. Task 5 → connector assembly + registry. Task 6 → setup-info. Task 7 → the "prove genericity" verification the design doc called for explicitly. Task 8 → full-suite gate. Nothing in the approved design is left uncovered.
- **Placeholder scan:** every step has real, complete code — no "TBD"/"similar to Task N"/prose-only steps. Every Azure SDK client class name, constructor signature, and method name (`StorageManagementClient`, `NetworkManagementClient`, `SecurityCenter`, `MonitorClient`, `ResourceManagementClient`, `ClientSecretCredential`, `.storageAccounts.list()`, `.networkSecurityGroups.listAll()`, `.pricings.list()`, `.diagnosticSettings.list(resourceUri)`, `.resourceGroups.list()`) was verified against the current Microsoft Learn API reference during planning — several corrected real misconceptions caught before they became executable-but-wrong code (NSG's subscription-wide method is `listAll`, not `list`; `pricings.list()` returns a plain object, not a paged iterator; `@azure/arm-subscriptions` has no usable `.get(subscriptionId)` in the current major version, which is why `testConnection` uses `@azure/arm-resources`'s `resourceGroups.list()` instead).
- **Type consistency:** `resolveAzureCredentials`'s return type (a `ClientSecretCredential` instance) is used consistently — `buildClients` (Task 5) passes it directly into every ARM client's constructor, never unwrapped into a plain object like AWS's credentials. `test.run(clients)`'s `clients` shape (`{storage, network, security, monitor, subscriptionId}`, Task 5) matches exactly what Tasks 3-4's test definitions destructure (`clients.storage`, `clients.network`, `clients.security`, `clients.monitor`, `clients.subscriptionId`). Every test key referenced in Task 1's seed data (`azure.storage.public_access_blocked`, `azure.network.nsg_no_open_ingress`, `azure.security.defender_enabled`, `azure.logging.activity_log_diagnostics_enabled`) matches verbatim the `key` field in Tasks 3-4's test-definition arrays.
