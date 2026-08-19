# GitHub Evidence Collection (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub as a third evidence-collection connector alongside AWS and Azure — 4 Tier-1 read-only checks (org 2FA enforcement, default-branch PR-review protection, Dependabot alerts enabled, secret scanning enabled), authenticated via a customer-owned GitHub App created through GitHub's Manifest flow (not a manually-pasted PAT), proving the connector architecture extends cleanly to a provider whose setup is driven by two browser redirects instead of a single paste-and-submit form.

**Architecture:** Mirrors `api/src/connectors/aws/` and `api/src/connectors/azure/` at the module-contract level exactly — a connector module (`key`, `tests`, `testConnection`, `runTests`) registered in `connectors/registry.js`, with credential resolution (`credentials.js`) encapsulated per-connector and zero changes needed to `collectionRunner.js` (already provider-agnostic — verified by reading it in full, see the Azure plan's identical claim, still true). What's structurally new: every other connector's `POST /:id/credentials` is the only route that ever writes a credential, and every credential is typed into a form by the admin. GitHub's App-manifest flow means Prism itself must receive and act on two unauthenticated browser redirects from github.com (`GET /github/manifest-callback`, `GET /github/install-callback`), each carrying a short-lived, HMAC-signed `state` token (not a DB-backed session) that stands in for `authenticate` on those two routes only. This plan adds that state-signing utility, the two callback routes, and a per-connection `GET /:id/github/setup-info` route (unlike AWS/Azure's connection-agnostic static `setup-info`, GitHub's must be bound to one pending connection so the signed `state` can carry `connectionId`).

**Tech Stack:** `@octokit/rest` (GitHub's official REST client) and `@octokit/auth-app` (GitHub's official App/installation-token auth strategy) — two new `api/package.json` dependencies, no others. The manifest-code exchange (`POST https://api.github.com/app-manifests/{code}/conversions`) uses Node's built-in `fetch` directly rather than Octokit, since it happens before Prism has any App credentials to construct an Octokit client with (same "no client object exists yet" reasoning the Commvault plan used for preferring built-in `fetch` over a heavier client).

**Spec:** `/Users/aum/.claude/plans/understand-my-codebase-and-deep-matsumoto.md` (the approved plan-mode design doc) — read it for the full rationale behind choosing a GitHub App over a PAT, choosing the Manifest flow over manual paste, the 4 Tier-1 checks' selection, and the Phase 2 deferrals (org audit log — Enterprise Cloud only; outside-collaborator checks; multi-org). Two facts in that design are refined here after reading the live GitHub REST API reference (via context7, `/websites/github_en_rest`) during this planning pass, not assumed:
- `GET /repos/{owner}/{repo}/vulnerability-alerts` returns bare `204`/`404` with no body — confirmed, matches the design as written.
- `POST /app-manifests/{code}/conversions` returns `201` with `{id, client_id, client_secret, webhook_secret, pem}` — confirmed the fields this plan actually uses (`id`, `pem`); `slug`/`html_url` (used below to build the install link) are part of GitHub's App resource shape by convention but were **not** independently confirmed via context7 in this pass — Task 8 codes a defensive fallback and flags this explicitly for live verification.
- The exact manifest JSON shape (`hook_attributes`, `redirect_url`, `default_permissions`) is GitHub's documented Manifest flow format from training knowledge, not re-verified live in this pass — flagged in Task 7 for live confirmation before shipping.

## Global Constraints

- Every query touching tenant data must filter on `company_id` — every new route/query in this plan does. The two callback routes are the sole exception to `authenticate`: they're hit directly by GitHub's browser redirect (no Prism session exists at that point), so tenant scoping there is enforced entirely by the signed `state` token's `{connectionId, companyId}` payload, verified before any DB read or write. A request with a missing/invalid/expired `state` never touches the database.
- `state` tokens are signed with `jwt.sign(payload, process.env.JWT_SECRET + ":github-app-state", {expiresIn: "15m"})` — same "suffix the shared secret with a purpose string" pattern `vault.js`'s `requireVaultPin` already uses for its own signed tokens (`JWT_SECRET + ":vault"`), so no new secret needs provisioning.
- No BullMQ/queue, no scheduling — this plan is backend-only, manual-trigger evidence collection, exactly like AWS/Azure.
- Credentials never appear in API responses, every credential touch is audit-logged — the two callback routes call `writeAuditLog` with `userId: null` (no authenticated user exists on a GitHub-initiated redirect), which is a legitimate value for that column (evidence auto-collection already writes non-user-attributed data via `uploaded_by: 'automated'` elsewhere in this schema).
- `status` on every `evidence_test_results` row must be one of `'pass'|'fail'|'warn'|'error'|'not_applicable'` (DB CHECK constraint, `init.sql:562`) — every GitHub test's `run()` function is bound by this exactly like AWS/Azure's.
- Every check's empty-resource-set case (org has zero repos) returns a single `not_applicable` row — same convention as every existing AWS/Azure check.
- The GitHub App manifest requests exactly three permissions — `organization_administration:read`, `administration:read`, `metadata:read` — kept in lockstep with what the 4 checks + `testConnection` + the install-callback's installation lookup actually call, same "policy in code = policy in docs" discipline as `AWS_READ_ONLY_POLICY`/`AZURE_READ_ONLY_ROLE_DEFINITION`.
- No webhook handling in Phase 1 — the manifest's `hook_attributes` is set to `{url: <API_URL>, active: false}`, explicitly disabling webhook delivery rather than standing up a receiver Prism doesn't use yet.
- New required env var: `API_URL` (the API's own externally-reachable base URL, e.g. `https://api.prism.example.com`) — needed because the manifest's `url`/`redirect_url` fields must be a real address GitHub's servers can redirect a browser to; defaults to `http://localhost:4000` for local dev (only reachable if tunneled, e.g. via ngrok, when actually exercising the flow end-to-end against real GitHub — a genuine, disclosed operational requirement, not silently glossed over). Reuses the existing `WEB_URL` env var (`.env.example:10`, already used by `emailTemplate.js`/`scheduler.js`/`users.js`) for the frontend redirect targets after each callback — no new frontend-URL var needed.
- Every GitHub SDK method name referenced in this plan (`octokit.rest.orgs.get`, `octokit.rest.repos.listForOrg`, `octokit.rest.repos.getPullRequestReviewProtection`, `octokit.rest.repos.checkVulnerabilityAlerts`, `octokit.rest.repos.get`, `octokit.rest.apps.getInstallation`, `octokit.paginate`) matches Octokit's documented REST-method-name-mirrors-endpoint-path convention; the response *shapes* for `checkVulnerabilityAlerts` (bare 204/404) and the manifest-conversion endpoint were confirmed live via context7 during this planning pass (see **Spec** above) — the others were not and are flagged inline at their point of use for a live-API confirmation pass during implementation, the same "Task 0" discipline the Commvault plan used for its undocumented SOAP surface.

---

## File Structure

- Modify: `init.sql` — one `integrations` seed row, four `automated_tests` seed rows, four `test_control_mappings` seed rows (GitHub Phase 1)
- Modify: `api/package.json` — two new `@octokit/*` dependencies
- Create: `api/src/utils/githubAppState.js` — `signGithubAppState`/`verifyGithubAppState`
- Create: `api/src/connectors/github/credentials.js` — `resolveGithubCredentials({authType, config, secret})`
- Create: `api/src/connectors/github/tests/access.js` — 2FA-required + branch-protection checks
- Create: `api/src/connectors/github/tests/security.js` — vulnerability-alerts + secret-scanning checks
- Create: `api/src/connectors/github/index.js` — `key`, `tests`, `buildClients`, `testConnection`, `runTests`
- Modify: `api/src/connectors/registry.js` — register the github connector
- Modify: `api/src/routes/integrations.js` — `buildGithubAppManifest`, `GET /:id/github/setup-info`, `GET /github/manifest-callback`, `GET /github/install-callback`
- Create: `api/src/__tests__/githubAppState.test.js`
- Create: `api/src/__tests__/connectorsGithubCredentials.test.js`
- Create: `api/src/__tests__/connectorsGithubAccess.test.js`
- Create: `api/src/__tests__/connectorsGithubSecurity.test.js`
- Create: `api/src/__tests__/connectorsGithubIndex.test.js`
- Modify: `api/src/__tests__/connectorsRegistry.test.js` — add github connector coverage
- Modify: `api/src/__tests__/integration/schema.evidenceCollection.test.js` — github seed-data coverage
- Modify: `api/src/__tests__/integration/integrations.test.js` — `github/setup-info`, `github/manifest-callback`, `github/install-callback` coverage
- Modify: `api/src/__tests__/integration/collectionRunner.test.js` — prove `collectionRunner.js`'s genericity holds for a third, differently-shaped connector

---

### Task 1: Schema seed + dependencies

**Files:**
- Modify: `init.sql`
- Modify: `api/package.json`
- Test: `api/src/__tests__/integration/schema.evidenceCollection.test.js`

**Interfaces:**
- Produces: an `integrations` row with `key = 'github'`, `auth_type = 'oauth2'`; four `automated_tests` rows keyed `github.*`; four `test_control_mappings` rows. These test keys are consumed verbatim by Task 4/5's `tests` arrays — they must match exactly.

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/schema.evidenceCollection.test.js` (inside its existing top-level `describe` block, following the same style as its existing azure test):

```js
  test("seeds the github integration with oauth2 auth and its 4 Phase-1 automated tests", async () => {
    const integrationResult = await query(`SELECT * FROM integrations WHERE key = 'github'`);
    expect(integrationResult.rows.length).toBe(1);
    expect(integrationResult.rows[0].auth_type).toBe("oauth2");
    expect(integrationResult.rows[0].status).toBe("active");

    const testsResult = await query(`SELECT test_key, severity_default FROM automated_tests WHERE integration_key = 'github' ORDER BY test_key`);
    expect(testsResult.rows.map(r => r.test_key)).toEqual([
      "github.org.two_factor_required",
      "github.repo.branch_protection_required_reviews",
      "github.repo.secret_scanning_enabled",
      "github.repo.vulnerability_alerts_enabled",
    ]);

    const mappingsResult = await query(`SELECT test_key, iso_reference FROM test_control_mappings WHERE test_key LIKE 'github.%' ORDER BY test_key`);
    expect(mappingsResult.rows).toEqual([
      { test_key: "github.org.two_factor_required", iso_reference: "A.9.4.2" },
      { test_key: "github.repo.branch_protection_required_reviews", iso_reference: "A.14.2.2" },
      { test_key: "github.repo.secret_scanning_enabled", iso_reference: "A.9.4.3" },
      { test_key: "github.repo.vulnerability_alerts_enabled", iso_reference: "A.12.6.1" },
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- schema.evidenceCollection.test`
Expected: FAIL — no `github` row exists in `integrations` yet, `integrationResult.rows.length` is `0`.

- [ ] **Step 3: Write the implementation**

In `init.sql`, immediately after the existing Azure seed block (the `INSERT INTO test_control_mappings ... VALUES ('azure.network.nsg_no_open_ingress', 'A.13.1.1') ON CONFLICT ...;` line — the last line of the "Automated Evidence Collection: catalog seed data" section), append:

```sql
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('github', 'GitHub', 'devops', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('github', 'github.org.two_factor_required', 'Organization requires two-factor authentication', 'Checks the GitHub organization enforces 2FA for all members, billing managers, and outside collaborators.', 'critical', 'Enable Require two-factor authentication under Organization settings > Authentication security.'),
  ('github', 'github.repo.branch_protection_required_reviews', 'Default branch requires pull request review before merging', 'Checks each repository default branch has a protection rule requiring at least one approving review.', 'high', 'Add a branch protection rule on the default branch requiring at least 1 approving review before merge.'),
  ('github', 'github.repo.vulnerability_alerts_enabled', 'Dependabot vulnerability alerts are enabled', 'Checks Dependabot alerts are enabled for each repository.', 'high', 'Enable Dependabot alerts under Repository settings > Code security and analysis.'),
  ('github', 'github.repo.secret_scanning_enabled', 'Secret scanning is enabled', 'Checks secret scanning is enabled for each repository where GitHub Advanced Security is available.', 'medium', 'Enable secret scanning under Repository settings > Code security and analysis.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('github.org.two_factor_required', 'A.9.4.2'),
  ('github.repo.branch_protection_required_reviews', 'A.14.2.2'),
  ('github.repo.vulnerability_alerts_enabled', 'A.12.6.1'),
  ('github.repo.secret_scanning_enabled', 'A.9.4.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

Then install the two new dependencies:
```bash
cd api && npm install @octokit/rest @octokit/auth-app
```

Integration tests reload `init.sql` fresh via `globalSetup.js` on every `npm run test:integration` run, so no separate migration step is needed for the test DB.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- schema.evidenceCollection.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add init.sql api/package.json api/package-lock.json api/src/__tests__/integration/schema.evidenceCollection.test.js
git commit -m "feat: seed GitHub connector catalog and Phase-1 automated tests"
```

---

### Task 2: `state` token signing/verification utility

**Files:**
- Create: `api/src/utils/githubAppState.js`
- Test: `api/src/__tests__/githubAppState.test.js`

**Interfaces:**
- Produces: `signGithubAppState({connectionId, companyId}) => string` and `verifyGithubAppState(token) => {connectionId, companyId}` (throws `"Invalid or expired state token"` on any failure). Task 7 calls `signGithubAppState`; Tasks 8 and 9 call `verifyGithubAppState`.

This has no dependency on anything else in this plan and is independently testable first — every later route-level task builds on it being correct.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/githubAppState.test.js`:

```js
import { describe, test, expect } from "vitest";
import jwt from "jsonwebtoken";
import { signGithubAppState, verifyGithubAppState } from "../utils/githubAppState.js";

describe("githubAppState", () => {
  test("round-trips connectionId/companyId through sign then verify", () => {
    const token = signGithubAppState({ connectionId: 42, companyId: 7 });
    const decoded = verifyGithubAppState(token);
    expect(decoded).toEqual({ connectionId: 42, companyId: 7 });
  });

  test("throws for a token signed with the wrong purpose suffix", () => {
    const wrongToken = jwt.sign({ connectionId: 42, companyId: 7 }, process.env.JWT_SECRET + ":something-else", { expiresIn: "15m" });
    expect(() => verifyGithubAppState(wrongToken)).toThrow("Invalid or expired state token");
  });

  test("throws for an expired token", () => {
    const expiredToken = jwt.sign({ connectionId: 42, companyId: 7 }, process.env.JWT_SECRET + ":github-app-state", { expiresIn: -10 });
    expect(() => verifyGithubAppState(expiredToken)).toThrow("Invalid or expired state token");
  });

  test("throws for garbage input", () => {
    expect(() => verifyGithubAppState("not-a-real-token")).toThrow("Invalid or expired state token");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/githubAppState.test.js`
Expected: FAIL — `Cannot find module '../utils/githubAppState.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/utils/githubAppState.js`:

```js
import jwt from "jsonwebtoken";

// Same "suffix the shared JWT secret with a purpose string" trick vault.js's
// requireVaultPin already uses (JWT_SECRET + ":vault") — lets this token type
// be verified independently of a real user session without provisioning a
// second secret. 15 minutes comfortably covers "click through two GitHub
// screens" without leaving a long-lived bearer token floating in browser URLs.
function stateSecret() {
  return process.env.JWT_SECRET + ":github-app-state";
}

export function signGithubAppState({ connectionId, companyId }) {
  return jwt.sign({ connectionId, companyId }, stateSecret(), { expiresIn: "15m" });
}

export function verifyGithubAppState(token) {
  try {
    const decoded = jwt.verify(token, stateSecret());
    return { connectionId: decoded.connectionId, companyId: decoded.companyId };
  } catch {
    throw new Error("Invalid or expired state token");
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/githubAppState.test.js`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add api/src/utils/githubAppState.js api/src/__tests__/githubAppState.test.js
git commit -m "feat: add signed state-token helper for the GitHub App manifest flow"
```

---

### Task 3: GitHub credential resolution

**Files:**
- Create: `api/src/connectors/github/credentials.js`
- Test: `api/src/__tests__/connectorsGithubCredentials.test.js`

**Interfaces:**
- Produces: `resolveGithubCredentials({authType, config, secret}) => Promise<Octokit>`. Unlike `resolveAzureCredentials` (returns a bare `ClientSecretCredential` instance the caller must pass into separate SDK client constructors) or `resolveAwsCredentials` (returns a plain object), this returns a fully-configured `Octokit` instance — GitHub's REST surface is a single unified client, so there's nothing further to construct. Task 6's `runTests`/`testConnection` call this directly and use the returned instance's `.rest.*`/`.paginate` methods.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsGithubCredentials.test.js`:

```js
import { describe, test, expect, vi } from "vitest";

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function (options) {
    this.options = options;
  }),
}));
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn((auth) => auth),
}));

const { resolveGithubCredentials } = await import("../connectors/github/credentials.js");
const { Octokit } = await import("@octokit/rest");
const { createAppAuth } = await import("@octokit/auth-app");

describe("resolveGithubCredentials", () => {
  test("constructs an Octokit instance using the App auth strategy for oauth2 auth", async () => {
    const octokit = await resolveGithubCredentials({
      authType: "oauth2",
      config: { installationId: 42, org: "acme" },
      secret: { appId: "123", privateKey: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----" },
    });

    expect(Octokit).toHaveBeenCalledWith({
      authStrategy: createAppAuth,
      auth: { appId: "123", privateKey: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----", installationId: 42 },
    });
    expect(octokit).toBeInstanceOf(Octokit);
  });

  test("throws when config.installationId is missing", async () => {
    await expect(
      resolveGithubCredentials({ authType: "oauth2", config: {}, secret: { appId: "123", privateKey: "pem" } })
    ).rejects.toThrow("GitHub connection is missing config.installationId");
  });

  test("throws when secret.appId is missing", async () => {
    await expect(
      resolveGithubCredentials({ authType: "oauth2", config: { installationId: 42 }, secret: { privateKey: "pem" } })
    ).rejects.toThrow("GitHub connection is missing secret.appId");
  });

  test("throws when secret.privateKey is missing", async () => {
    await expect(
      resolveGithubCredentials({ authType: "oauth2", config: { installationId: 42 }, secret: { appId: "123" } })
    ).rejects.toThrow("GitHub connection is missing secret.privateKey");
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveGithubCredentials({ authType: "api_key", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported GitHub auth type: api_key");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsGithubCredentials.test.js`
Expected: FAIL — `Cannot find module '../connectors/github/credentials.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/github/credentials.js`:

```js
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

export async function resolveGithubCredentials({ authType, config, secret }) {
  if (authType === "oauth2") {
    if (!config.installationId) throw new Error("GitHub connection is missing config.installationId");
    if (!secret.appId) throw new Error("GitHub connection is missing secret.appId");
    if (!secret.privateKey) throw new Error("GitHub connection is missing secret.privateKey");
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: secret.appId,
        privateKey: secret.privateKey,
        installationId: config.installationId,
      },
    });
  }

  throw new Error(`Unsupported GitHub auth type: ${authType}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsGithubCredentials.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/github/credentials.js api/src/__tests__/connectorsGithubCredentials.test.js
git commit -m "feat: add GitHub App installation-token credential resolution"
```

---

### Task 4: GitHub access checks (2FA required, branch protection)

**Files:**
- Create: `api/src/connectors/github/tests/access.js`
- Test: `api/src/__tests__/connectorsGithubAccess.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `accessTests` (array of `{key, title, severityDefault, isoReferences, run}`), `checkTwoFactorRequired(octokit, org)`, `checkBranchProtectionRequiredReviews(octokit, org, repos)`. `run(clients)` returns `Promise<Array<{resourceId, status, message, evidencePayload}>>`; `clients` is `{octokit, org, repos}`, supplied by Task 6's `buildClients` — `repos` is a pre-fetched flat array of `{name, default_branch}` (Task 6 fetches it once via `octokit.paginate` and threads it to every per-repo check, rather than each check re-paginating independently).
- `octokit.rest.repos.getPullRequestReviewProtection({owner, repo, branch})` throws a `RequestError` with `.status === 404` when the branch has no protection rule at all — verified against the live REST reference (see Spec) that a 404 there specifically means "no rule configured," not a generic not-found; this function must catch that 404 and treat it as `fail`, not let it propagate.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsGithubAccess.test.js`:

```js
import { describe, test, expect } from "vitest";
import { checkTwoFactorRequired, checkBranchProtectionRequiredReviews } from "../connectors/github/tests/access.js";

function notFoundError(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

describe("checkTwoFactorRequired", () => {
  test("passes when the org requires two-factor authentication", async () => {
    const octokit = { rest: { orgs: { get: async () => ({ data: { id: 1, two_factor_requirement_enabled: true } }) } } };
    const results = await checkTwoFactorRequired(octokit, "acme");
    expect(results).toEqual([{
      resourceId: "acme", status: "pass",
      message: "acme requires two-factor authentication for all members",
      evidencePayload: { org: "acme", twoFactorRequirementEnabled: true },
    }]);
  });

  test("fails when the org does not require two-factor authentication", async () => {
    const octokit = { rest: { orgs: { get: async () => ({ data: { id: 1, two_factor_requirement_enabled: false } }) } } };
    const results = await checkTwoFactorRequired(octokit, "acme");
    expect(results[0].status).toBe("fail");
  });
});

describe("checkBranchProtectionRequiredReviews", () => {
  test("passes a repo whose default branch requires at least 1 approving review", async () => {
    const octokit = {
      rest: { repos: { getPullRequestReviewProtection: async () => ({ data: { required_approving_review_count: 2 } }) } },
    };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", [{ name: "api", default_branch: "main" }]);
    expect(results).toEqual([{
      resourceId: "acme/api", status: "pass",
      message: "api requires 2 approving review(s) on main",
      evidencePayload: { repo: "api", branch: "main", requiredApprovingReviewCount: 2 },
    }]);
  });

  test("fails a repo whose review protection requires 0 approvals", async () => {
    const octokit = {
      rest: { repos: { getPullRequestReviewProtection: async () => ({ data: { required_approving_review_count: 0 } }) } },
    };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", [{ name: "api", default_branch: "main" }]);
    expect(results[0].status).toBe("fail");
  });

  test("fails a repo with no branch protection configured at all (404)", async () => {
    const octokit = {
      rest: { repos: { getPullRequestReviewProtection: async () => { throw notFoundError("Branch not protected"); } } },
    };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", [{ name: "web", default_branch: "main" }]);
    expect(results).toEqual([{
      resourceId: "acme/web", status: "fail",
      message: "web has no pull request review protection configured on main",
      evidencePayload: { repo: "web", branch: "main" },
    }]);
  });

  test("propagates a non-404 error instead of treating it as unprotected", async () => {
    const octokit = {
      rest: { repos: { getPullRequestReviewProtection: async () => { throw Object.assign(new Error("rate limited"), { status: 403 }); } } },
    };
    await expect(
      checkBranchProtectionRequiredReviews(octokit, "acme", [{ name: "web", default_branch: "main" }])
    ).rejects.toThrow("rate limited");
  });

  test("evaluates every repo independently", async () => {
    const octokit = {
      rest: {
        repos: {
          getPullRequestReviewProtection: async ({ repo }) =>
            repo === "api"
              ? { data: { required_approving_review_count: 1 } }
              : Promise.reject(notFoundError("Branch not protected")),
        },
      },
    };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", [
      { name: "api", default_branch: "main" },
      { name: "web", default_branch: "main" },
    ]);
    expect(results.length).toBe(2);
    expect(results.find(r => r.evidencePayload.repo === "api").status).toBe("pass");
    expect(results.find(r => r.evidencePayload.repo === "web").status).toBe("fail");
  });

  test("returns not_applicable when the org has no repositories", async () => {
    const octokit = { rest: { repos: { getPullRequestReviewProtection: async () => { throw notFoundError("n/a"); } } } };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", []);
    expect(results).toEqual([{ resourceId: "acme", status: "not_applicable", message: "No repositories found", evidencePayload: {} }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsGithubAccess.test.js`
Expected: FAIL — `Cannot find module '../connectors/github/tests/access.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/github/tests/access.js`:

```js
export async function checkTwoFactorRequired(octokit, org) {
  const { data: orgData } = await octokit.rest.orgs.get({ org });
  const enabled = orgData.two_factor_requirement_enabled === true;
  return [{
    resourceId: org,
    status: enabled ? "pass" : "fail",
    message: enabled
      ? `${org} requires two-factor authentication for all members`
      : `${org} does not require two-factor authentication for all members`,
    evidencePayload: { org, twoFactorRequirementEnabled: orgData.two_factor_requirement_enabled ?? null },
  }];
}

export async function checkBranchProtectionRequiredReviews(octokit, org, repos) {
  const results = [];
  for (const repo of repos) {
    try {
      const { data } = await octokit.rest.repos.getPullRequestReviewProtection({ owner: org, repo: repo.name, branch: repo.default_branch });
      const count = data.required_approving_review_count || 0;
      const enforced = count >= 1;
      results.push({
        resourceId: `${org}/${repo.name}`,
        status: enforced ? "pass" : "fail",
        message: enforced
          ? `${repo.name} requires ${count} approving review(s) on ${repo.default_branch}`
          : `${repo.name} does not require any approving reviews on ${repo.default_branch}`,
        evidencePayload: { repo: repo.name, branch: repo.default_branch, requiredApprovingReviewCount: count },
      });
    } catch (err) {
      // A 404 here specifically means "no branch protection rule at all" (verified
      // against the live REST reference during planning) — every other status is a
      // real failure (auth, rate limit, etc.) and must not be swallowed as "fail".
      if (err.status === 404) {
        results.push({
          resourceId: `${org}/${repo.name}`,
          status: "fail",
          message: `${repo.name} has no pull request review protection configured on ${repo.default_branch}`,
          evidencePayload: { repo: repo.name, branch: repo.default_branch },
        });
      } else {
        throw err;
      }
    }
  }
  if (results.length === 0) {
    results.push({ resourceId: org, status: "not_applicable", message: "No repositories found", evidencePayload: {} });
  }
  return results;
}

export const accessTests = [
  { key: "github.org.two_factor_required", title: "Organization requires two-factor authentication", severityDefault: "critical", isoReferences: ["A.9.4.2"], run: (clients) => checkTwoFactorRequired(clients.octokit, clients.org) },
  { key: "github.repo.branch_protection_required_reviews", title: "Default branch requires pull request review before merging", severityDefault: "high", isoReferences: ["A.14.2.2"], run: (clients) => checkBranchProtectionRequiredReviews(clients.octokit, clients.org, clients.repos) },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsGithubAccess.test.js`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/github/tests/access.js api/src/__tests__/connectorsGithubAccess.test.js
git commit -m "feat: add GitHub 2FA-required and branch-protection checks"
```

---

### Task 5: GitHub security checks (vulnerability alerts, secret scanning)

**Files:**
- Create: `api/src/connectors/github/tests/security.js`
- Test: `api/src/__tests__/connectorsGithubSecurity.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `securityTests` (same shape as Task 4's `accessTests`), `checkVulnerabilityAlertsEnabled(octokit, org, repos)`, `checkSecretScanningEnabled(octokit, org, repos)`. `octokit.rest.repos.checkVulnerabilityAlerts({owner, repo})` resolves with no meaningful body on success (bare `204`) and throws a `404`-status `RequestError` when disabled — confirmed live via context7 during planning (see Spec), this is not inferred. `octokit.rest.repos.get({owner, repo})`'s `security_and_analysis` field is `undefined`/absent (not merely `{secret_scanning: {status: "disabled"}}`) on repositories where GitHub Advanced Security isn't licensed — this must produce `not_applicable`, not `fail`, per the design's explicit anti-false-negative reasoning.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsGithubSecurity.test.js`:

```js
import { describe, test, expect } from "vitest";
import { checkVulnerabilityAlertsEnabled, checkSecretScanningEnabled } from "../connectors/github/tests/security.js";

function notFoundError(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

describe("checkVulnerabilityAlertsEnabled", () => {
  test("passes a repo with vulnerability alerts enabled (204)", async () => {
    const octokit = { rest: { repos: { checkVulnerabilityAlerts: async () => undefined } } };
    const results = await checkVulnerabilityAlertsEnabled(octokit, "acme", [{ name: "api", default_branch: "main" }]);
    expect(results).toEqual([{ resourceId: "acme/api", status: "pass", message: "api has Dependabot vulnerability alerts enabled", evidencePayload: { repo: "api" } }]);
  });

  test("fails a repo with vulnerability alerts disabled (404)", async () => {
    const octokit = { rest: { repos: { checkVulnerabilityAlerts: async () => { throw notFoundError("disabled"); } } } };
    const results = await checkVulnerabilityAlertsEnabled(octokit, "acme", [{ name: "web", default_branch: "main" }]);
    expect(results).toEqual([{ resourceId: "acme/web", status: "fail", message: "web does not have Dependabot vulnerability alerts enabled", evidencePayload: { repo: "web" } }]);
  });

  test("propagates a non-404 error", async () => {
    const octokit = { rest: { repos: { checkVulnerabilityAlerts: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); } } } };
    await expect(
      checkVulnerabilityAlertsEnabled(octokit, "acme", [{ name: "web", default_branch: "main" }])
    ).rejects.toThrow("forbidden");
  });

  test("returns not_applicable when the org has no repositories", async () => {
    const octokit = { rest: { repos: { checkVulnerabilityAlerts: async () => undefined } } };
    const results = await checkVulnerabilityAlertsEnabled(octokit, "acme", []);
    expect(results).toEqual([{ resourceId: "acme", status: "not_applicable", message: "No repositories found", evidencePayload: {} }]);
  });
});

describe("checkSecretScanningEnabled", () => {
  test("passes a repo with secret scanning enabled", async () => {
    const octokit = { rest: { repos: { get: async () => ({ data: { security_and_analysis: { secret_scanning: { status: "enabled" } } } }) } } };
    const results = await checkSecretScanningEnabled(octokit, "acme", [{ name: "api", default_branch: "main" }]);
    expect(results).toEqual([{ resourceId: "acme/api", status: "pass", message: "api has secret scanning enabled", evidencePayload: { repo: "api", secretScanningStatus: "enabled" } }]);
  });

  test("fails a repo with secret scanning explicitly disabled", async () => {
    const octokit = { rest: { repos: { get: async () => ({ data: { security_and_analysis: { secret_scanning: { status: "disabled" } } } }) } } };
    const results = await checkSecretScanningEnabled(octokit, "acme", [{ name: "web", default_branch: "main" }]);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when security_and_analysis is entirely absent (no GHAS license)", async () => {
    const octokit = { rest: { repos: { get: async () => ({ data: { name: "legacy" } }) } } };
    const results = await checkSecretScanningEnabled(octokit, "acme", [{ name: "legacy", default_branch: "main" }]);
    expect(results).toEqual([{ resourceId: "acme/legacy", status: "not_applicable", message: "legacy does not have GitHub Advanced Security available to report secret scanning status", evidencePayload: { repo: "legacy" } }]);
  });

  test("returns not_applicable when the org has no repositories", async () => {
    const octokit = { rest: { repos: { get: async () => ({ data: {} }) } } };
    const results = await checkSecretScanningEnabled(octokit, "acme", []);
    expect(results).toEqual([{ resourceId: "acme", status: "not_applicable", message: "No repositories found", evidencePayload: {} }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsGithubSecurity.test.js`
Expected: FAIL — `Cannot find module '../connectors/github/tests/security.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/github/tests/security.js`:

```js
export async function checkVulnerabilityAlertsEnabled(octokit, org, repos) {
  const results = [];
  for (const repo of repos) {
    try {
      await octokit.rest.repos.checkVulnerabilityAlerts({ owner: org, repo: repo.name });
      results.push({ resourceId: `${org}/${repo.name}`, status: "pass", message: `${repo.name} has Dependabot vulnerability alerts enabled`, evidencePayload: { repo: repo.name } });
    } catch (err) {
      if (err.status === 404) {
        results.push({ resourceId: `${org}/${repo.name}`, status: "fail", message: `${repo.name} does not have Dependabot vulnerability alerts enabled`, evidencePayload: { repo: repo.name } });
      } else {
        throw err;
      }
    }
  }
  if (results.length === 0) {
    results.push({ resourceId: org, status: "not_applicable", message: "No repositories found", evidencePayload: {} });
  }
  return results;
}

export async function checkSecretScanningEnabled(octokit, org, repos) {
  const results = [];
  for (const repo of repos) {
    const { data } = await octokit.rest.repos.get({ owner: org, repo: repo.name });
    const status = data.security_and_analysis?.secret_scanning?.status;
    if (!status) {
      // No security_and_analysis block at all means GitHub Advanced Security
      // isn't licensed on this repo — the org can't control this setting here,
      // so flagging it as a "fail" would be a false negative, not a real gap.
      results.push({ resourceId: `${org}/${repo.name}`, status: "not_applicable", message: `${repo.name} does not have GitHub Advanced Security available to report secret scanning status`, evidencePayload: { repo: repo.name } });
      continue;
    }
    const enabled = status === "enabled";
    results.push({
      resourceId: `${org}/${repo.name}`,
      status: enabled ? "pass" : "fail",
      message: enabled ? `${repo.name} has secret scanning enabled` : `${repo.name} has secret scanning disabled`,
      evidencePayload: { repo: repo.name, secretScanningStatus: status },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: org, status: "not_applicable", message: "No repositories found", evidencePayload: {} });
  }
  return results;
}

export const securityTests = [
  { key: "github.repo.vulnerability_alerts_enabled", title: "Dependabot vulnerability alerts are enabled", severityDefault: "high", isoReferences: ["A.12.6.1"], run: (clients) => checkVulnerabilityAlertsEnabled(clients.octokit, clients.org, clients.repos) },
  { key: "github.repo.secret_scanning_enabled", title: "Secret scanning is enabled", severityDefault: "medium", isoReferences: ["A.9.4.3"], run: (clients) => checkSecretScanningEnabled(clients.octokit, clients.org, clients.repos) },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/connectorsGithubSecurity.test.js`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/github/tests/security.js api/src/__tests__/connectorsGithubSecurity.test.js
git commit -m "feat: add GitHub vulnerability-alerts and secret-scanning checks"
```

---

### Task 6: GitHub connector assembly + registry wiring

**Files:**
- Create: `api/src/connectors/github/index.js`
- Modify: `api/src/connectors/registry.js`
- Test: `api/src/__tests__/connectorsGithubIndex.test.js`
- Test: `api/src/__tests__/connectorsRegistry.test.js`

**Interfaces:**
- Consumes: `resolveGithubCredentials` (Task 3), `accessTests` (Task 4), `securityTests` (Task 5).
- Produces: `key = "github"`, `tests` (array), `testConnection({authType, config, secret}) => {ok, externalAccountId}`, `runTests({authType, config, secret}) => Array<{testKey, title, severity, resourceId, status, message, evidencePayload}>` — the exact same contract `collectionRunner.js` already calls generically. `getConnector("github")` now resolves to this module. Also produces `buildClients(octokit, org) => Promise<{octokit, org, repos}>` — an internal (non-exported) refinement of the design spec's `{octokit, org}`: `repos` is fetched once here via `octokit.paginate` and threaded to every per-repo check, avoiding three redundant paginated fetches per run.

- [ ] **Step 1: Write the failing test**

Create `api/src/__tests__/connectorsGithubIndex.test.js`:

```js
import { describe, test, expect, vi } from "vitest";

vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn((auth) => auth) }));

const orgsGet = vi.fn(async () => ({ data: { id: 555, two_factor_requirement_enabled: true } }));
const getPullRequestReviewProtection = vi.fn(async () => { throw Object.assign(new Error("not protected"), { status: 404 }); });
const checkVulnerabilityAlerts = vi.fn(async () => { throw Object.assign(new Error("disabled"), { status: 404 }); });
const reposGet = vi.fn(async () => ({ data: {} }));
const paginate = vi.fn(async () => []);

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    this.rest = {
      orgs: { get: orgsGet },
      repos: { getPullRequestReviewProtection, checkVulnerabilityAlerts, get: reposGet, listForOrg: vi.fn() },
    };
    this.paginate = paginate;
  }),
}));

const { runTests, testConnection, tests } = await import("../connectors/github/index.js");

describe("runTests", () => {
  test("propagates each test's human-readable title alongside its key, and returns not_applicable when the org has no repos", async () => {
    const results = await runTests({
      authType: "oauth2",
      config: { installationId: 99, org: "acme" },
      secret: { appId: "1", privateKey: "pem" },
    });

    expect(results.length).toBe(4);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
    }

    const branchResult = results.find((r) => r.testKey === "github.repo.branch_protection_required_reviews");
    expect(branchResult.status).toBe("not_applicable");

    const twoFactorResult = results.find((r) => r.testKey === "github.org.two_factor_required");
    expect(twoFactorResult.status).toBe("pass");
  });
});

describe("testConnection", () => {
  test("resolves the org id as externalAccountId", async () => {
    const result = await testConnection({ authType: "oauth2", config: { installationId: 99, org: "acme" }, secret: { appId: "1", privateKey: "pem" } });
    expect(result).toEqual({ ok: true, externalAccountId: "555" });
    expect(orgsGet).toHaveBeenCalledWith({ org: "acme" });
  });

  test("surfaces a forbidden error with guidance about the App's installed permissions", async () => {
    orgsGet.mockRejectedValueOnce(Object.assign(new Error("Resource not accessible by integration"), { status: 403 }));
    await expect(
      testConnection({ authType: "oauth2", config: { installationId: 99, org: "acme" }, secret: { appId: "1", privateKey: "pem" } })
    ).rejects.toThrow(/Double-check the App's installed permissions/);
  });

  test("surfaces a not-found error with guidance about the org login and installation scope", async () => {
    orgsGet.mockRejectedValueOnce(Object.assign(new Error("Not Found"), { status: 404 }));
    await expect(
      testConnection({ authType: "oauth2", config: { installationId: 99, org: "acme" }, secret: { appId: "1", privateKey: "pem" } })
    ).rejects.toThrow(/Double-check the organization login/);
  });

  test("falls back to the raw error message for anything else", async () => {
    orgsGet.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    await expect(
      testConnection({ authType: "oauth2", config: { installationId: 99, org: "acme" }, secret: { appId: "1", privateKey: "pem" } })
    ).rejects.toThrow("connect ETIMEDOUT");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/connectorsGithubIndex.test.js`
Expected: FAIL — `Cannot find module '../connectors/github/index.js'`.

- [ ] **Step 3: Write the implementation**

Create `api/src/connectors/github/index.js`:

```js
import { resolveGithubCredentials } from "./credentials.js";
import { accessTests } from "./tests/access.js";
import { securityTests } from "./tests/security.js";

export const key = "github";

export const tests = [...accessTests, ...securityTests];

// Octokit's RequestError carries the useful detail in `.status`/`.message`
// (and, on rate-limit responses, `.response.headers["x-ratelimit-*"]`) — none
// of this is guaranteed readable from `.message` alone the way ARM's errors
// are handled in describeAzureError, so this distinguishes the cases that
// actually change what an admin should go do about it.
function describeGithubError(err) {
  if (err?.response?.headers?.["x-ratelimit-remaining"] === "0") {
    const resetAt = new Date(Number(err.response.headers["x-ratelimit-reset"]) * 1000).toISOString();
    return `GitHub API rate limit exhausted for this installation token (resets at ${resetAt}).`;
  }
  if (err?.status === 403) {
    return `GitHub rejected this request as forbidden (${err.message}). Double-check the App's installed permissions match what Prism's checks require.`;
  }
  if (err?.status === 404) {
    return `GitHub returned Not Found (${err.message}). Double-check the organization login and that the App installation includes the expected repositories.`;
  }
  return err.message;
}

async function buildClients(octokit, org) {
  const repos = await octokit.paginate(octokit.rest.repos.listForOrg, { org, type: "all" });
  return { octokit, org, repos };
}

export async function testConnection({ authType, config, secret }) {
  const octokit = await resolveGithubCredentials({ authType, config, secret });
  try {
    const { data: orgData } = await octokit.rest.orgs.get({ org: config.org });
    return { ok: true, externalAccountId: String(orgData.id) };
  } catch (err) {
    throw new Error(describeGithubError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const octokit = await resolveGithubCredentials({ authType, config, secret });
  const clients = await buildClients(octokit, config.org);
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
import * as github from "./github/index.js";

const connectors = { [aws.key]: aws, [azure.key]: azure, [github.key]: github };
```

(the rest of the file — `getConnector`/`listConnectorTests` — is unchanged).

Modify `api/src/__tests__/connectorsRegistry.test.js` — add coverage for the newly-registered github connector, replacing `"gcp"` as the always-unregistered example key (still genuinely unregistered):

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

  test("throws for an unknown integration", () => {
    expect(() => getConnector("gcp")).toThrow("Unknown integration: gcp");
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/connectorsGithubIndex.test.js src/__tests__/connectorsRegistry.test.js`
Expected: PASS, 13/13 total (7 + 6).

- [ ] **Step 5: Commit**

```bash
git add api/src/connectors/github/index.js api/src/connectors/registry.js api/src/__tests__/connectorsGithubIndex.test.js api/src/__tests__/connectorsRegistry.test.js
git commit -m "feat: assemble the GitHub connector and register it"
```

---

### Task 7: `GET /:id/github/setup-info` route

**Files:**
- Modify: `api/src/routes/integrations.js`
- Test: `api/src/__tests__/integration/integrations.test.js`

**Interfaces:**
- Consumes: `signGithubAppState` (Task 2).
- Produces: `GET /api/integrations/:id/github/setup-info` → `{manifest, state}`.

Unlike `GET /aws/setup-info`/`GET /azure/setup-info` (connection-agnostic, static JSON), this route is scoped to one specific pending connection (`:id`) — the returned `state` must carry that `connectionId` so the two callback routes (Tasks 8-9) know which connection to write credentials/config onto. This is why the route lives under `/:id/...` rather than as a flat `/github/setup-info` alongside AWS/Azure's.

**Not independently verified in this plan:** the exact GitHub App manifest JSON field names below (`hook_attributes`, `redirect_url`, `default_permissions`) are GitHub's documented Manifest-flow parameters from general knowledge of the feature, not re-confirmed live via context7 during this planning pass (unlike the `checkVulnerabilityAlerts` and `app-manifests/{code}/conversions` shapes, which were). Before implementing this task, fetch `https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest` (or the equivalent context7 query against `/websites/github_en_rest`) and confirm the manifest object's exact accepted keys; adjust `buildGithubAppManifest` if anything below is wrong.

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/integrations.test.js` (alongside the existing `describe("GET /api/integrations/azure/setup-info", ...)` block):

```js
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
});
```

Add the import this test needs, alongside the file's existing imports:
```js
import { verifyGithubAppState } from "../../utils/githubAppState.js";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: FAIL — 404, no matching route yet.

- [ ] **Step 3: Write the implementation**

In `api/src/routes/integrations.js`, add this import alongside the existing ones:

```js
import { signGithubAppState } from "../utils/githubAppState.js";
```

Add this constant near `AZURE_READ_ONLY_ROLE_DEFINITION`:

```js
// Kept in lockstep with exactly what connectors/github/index.js's testConnection
// and connectors/github/tests/{access,security}.js's checks actually call, same
// "policy in code = policy in docs" discipline as AWS_READ_ONLY_POLICY /
// AZURE_READ_ONLY_ROLE_DEFINITION. No webhook events are consumed in Phase 1,
// so hook_attributes.active is explicitly false rather than standing up a
// receiver Prism doesn't use yet.
function buildGithubAppManifest({ companyName }) {
  const baseUrl = process.env.API_URL || "http://localhost:4000";
  return {
    name: `Prism Evidence Collection - ${companyName}`.slice(0, 34),
    url: baseUrl,
    redirect_url: `${baseUrl}/api/integrations/github/manifest-callback`,
    hook_attributes: { url: baseUrl, active: false },
    public: false,
    default_permissions: {
      organization_administration: "read",
      administration: "read",
      metadata: "read",
    },
  };
}
```

Add the route immediately after the existing `router.get("/azure/setup-info", ...)` handler:

```js
router.get("/:id/github/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  const state = signGithubAppState({ connectionId, companyId: req.user.companyId });
  const manifest = buildGithubAppManifest({ companyName: req.user.company?.name || "Prism" });
  res.json({ manifest, state });
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/integrations.js api/src/__tests__/integration/integrations.test.js
git commit -m "feat: add per-connection GitHub App manifest setup-info endpoint"
```

---

### Task 8: `GET /github/manifest-callback` route

**Files:**
- Modify: `api/src/routes/integrations.js`
- Test: `api/src/__tests__/integration/integrations.test.js`

**Interfaces:**
- Consumes: `verifyGithubAppState` (Task 2), `storeCredential`/`revokeCredentials` (already shipped, `db/integrationCredentials.js`).
- Produces: `GET /api/integrations/github/manifest-callback?code=...&state=...` → a 302 redirect into the web app. On success, the connection's `integration_credentials` row now holds `{appId, privateKey}`. Also produces the `installUrl` the frontend needs for its second button — passed via a redirect query param rather than a JSON body, since this route is only ever reached by GitHub's own browser redirect, not by `apiFetch`.

This route is **unauthenticated** — deliberately, since it's hit directly by the customer's browser following GitHub's redirect, with no Prism session/JWT attached. All authorization is the signed `state` token verified as the very first step, before any DB access.

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/integrations.test.js`, and add a `vi.mock` for global `fetch` at the top of the file (alongside the existing `@aws-sdk/client-sts` mock):

```js
const originalFetch = global.fetch;
```

Then a new `describe` block:

```js
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
```

Add the imports this test needs — update the file's existing `import { describe, test, expect, vi } from "vitest";` to also pull in `afterEach`:
```js
import { describe, test, expect, vi, afterEach } from "vitest";
```
and add:
```js
import { signGithubAppState } from "../../utils/githubAppState.js";
import { getActiveCredential } from "../../db/integrationCredentials.js";
```
(`verifyGithubAppState` was already imported for Task 7's tests.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: FAIL — 404, no matching route yet.

- [ ] **Step 3: Write the implementation**

In `api/src/routes/integrations.js`, add this route after the `/:id/github/setup-info` route from Task 7 (and before the `/:id` param routes, so it's registered as a literal two-segment path):

```js
// Hit directly by the customer's browser via GitHub's redirect after they
// create the App from the manifest — there is no Prism session at this
// point, so authorization is entirely the signed `state` token, verified
// before any database access.
router.get("/github/manifest-callback", asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  const webUrl = (process.env.WEB_URL || "http://localhost:5173").replace(/\/$/, "");

  let stateData;
  try {
    stateData = verifyGithubAppState(state);
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent(err.message)}`);
  }
  const { connectionId, companyId } = stateData;

  const connResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, companyId]
  );
  if (!mapRow(connResult)) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent("Connection not found")}`);
  }

  let appData;
  try {
    const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status} exchanging the manifest code`);
    appData = await response.json();
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await revokeCredentials(connectionId, companyId);
  await storeCredential({
    connectionId, companyId, authType: "oauth2",
    secret: { appId: String(appData.id), privateKey: appData.pem },
  });
  // No authenticated user exists on a GitHub-initiated redirect — userId: null
  // is a legitimate value here, same as other automated, non-user-attributed
  // audit events already written by this codebase (e.g. evidence auto-collection).
  await writeAuditLog({ userId: null, companyId, action: "CREDENTIAL_STORED", resource: "integration_credentials", detail: { connectionId, authType: "oauth2", via: "github_manifest_flow" } });

  // `slug`/`html_url` are part of GitHub's App resource shape by convention
  // (not independently confirmed via context7 in this planning pass, see the
  // plan header's Spec section) — fall back to constructing the install URL
  // from `slug` alone if `html_url` is ever absent.
  const installUrl = appData.html_url ? `${appData.html_url}/installations/new` : `https://github.com/apps/${appData.slug}/installations/new`;
  res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubInstallUrl=${encodeURIComponent(`${installUrl}?state=${state}`)}`);
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/integrations.js api/src/__tests__/integration/integrations.test.js
git commit -m "feat: add GitHub manifest-code exchange callback route"
```

---

### Task 9: `GET /github/install-callback` route

**Files:**
- Modify: `api/src/routes/integrations.js`
- Test: `api/src/__tests__/integration/integrations.test.js`

**Interfaces:**
- Consumes: `verifyGithubAppState` (Task 2), `getActiveCredential` (already shipped), `getConnector` (Task 6, via `registry.js`).
- Produces: `GET /api/integrations/github/install-callback?installation_id=...&state=...` → a 302 redirect. On success, `integration_connections.config = {installationId, org}` and `status = 'connected'`.

GitHub's install redirect only supplies `installation_id` — it does not include the org login `testConnection`/`runTests` need for `config.org`. This route must resolve it itself by calling `GET /app/installations/{installation_id}`, which requires **App-level** JWT auth (not an installation token) — `@octokit/auth-app`'s `createAppAuth({appId, privateKey})({type: "app"})` produces that JWT without adding a third Octokit package.

**Not independently verified in this plan:** `octokit.rest.apps.getInstallation({installation_id})` is Octokit's documented REST-method-name-mirrors-endpoint-path convention applied to `GET /app/installations/{installation_id}`, not confirmed live via context7 in this pass — flag for live confirmation during implementation, same as the manifest JSON shape in Task 7.

- [ ] **Step 1: Write the failing test**

Add to `api/src/__tests__/integration/integrations.test.js`:

```js
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
    expect(res.headers.location).toContain("githubError=installation+has+no+repositories");

    const updated = await query(`SELECT status FROM integration_connections WHERE id = $1`, [connectionId]);
    expect(updated.rows[0].status).toBe("error");
  });
});
```

This test needs `octokit.rest.apps.getInstallation` mocked (to resolve `installation_id: 555` → `org: "acme-corp"`) and the `github` entry of `CONNECTOR_FIXTURES` from the top-of-file `vi.mock("../../connectors/registry.js", ...)`. Update that mock block (it currently only defines `getConnector: vi.fn(() => ({key: "aws", ...}))`) to an argument-aware, multi-connector version — same refactor the Azure backend plan's collectionRunner task made to its own registry mock, applied here to this file's:

```js
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
```

And add the `@octokit/auth-app`/`@octokit/rest` mocks for the App-level installation lookup, alongside the existing `@aws-sdk/client-sts` mock:

```js
const getInstallation = vi.fn(async () => ({ data: { account: { login: "acme-corp" } } }));
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn(() => vi.fn(async () => ({ token: "fake-app-jwt" }))),
}));
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    this.rest = { apps: { getInstallation } };
  }),
}));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: FAIL — 404, no matching route yet.

- [ ] **Step 3: Write the implementation**

In `api/src/routes/integrations.js`, add these two imports alongside the existing ones:

```js
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { getActiveCredential } from "../db/integrationCredentials.js";
```

Add the route immediately after the manifest-callback route from Task 8:

```js
// Also unauthenticated, for the same reason as manifest-callback above —
// this is GitHub's own redirect after the admin installs the App, carrying
// only `installation_id`. That alone doesn't tell us the org login the
// connector's testConnection/runTests need, so this route resolves it via
// an App-level (JWT, not installation-token) lookup first.
router.get("/github/install-callback", asyncHandler(async (req, res) => {
  const installationId = parseInt(req.query.installation_id);
  const { state } = req.query;
  const webUrl = (process.env.WEB_URL || "http://localhost:5173").replace(/\/$/, "");

  let stateData;
  try {
    stateData = verifyGithubAppState(state);
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent(err.message)}`);
  }
  const { connectionId, companyId } = stateData;

  const connResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, companyId]
  );
  if (!mapRow(connResult)) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent("Connection not found")}`);
  }

  const credential = await getActiveCredential(connectionId, companyId);
  if (!credential) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent("Create the GitHub App before installing it")}`);
  }

  let org;
  try {
    const appAuth = createAppAuth({ appId: credential.secret.appId, privateKey: credential.secret.privateKey });
    const { token: appJwt } = await appAuth({ type: "app" });
    const appOctokit = new Octokit({ auth: appJwt });
    const { data: installation } = await appOctokit.rest.apps.getInstallation({ installation_id: installationId });
    org = installation.account.login;
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await query(
    `UPDATE integration_connections SET config = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
    [JSON.stringify({ installationId, org }), connectionId, companyId]
  );

  const connector = getConnector("github");
  try {
    const testResult = await connector.testConnection({ authType: "oauth2", config: { installationId, org }, secret: credential.secret });
    await query(
      `UPDATE integration_connections SET status = 'connected', external_account_id = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [testResult.externalAccountId || null, connectionId, companyId]
    );
  } catch (err) {
    await query(`UPDATE integration_connections SET status = 'error', updated_at = NOW() WHERE id = $1 AND company_id = $2`, [connectionId, companyId]);
    await writeAuditLog({ userId: null, companyId, action: "CONNECTION_TEST_FAILED", resource: "integration_connections", detail: { connectionId, error: err.message } });
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await writeAuditLog({ userId: null, companyId, action: "CONNECTION_INSTALLED", resource: "integration_connections", detail: { connectionId, installationId, org } });
  res.redirect(`${webUrl}/settings/integrations/${connectionId}`);
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npm run test:integration -- integrations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/integrations.js api/src/__tests__/integration/integrations.test.js
git commit -m "feat: add GitHub App installation callback route"
```

---

### Task 10: `collectionRunner` cross-connector regression coverage

**Files:**
- Modify: `api/src/__tests__/integration/collectionRunner.test.js`

**Interfaces:**
- Consumes: nothing new — test-only, no production code changes (per this plan's Global Constraints, `collectionRunner.js` was already verified fully provider-agnostic).

The file's `CONNECTOR_FIXTURES` object (added by the Azure backend plan, already argument-aware over `aws`/`azure`) gets a third `github` entry, and a new test proves `collectionRunner.js` behaves identically end-to-end for a `github`-keyed connection — not just `aws`/`azure` — locking in the "zero coupling" claim under a third, structurally different connector (single unified client instead of per-domain SDK clients; `config` populated by a redirect flow instead of typed in) rather than leaving it as an untested assertion.

- [ ] **Step 1: Write the failing test**

Modify `api/src/__tests__/integration/collectionRunner.test.js` — add a `github` entry to the existing `CONNECTOR_FIXTURES` object:

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
  github: {
    key: "github",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "42424242" })),
    runTests: vi.fn(async () => ([
      { testKey: "github.org.two_factor_required", title: "Organization requires two-factor authentication", severity: "critical", resourceId: "acme-corp", status: "pass", message: "acme-corp requires two-factor authentication for all members", evidencePayload: { org: "acme-corp" } },
      { testKey: "github.repo.branch_protection_required_reviews", title: "Default branch requires pull request review before merging", severity: "high", resourceId: "acme-corp/api", status: "fail", message: "api has no pull request review protection configured on main", evidencePayload: { repo: "api" } },
    ])),
  },
};
```

Then add a new test to the `describe("runCollection", ...)` block:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npm run test:integration -- collectionRunner.test`
Expected: FAIL — before Task 1's seed data and this task's fixture addition, `automated_tests`/`test_control_mappings` rows for `github.*` don't exist yet in some execution orders, or (if Task 1 already landed) `CONNECTOR_FIXTURES.github` is undefined, so `getConnector("github")` returns `undefined` and `connector.runTests` throws — either way `run.status` is `"failed"`, not `"partial_failure"`, and the last three assertions fail.

- [ ] **Step 3: Verify the implementation is already correct**

No production code changes — this task is test-only. The fixture/test addition from Step 1 is the fix; re-run.

- [ ] **Step 4: Run the tests to verify they all pass**

Run: `cd api && npm run test:integration -- collectionRunner.test`
Expected: PASS — the pre-existing aws/azure tests plus this new one, confirming the fixture addition didn't regress either.

- [ ] **Step 5: Commit**

```bash
git add api/src/__tests__/integration/collectionRunner.test.js
git commit -m "test: prove collectionRunner is generic across three differently-shaped connectors"
```

---

### Task 11: Full backend suite verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-10.
- Produces: nothing — this is the plan's final gate before the frontend plan can build on it.

- [ ] **Step 1: Run the full unit suite**

Run: `cd api && npm test`
Expected: PASS — all pre-existing unit tests plus the 7 new files from Tasks 2-6 (`githubAppState`, `connectorsGithubCredentials`, `connectorsGithubAccess`, `connectorsGithubSecurity`, `connectorsGithubIndex`), plus the updated `connectorsRegistry.test.js`.

- [ ] **Step 2: Run the full integration suite**

Run: `cd api && npm run test:integration`
Expected: PASS — all pre-existing integration tests plus Task 1's schema coverage, Tasks 7-9's three new route describe blocks, and Task 10's cross-connector `collectionRunner` coverage. Requires a local Postgres reachable at `postgresql://postgres:postgres@localhost:5432/prism_test` (a disposable Docker container, same as prior plans in this repo: `docker run -d --name prism-test-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=prism_test -p 5432:5432 postgres:16-alpine`).

- [ ] **Step 3: Confirm no stray changes**

Run: `git status --short`
Expected: clean except any genuinely pre-existing, out-of-scope changes already present before this plan started (do not touch or stage those).

---

## Self-Review Notes

- **Spec coverage:** the approved plan-mode design (`/Users/aum/.claude/plans/understand-my-codebase-and-deep-matsumoto.md`) names GitHub App + Manifest-flow auth, 4 Phase-1 checks, a per-connection `setup-info` plus two callback routes, and explicit verification that `collectionRunner.js` needs no changes. Task 1 → seed rows. Task 2 → the `state` primitive both callbacks depend on. Task 3 → credential resolution. Tasks 4-5 → the 4 checks. Task 6 → connector assembly + registry. Task 7 → per-connection setup-info. Task 8 → manifest-code exchange. Task 9 → install resolution + connect. Task 10 → the "prove genericity" verification the design doc called for explicitly, extended to a third connector. Task 11 → full-suite gate. The design's Phase 2 deferrals (org audit log, outside-collaborator checks, multi-org) are intentionally out of scope here, matching the design doc's own framing — not silently dropped.
- **Placeholder scan:** every step has real, complete code — no "TBD"/"similar to Task N"/prose-only steps, aside from Task 10's Step 3 ("no production code changes"), which mirrors the Azure backend plan's identical, explicitly-justified pattern for its own equivalent regression task. Three facts are flagged inline as unconfirmed-by-live-lookup rather than silently assumed: the exact GitHub App manifest JSON field set (Task 7), `slug`/`html_url`'s presence on the manifest-conversion response (Task 8), and `octokit.rest.apps.getInstallation`'s exact method name (Task 9) — each carries an explicit "verify before implementing" note rather than being presented as confirmed fact.
- **Type consistency:** `resolveGithubCredentials`'s return type (a configured `Octokit` instance) is used consistently — Task 6's `buildClients` calls its `.paginate`/`.rest.*` methods directly, never unwraps it into a plain object. `clients` shape (`{octokit, org, repos}`, Task 6) matches exactly what Tasks 4-5's check functions destructure via their `run(clients)` signatures. Every test key referenced in Task 1's seed data (`github.org.two_factor_required`, `github.repo.branch_protection_required_reviews`, `github.repo.vulnerability_alerts_enabled`, `github.repo.secret_scanning_enabled`) matches verbatim the `key` field in Tasks 4-5's test-definition arrays and the `testKey` values used throughout Tasks 9-10's tests. `signGithubAppState`/`verifyGithubAppState`'s `{connectionId, companyId}` payload shape (Task 2) is produced identically by Task 7 and consumed identically by Tasks 8 and 9 — no drift between the token's creation and either of its two consumption points.

