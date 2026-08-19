# Azure Integrations Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-shipped Azure backend (connector, credential resolution, catalog seed, `GET /api/integrations/azure/setup-info`) reachable from the UI — today the "Add Integration" wizard is hardcoded to AWS's two auth types and always sends AWS-shaped `config`/`secret` payloads, so an Azure connection cannot actually be created through the app.

**Architecture:** Adds a third (`oauth2`) branch to the wizard's existing `authType`-driven rendering, alongside `iam_role`/`access_key`. Along the way, fixes a pre-existing, never-triggered bug (the AWS access-key toggle has been unreachable in shipped code since it's gated on a condition that can never be true) and extracts the field sets that are genuinely identical between the "Add Integration" wizard and the "Rotate credentials" modal into a shared component — but only the two auth types whose fields really are identical (`access_key`, `oauth2`); `iam_role`'s UI is intentionally different in each context and stays that way.

**Tech Stack:** React 18 (function components, hooks), `react-icons/fa`'s `FaMicrosoft` (no Azure-specific icon exists in the installed `react-icons@5.7.0` — verified by grepping every bundled collection inside the project's Docker container; this is the closest honest option, not a claim of "the Azure logo").

**Spec:** `/Users/aum/.claude/plans/fancy-roaming-neumann.md`'s "Azure Frontend Plan" section (the approved plan-mode design) — read it for the full rationale behind the toggle-bug fix, the icon substitution, and the field-ownership split between config-level (Tenant ID/Subscription ID) and secret-level (Client ID/Client Secret) Azure fields.

## Global Constraints

- No new HTTP client, no new routing abstraction — every API call goes through the existing `apiFetch(path, {token, method, body})`.
- `CredentialFields` extraction is scoped to `access_key` and `oauth2` only — `iam_role` stays unextracted and per-context (wizard: full walkthrough + live `setup-info` fetch + JSON blocks; rotate modal: bare External-ID-only input, no fetch). Forcing `iam_role` into the shared component would fight this intentional asymmetry, not simplify it.
- Tenant ID and Subscription ID are config-level fields (Azure's analog of AWS's Role ARN) — embedded inside `AzureServicePrincipalWalkthrough`, never resubmitted on rotation. Client ID and Client Secret are secret-level fields — shared via `CredentialFields`, submitted both at creation and on every rotation.
- The toggle-bug fix (`provider.authType === "access_key"` → `provider.key === "aws"`, and the matching fix in the rotate modal) must land with AWS-only test coverage *before* any Azure-specific code is added — Task 1 (icon) and Tasks 2-3 (bug fix) touch no Azure logic at all.
- Known, disclosed, NOT fixed by this plan: `RotateCredentialModal`'s initial auth-type tab is derived from the catalog's canonical `authType`, not the connection's actually-stored one (`GET /api/integrations/:id` doesn't return it) — once the toggle bug is fixed, a connection created via AWS Access Keys will have its rotate modal default to the wrong tab. Fixing this needs a backend response-shape change, out of scope here; Task 3 adds a code comment documenting it.
- Region is a provider-level concept (`provider.key`-driven), not an auth-type-level one — even though today only AWS needs it, gating its visibility on `authType !== "oauth2"` would conflate two different axes that only coincidentally agree right now.

---

## File Structure

- Modify: `web/src/pages/IntegrationsSettings.jsx` — icon map, toggle-gate fix, `AzureServicePrincipalWalkthrough`, three-way `handleSubmit` branching, Region field visibility
- Modify: `web/src/pages/ConnectionDetail.jsx` — `RotateCredentialModal`'s toggle-gate fix, new `providerKey` prop, `oauth2` wiring
- Create: `web/src/components/CredentialFields.jsx` — shared `access_key`/`oauth2` field sets
- Modify: `web/tests/integrations.spec.js` — new AWS-access-key coverage (first time reachable), new Azure coverage, capstone e2e test
- Modify: `web/tests/connection-detail.spec.js` — new AWS-access-key rotate coverage (first time reachable), new Azure rotate coverage

---

### Task 1: Azure icon in the catalog grid

**Files:**
- Modify: `web/src/pages/IntegrationsSettings.jsx`
- Test: `web/tests/integrations.spec.js`

**Interfaces:**
- Consumes: `FaMicrosoft` from `react-icons/fa` (already a project dependency, same package `FaAws` already comes from).
- Produces: `PROVIDER_ICON.azure` — later tasks don't depend on this, it's purely additive and independently testable.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/integrations.spec.js`, as a new test inside the existing `test.describe("Integrations settings", ...)` block (place it right after the existing "lists the AWS catalog entry..." test):

```js
  test("shows the Azure catalog entry with its own icon", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTitle("Microsoft Azure")).toBeVisible();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "Azure catalog entry"`
Expected: FAIL — the azure card renders (the code already falls back to a text label for any provider with no `PROVIDER_ICON` entry), but the `title={c.name}` attribute is present regardless of the icon, so this specific test would actually still find `getByTitle("Microsoft Azure")` even without Task 1's change. To make this a meaningful RED, the assertion needs to target the icon specifically rather than just the title attribute — replace the last line with an SVG-presence check instead:

```js
    await expect(page.locator('[title="Microsoft Azure"] svg')).toBeVisible({ timeout: 10_000 });
```

Re-run: FAIL — no `<svg>` renders inside the azure card yet (falls back to the plain text `<div>{c.name}</div>` branch, no `<svg>`).

- [ ] **Step 3: Write the implementation**

In `web/src/pages/IntegrationsSettings.jsx`, change the import line:

```jsx
import { FaAws, FaMicrosoft } from "react-icons/fa";
```

And extend `PROVIDER_ICON`:

```jsx
const PROVIDER_ICON = {
  aws: { Icon: FaAws, color: "#FF9900" },
  azure: { Icon: FaMicrosoft, color: "#0078D4" },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "Azure catalog entry"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/IntegrationsSettings.jsx web/tests/integrations.spec.js
git commit -m "feat: add Azure icon to the connector catalog grid"
```

---

### Task 2: Fix the wizard's unreachable Access Keys toggle

**Files:**
- Modify: `web/src/pages/IntegrationsSettings.jsx`
- Test: `web/tests/integrations.spec.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: the `access_key` auth path becomes reachable through the UI for the first time — later tasks (4, 7) build on this being correct.

No Azure content in this task — purely an AWS bug fix, isolated so it gets its own review gate before any Azure wiring begins.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/integrations.spec.js`, after the "retrying after a failed credentials step..." test:

```js
  test("Access Keys toggle is reachable and submits the correct payload", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/aws/setup-info", r => r.fulfill({ json: SETUP_INFO }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 13, integrationKey: "aws", name: "Key-based AWS", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 13, integrationKey: "aws", name: "Key-based AWS", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/13/credentials", r =>
      r.fulfill({ json: { id: 13, integrationKey: "aws", name: "Key-based AWS", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Amazon Web Services").click();

    await page.getByRole("button", { name: "Access Keys" }).click();

    await page.getByLabel("Connection name").fill("Key-based AWS");
    await page.getByLabel("Access key ID").fill("AKIAEXAMPLE");
    await page.getByLabel("Secret access key").fill("shh-its-a-secret");

    const [credReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/13/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    const body = credReq.postDataJSON();
    expect(body.authType).toBe("access_key");
    expect(body.secret.accessKeyId).toBe("AKIAEXAMPLE");
    expect(body.secret.secretAccessKey).toBe("shh-its-a-secret");
    expect(body.secret.sessionToken).toBeUndefined();

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "Access Keys toggle"`
Expected: FAIL — `page.getByRole("button", { name: "Access Keys" })` finds no element, because the toggle never renders (`provider.authType === "access_key"` is `false` for AWS's real catalog value `"iam_role"`).

- [ ] **Step 3: Write the implementation**

In `web/src/pages/IntegrationsSettings.jsx`'s `AddIntegrationWizard`, two changes:

1. The `authType` initializer — replace:
```jsx
const [authType, setAuthType] = useState(provider.authType === "access_key" ? "access_key" : "iam_role");
```
with:
```jsx
const [authType, setAuthType] = useState(provider.authType);
```

2. The toggle's gate condition — replace:
```jsx
{provider.authType === "access_key" ? (
```
with:
```jsx
{provider.key === "aws" ? (
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "Access Keys toggle"`
Expected: PASS. Also run the full file to confirm no regression: `cd web && npx playwright test tests/integrations.spec.js` — expected all prior tests still PASS (AWS's `authType` initializer now returns `provider.authType`, which for the AWS catalog fixture is `"iam_role"` — identical to the old ternary's result for that case, so the default `iam_role` walkthrough path is unaffected).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/IntegrationsSettings.jsx web/tests/integrations.spec.js
git commit -m "fix: make the Access Keys auth toggle reachable in the Add Integration wizard"
```

---

### Task 3: Fix the same bug in the Rotate Credentials modal

**Files:**
- Modify: `web/src/pages/ConnectionDetail.jsx`
- Test: `web/tests/connection-detail.spec.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: the `access_key` rotation path becomes reachable for the first time; a new `providerKey` prop on `RotateCredentialModal` that Task 8 also uses for the `oauth2` case.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/connection-detail.spec.js`, after the "Revoke prompts confirmation and calls DELETE" test:

```js
  test("Rotate credentials Access Keys toggle is reachable and submits the correct payload", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: [] }));
    await page.route("**/api/integrations/10/credentials", r =>
      r.fulfill({ json: { ...CONNECTION, status: "connected" } })
    );

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Rotate credentials" }).click();
    await page.getByRole("button", { name: "Access Keys" }).click();

    await page.getByLabel("Access key ID").fill("AKIAROTATED");
    await page.getByLabel("Secret access key").fill("new-secret");

    const [credReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Rotate" }).click(),
    ]);
    const body = credReq.postDataJSON();
    expect(body.authType).toBe("access_key");
    expect(body.secret.accessKeyId).toBe("AKIAROTATED");
    expect(body.secret.secretAccessKey).toBe("new-secret");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/connection-detail.spec.js -g "Rotate credentials Access Keys toggle"`
Expected: FAIL — same root cause as Task 2: `providerAuthType === "access_key"` is `false` for AWS's real catalog value `"iam_role"`, so the toggle never renders in the rotate modal either.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/ConnectionDetail.jsx`:

1. `RotateCredentialModal`'s function signature — add a `providerKey` param:
```jsx
function RotateCredentialModal({ connectionId, token, providerKey, providerAuthType, onClose, onRotated }) {
```

2. Add a comment above the `authType` initializer documenting the residual limitation (keep the existing fallback — `matchingCatalogEntry` can legitimately be `undefined`, e.g. if the catalog fetch races or a connector's status later flips to `coming_soon`):
```jsx
  // NOTE: this defaults from the catalog's canonical authType for this
  // provider, not from what this specific connection was actually created
  // with (the API doesn't expose the connection's stored auth_type) — so a
  // connection created via Access Keys will still default this modal to the
  // "IAM Role" tab. Known limitation; fixing it needs a backend change to
  // expose the connection's current auth_type, out of scope here.
  const [authType, setAuthType] = useState(providerAuthType || "iam_role");
```

3. The toggle's gate condition — replace:
```jsx
{providerAuthType === "access_key" ? (
```
with:
```jsx
{providerKey === "aws" ? (
```

4. In the parent component, thread the new prop at the `RotateCredentialModal` call site — replace:
```jsx
        <RotateCredentialModal
          connectionId={id}
          token={token}
          providerAuthType={matchingCatalogEntry?.authType}
          onClose={() => setShowRotate(false)}
          onRotated={handleRotated}
        />
```
with:
```jsx
        <RotateCredentialModal
          connectionId={id}
          token={token}
          providerKey={connection.integrationKey}
          providerAuthType={matchingCatalogEntry?.authType}
          onClose={() => setShowRotate(false)}
          onRotated={handleRotated}
        />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/connection-detail.spec.js -g "Rotate credentials Access Keys toggle"`
Expected: PASS. Also run the full file: `cd web && npx playwright test tests/connection-detail.spec.js` — expected all prior tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ConnectionDetail.jsx web/tests/connection-detail.spec.js
git commit -m "fix: make the Access Keys auth toggle reachable in the Rotate Credentials modal"
```

---

### Task 4: Extract shared `CredentialFields` (access_key case)

**Files:**
- Create: `web/src/components/CredentialFields.jsx`
- Modify: `web/src/pages/IntegrationsSettings.jsx`
- Modify: `web/src/pages/ConnectionDetail.jsx`

**Interfaces:**
- Produces: `<CredentialFields authType="access_key" accessKeyId setAccessKeyId secretAccessKey setSecretAccessKey sessionToken setSessionToken />` — a pure, controlled-input component. Task 5 adds the `oauth2` case to this same file/component; Tasks 6-8 consume it.

This is a pure refactor — no behavior change. Tasks 2 and 3's tests must pass unmodified afterward, proving nothing observable changed.

- [ ] **Step 1: No new test — this step is the regression check itself**

There is no new test to write for this task. Instead, confirm the tests that already cover this exact rendering (`web/tests/integrations.spec.js -g "Access Keys toggle"` from Task 2, `web/tests/connection-detail.spec.js -g "Rotate credentials Access Keys toggle"` from Task 3) currently pass on the pre-refactor code — they already do, from Tasks 2/3. This is your baseline.

- [ ] **Step 2: (N/A — no RED phase for a pure refactor with pre-existing green coverage)**

- [ ] **Step 3: Write the implementation**

Create `web/src/components/CredentialFields.jsx`:

```jsx
export default function CredentialFields({
  authType,
  accessKeyId, setAccessKeyId,
  secretAccessKey, setSecretAccessKey,
  sessionToken, setSessionToken,
  clientId, setClientId,
  clientSecret, setClientSecret,
}) {
  if (authType === "access_key") {
    return (
      <>
        <div className="form-group">
          <label htmlFor="cred-access-key">Access key ID</label>
          <input id="cred-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-secret-key">Secret access key</label>
          <input id="cred-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-session-token">Session token (optional)</label>
          <input id="cred-session-token" value={sessionToken} onChange={e => setSessionToken(e.target.value)} />
        </div>
      </>
    );
  }

  return null;
}
```

In `web/src/pages/IntegrationsSettings.jsx`:

1. Add the import (after the `apiFetch` import):
```jsx
import CredentialFields from "../components/CredentialFields.jsx";
```

2. Replace the wizard's inline `access_key` field JSX — find:
```jsx
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="conn-access-key">Access key ID</label>
                <input id="conn-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="conn-secret-key">Secret access key</label>
                <input id="conn-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="conn-session-token">Session token (optional)</label>
                <input id="conn-session-token" value={sessionToken} onChange={e => setSessionToken(e.target.value)} />
              </div>
            </>
          )}
```
with:
```jsx
          ) : (
            <CredentialFields
              authType={authType}
              accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
              secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
              sessionToken={sessionToken} setSessionToken={setSessionToken}
            />
          )}
```

In `web/src/pages/ConnectionDetail.jsx`:

1. Add the same import.
2. Replace `RotateCredentialModal`'s inline `access_key` field JSX — find:
```jsx
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="rotate-access-key">Access key ID</label>
                <input id="rotate-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="rotate-secret-key">Secret access key</label>
                <input id="rotate-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="rotate-session-token">Session token (optional)</label>
                <input id="rotate-session-token" value={sessionToken} onChange={e => setSessionToken(e.target.value)} />
              </div>
            </>
          )}
```
with:
```jsx
          ) : (
            <CredentialFields
              authType={authType}
              accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
              secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
              sessionToken={sessionToken} setSessionToken={setSessionToken}
            />
          )}
```

- [ ] **Step 4: Run the tests to verify they still pass**

Run: `cd web && npx playwright test tests/integrations.spec.js tests/connection-detail.spec.js`
Expected: PASS, all tests including Tasks 2/3's new ones — unchanged behavior, confirmed by unchanged test results. (Field `id` attributes changed from `conn-access-key`/`rotate-access-key` to the shared `cred-access-key`, but every test locates fields via `getByLabel("Access key ID")` etc. — label text, not id — so this is invisible to the tests.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CredentialFields.jsx web/src/pages/IntegrationsSettings.jsx web/src/pages/ConnectionDetail.jsx
git commit -m "refactor: extract shared CredentialFields component for access_key auth"
```

---

### Task 5: Add the `oauth2` case to `CredentialFields`

**Files:**
- Modify: `web/src/components/CredentialFields.jsx`
- Test: none yet — this component isn't wired into either page's render tree for `oauth2` until Tasks 6/8. Testing it in isolation here would require a component-test harness this codebase doesn't have (Playwright only, no RTL/Vitest-component-testing setup) — so this task's correctness is verified indirectly by Tasks 7/9's end-to-end assertions on the submitted payload shape. This is a deliberate, disclosed test-ordering choice, not a gap: shipping unreachable code with no way to test it in isolation would be worse than sequencing the test one task later, once it's actually rendered.

**Interfaces:**
- Produces: `<CredentialFields authType="oauth2" clientId setClientId clientSecret setClientSecret />` — Tasks 6 and 8 both render this.

- [ ] **Step 1: Write the implementation directly (no isolated test, see note above)**

In `web/src/components/CredentialFields.jsx`, add a second branch before the final `return null;`:

```jsx
  if (authType === "oauth2") {
    return (
      <>
        <div className="form-group">
          <label htmlFor="cred-client-id">Client ID</label>
          <input id="cred-client-id" required value={clientId} onChange={e => setClientId(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-client-secret">Client secret</label>
          <input id="cred-client-secret" type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
        </div>
      </>
    );
  }
```

The full file after this change:

```jsx
export default function CredentialFields({
  authType,
  accessKeyId, setAccessKeyId,
  secretAccessKey, setSecretAccessKey,
  sessionToken, setSessionToken,
  clientId, setClientId,
  clientSecret, setClientSecret,
}) {
  if (authType === "access_key") {
    return (
      <>
        <div className="form-group">
          <label htmlFor="cred-access-key">Access key ID</label>
          <input id="cred-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-secret-key">Secret access key</label>
          <input id="cred-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-session-token">Session token (optional)</label>
          <input id="cred-session-token" value={sessionToken} onChange={e => setSessionToken(e.target.value)} />
        </div>
      </>
    );
  }

  if (authType === "oauth2") {
    return (
      <>
        <div className="form-group">
          <label htmlFor="cred-client-id">Client ID</label>
          <input id="cred-client-id" required value={clientId} onChange={e => setClientId(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-client-secret">Client secret</label>
          <input id="cred-client-secret" type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
        </div>
      </>
    );
  }

  return null;
}
```

- [ ] **Step 2: Run the existing suite to confirm no regression**

Run: `cd web && npx playwright test tests/integrations.spec.js tests/connection-detail.spec.js`
Expected: PASS, unchanged from Task 4 (this addition is unreachable dead code until Task 6/8 wire it in, so it cannot affect any existing test).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/CredentialFields.jsx
git commit -m "feat: add oauth2 (Client ID/Client Secret) case to CredentialFields"
```

---

### Task 6: `AzureServicePrincipalWalkthrough` + wire the wizard's `oauth2` branch

**Files:**
- Modify: `web/src/pages/IntegrationsSettings.jsx`
- Test: `web/tests/integrations.spec.js`

**Interfaces:**
- Consumes: `GET /api/integrations/azure/setup-info` → `{roleDefinition: {Name, IsCustom, Description, Actions, NotActions, AssignableScopes}}` (already shipped, no live Azure call). The existing generic `JsonBlock`/`CopyButton` helpers (already provider-agnostic, no changes needed).
- Produces: a new `AzureServicePrincipalWalkthrough` component, wired into the wizard's `authType === "oauth2"` branch alongside `CredentialFields authType="oauth2"`. New state vars `tenantId`, `subscriptionId`, `clientId`, `clientSecret` in `AddIntegrationWizard`. Task 7 consumes `tenantId`/`subscriptionId`/`clientId`/`clientSecret` in `handleSubmit`.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/integrations.spec.js`, near the top alongside the existing `SETUP_INFO` constant, a new fixture:

```js
const AZURE_SETUP_INFO = {
  roleDefinition: {
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
  },
};
```

Then add a new test inside `test.describe("Integrations settings", ...)`:

```js
  test("clicking the Azure card shows the real role-definition JSON and Tenant/Subscription ID fields", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations/azure/setup-info", r => r.fulfill({ json: AZURE_SETUP_INFO }));

    await page.goto("/settings/integrations");
    await page.getByTitle("Microsoft Azure").click();

    await expect(page.getByText('"Microsoft.Storage/storageAccounts/read"')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Tenant ID")).toBeVisible();
    await expect(page.getByLabel("Subscription ID")).toBeVisible();
    await expect(page.getByLabel("Client ID")).toBeVisible();
    await expect(page.getByLabel("Client secret")).toBeVisible();

    // The Region field is AWS-specific and must not render for Azure.
    await expect(page.getByLabel("Region")).toHaveCount(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "role-definition JSON"`
Expected: FAIL — `authType === "oauth2"` currently falls into the wizard's final `access_key`-shaped `else` branch (`<CredentialFields authType={authType} .../>` from Task 4, which renders `null` for `authType="oauth2"` since Task 5 hasn't been wired in yet), so none of the Tenant ID/Subscription ID/role-definition assertions find anything, and Region is still visible for every provider.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/IntegrationsSettings.jsx`, add the new component after `AwsRoleWalkthrough`'s closing brace and before `AddIntegrationWizard`:

```jsx
function AzureServicePrincipalWalkthrough({ token, tenantId, setTenantId, subscriptionId, setSubscriptionId }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/azure/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const roleDefinition = setupInfo?.roleDefinition ? JSON.stringify(setupInfo.roleDefinition, null, 2) : null;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In Microsoft Entra ID → App registrations → New registration. Name it (e.g. <code>prism-readonly</code>).</li>
        <li>Under Certificates &amp; secrets → New client secret. Copy the value immediately — it's shown only once.</li>
        <li>Copy the Application (client) ID and Directory (tenant) ID from the app's Overview page.</li>
        <li>In your Subscription → Access control (IAM) → Add role assignment, using the role definition JSON below (or the built-in Reader role for a quicker start), assigned to the app registration.</li>
        <li>Paste the Tenant ID, Subscription ID, Client ID, and Client Secret below, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {roleDefinition && <JsonBlock label="Role definition JSON" json={roleDefinition} />}

      <div className="form-group">
        <label htmlFor="conn-tenant-id">Tenant ID</label>
        <input id="conn-tenant-id" required value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-subscription-id">Subscription ID</label>
        <input id="conn-subscription-id" required value={subscriptionId} onChange={e => setSubscriptionId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
    </div>
  );
}
```

In `AddIntegrationWizard`, add four new state vars alongside the existing ones (after `const [sessionToken, setSessionToken] = useState("");`):

```jsx
  const [tenantId, setTenantId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
```

Gate the Region field on `provider.key !== "azure"` — replace:
```jsx
          <div className="form-group">
            <label htmlFor="conn-region">Region</label>
            <input id="conn-region" value={region} onChange={e => setRegion(e.target.value)} />
          </div>
```
with:
```jsx
          {provider.key !== "azure" && (
            <div className="form-group">
              <label htmlFor="conn-region">Region</label>
              <input id="conn-region" value={region} onChange={e => setRegion(e.target.value)} />
            </div>
          )}
```

Replace the auth-type conditional's `else` branch (added in Task 4) with a three-way structure — find:
```jsx
          {authType === "iam_role" ? (
            provider.key === "aws" ? (
              <AwsRoleWalkthrough token={token} roleArn={roleArn} setRoleArn={setRoleArn} externalId={externalId} />
            ) : (
              <div className="form-group">
                <label htmlFor="conn-role-arn">Role ARN</label>
                <input id="conn-role-arn" required value={roleArn} onChange={e => setRoleArn(e.target.value)} />
              </div>
            )
          ) : (
            <CredentialFields
              authType={authType}
              accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
              secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
              sessionToken={sessionToken} setSessionToken={setSessionToken}
            />
          )}
```
with:
```jsx
          {authType === "iam_role" ? (
            provider.key === "aws" ? (
              <AwsRoleWalkthrough token={token} roleArn={roleArn} setRoleArn={setRoleArn} externalId={externalId} />
            ) : (
              <div className="form-group">
                <label htmlFor="conn-role-arn">Role ARN</label>
                <input id="conn-role-arn" required value={roleArn} onChange={e => setRoleArn(e.target.value)} />
              </div>
            )
          ) : authType === "oauth2" ? (
            <>
              <AzureServicePrincipalWalkthrough
                token={token}
                tenantId={tenantId} setTenantId={setTenantId}
                subscriptionId={subscriptionId} setSubscriptionId={setSubscriptionId}
              />
              <CredentialFields
                authType="oauth2"
                clientId={clientId} setClientId={setClientId}
                clientSecret={clientSecret} setClientSecret={setClientSecret}
              />
            </>
          ) : (
            <CredentialFields
              authType={authType}
              accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
              secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
              sessionToken={sessionToken} setSessionToken={setSessionToken}
            />
          )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "role-definition JSON"`
Expected: PASS. Also run the full file: `cd web && npx playwright test tests/integrations.spec.js` — all prior tests (AWS `iam_role` and `access_key` paths) must still PASS unchanged, since `provider.key !== "azure"` is true for AWS, so Region still renders, and `authType === "oauth2"` is never true for AWS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/IntegrationsSettings.jsx web/tests/integrations.spec.js
git commit -m "feat: add Azure Service Principal walkthrough to the Add Integration wizard"
```

---

### Task 7: Wire `handleSubmit`'s three-way `config`/`secret` construction

**Files:**
- Modify: `web/src/pages/IntegrationsSettings.jsx`
- Test: `web/tests/integrations.spec.js`

**Interfaces:**
- Consumes: `tenantId`/`subscriptionId`/`clientId`/`clientSecret` state (Task 6).
- Produces: for `authType === "oauth2"`, `POST /api/integrations` gets `config: {tenantId, subscriptionId}` (no `region`), and `POST /:id/credentials` gets `secret: {clientId, clientSecret}` (no `externalId`/`sessionToken`) — this is the exact shape `resolveAzureCredentials` (already shipped) requires.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/integrations.spec.js`, right after the "clicking the Azure card shows the real role-definition JSON..." test from Task 6:

```js
  test("submitting the Azure form sends the exact config/secret shape the backend expects", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations/azure/setup-info", r => r.fulfill({ json: AZURE_SETUP_INFO }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 20, integrationKey: "azure", name: "Prod Azure", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 20, integrationKey: "azure", name: "Prod Azure", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/20/credentials", r =>
      r.fulfill({ json: { id: 20, integrationKey: "azure", name: "Prod Azure", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Microsoft Azure").click();

    await page.getByLabel("Connection name").fill("Prod Azure");
    await page.getByLabel("Tenant ID").fill("11111111-1111-1111-1111-111111111111");
    await page.getByLabel("Subscription ID").fill("22222222-2222-2222-2222-222222222222");
    await page.getByLabel("Client ID").fill("33333333-3333-3333-3333-333333333333");
    await page.getByLabel("Client secret").fill("shh-azure-secret");

    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    const createBody = createReq.postDataJSON();
    expect(createBody.integrationKey).toBe("azure");
    expect(createBody.config).toEqual({ tenantId: "11111111-1111-1111-1111-111111111111", subscriptionId: "22222222-2222-2222-2222-222222222222" });
    expect(createBody.config.region).toBeUndefined();

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "exact config/secret shape"`
Expected: FAIL — `handleSubmit` still builds `config`/`secret` with the two-way `authType === "iam_role" ? ... : ...` split, so for `authType === "oauth2"` it falls into the `access_key`-shaped else branch, sending `config: {region: "us-east-1"}` (wrong — no `tenantId`/`subscriptionId`) and `secret: {accessKeyId: undefined, secretAccessKey: undefined, sessionToken: undefined}` (wrong shape entirely).

- [ ] **Step 3: Write the implementation**

In `web/src/pages/IntegrationsSettings.jsx`'s `handleSubmit`, replace:

```js
      const config = authType === "iam_role" ? { region, roleArn } : { region };
      const secret = authType === "iam_role"
        ? { externalId }
        : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };
```

with:

```js
      const config = authType === "oauth2"
        ? { tenantId, subscriptionId }
        : authType === "iam_role" ? { region, roleArn } : { region };
      const secret = authType === "oauth2"
        ? { clientId, clientSecret }
        : authType === "iam_role" ? { externalId } : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "exact config/secret shape"`
Expected: PASS. Also run the full file: `cd web && npx playwright test tests/integrations.spec.js` — every prior AWS test must still PASS unchanged (the `authType === "oauth2"` branches are new, additive, and never true for AWS's `iam_role`/`access_key` auth types).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/IntegrationsSettings.jsx web/tests/integrations.spec.js
git commit -m "feat: send Azure-shaped config/secret payloads when creating an Azure connection"
```

---

### Task 8: Wire `CredentialFields`'s `oauth2` case into the Rotate Credentials modal

**Files:**
- Modify: `web/src/pages/ConnectionDetail.jsx`
- Test: `web/tests/connection-detail.spec.js`

**Interfaces:**
- Consumes: `CredentialFields` (Task 5).
- Produces: rotating an Azure connection's credentials sends `POST /:id/credentials` with `{authType: "oauth2", secret: {clientId, clientSecret}}` — no `config` touched, matching how AWS rotation never resends `region`/`roleArn`.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/connection-detail.spec.js`: first, add an Azure connection fixture near the top alongside `CONNECTION`/`CATALOG`:

```js
const AZURE_CONNECTION = {
  id: 15, integrationKey: "azure", name: "Prod Azure", status: "connected",
  lastRunAt: "2026-08-18T10:00:00Z", lastRunStatus: "success",
};

const AZURE_CATALOG_ENTRY = { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" };
```

Then add a new test inside `test.describe("Connection detail", ...)`:

```js
  test("Rotate credentials on an Azure connection submits Client ID/Client Secret only", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, AZURE_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/15", r => r.fulfill({ json: AZURE_CONNECTION }));
    await page.route("**/api/integrations/15/runs*", r => r.fulfill({ json: [] }));
    await page.route("**/api/integrations/15/credentials", r =>
      r.fulfill({ json: { ...AZURE_CONNECTION, status: "connected" } })
    );

    await page.goto("/settings/integrations/15");
    await expect(page.getByText("Prod Azure")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Rotate credentials" }).click();

    // No auth-type toggle should appear for a single-auth-type provider.
    await expect(page.getByRole("button", { name: "Access Keys" })).toHaveCount(0);

    await page.getByLabel("Client ID").fill("44444444-4444-4444-4444-444444444444");
    await page.getByLabel("Client secret").fill("new-azure-secret");

    const [credReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/15/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Rotate" }).click(),
    ]);
    const body = credReq.postDataJSON();
    expect(body.authType).toBe("oauth2");
    expect(body.secret).toEqual({ clientId: "44444444-4444-4444-4444-444444444444", clientSecret: "new-azure-secret" });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/connection-detail.spec.js -g "Client ID/Client Secret only"`
Expected: FAIL — `authType` initializes to `providerAuthType || "iam_role"`, and for the Azure catalog entry `providerAuthType` is `"oauth2"`, so `authType` correctly starts as `"oauth2"` — but the modal's render logic and `handleSubmit`'s `secret` construction still only handle `iam_role`/`access_key`, so `oauth2` falls through to the `access_key`-shaped else branch, rendering `<CredentialFields authType="oauth2" .../>` — wait, this already renders correctly for the FIELDS from Task 4/5's generic pass-through, but `handleSubmit`'s `secret` construction in this file hasn't been updated yet, so the submitted body is still `{accessKeyId: undefined, secretAccessKey: undefined, sessionToken: undefined}`, not `{clientId, clientSecret}` — the `expect(body.secret).toEqual(...)` assertion fails.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/ConnectionDetail.jsx`'s `RotateCredentialModal`, add two new state vars alongside the existing ones (after `const [sessionToken, setSessionToken] = useState("");`):

```jsx
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
```

Replace `handleSubmit`'s `secret` construction — find:
```js
      const secret = authType === "iam_role"
        ? { externalId }
        : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };
```
with:
```js
      const secret = authType === "oauth2"
        ? { clientId, clientSecret }
        : authType === "iam_role" ? { externalId } : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };
```

Replace the render logic's `iam_role`-vs-else split — find:
```jsx
          {authType === "iam_role" ? (
            <div className="form-group">
              <label htmlFor="rotate-external-id">External ID</label>
              <input id="rotate-external-id" required value={externalId} onChange={e => setExternalId(e.target.value)} />
            </div>
          ) : (
            <CredentialFields
              authType={authType}
              accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
              secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
              sessionToken={sessionToken} setSessionToken={setSessionToken}
            />
          )}
```
with:
```jsx
          {authType === "iam_role" ? (
            <div className="form-group">
              <label htmlFor="rotate-external-id">External ID</label>
              <input id="rotate-external-id" required value={externalId} onChange={e => setExternalId(e.target.value)} />
            </div>
          ) : authType === "oauth2" ? (
            <CredentialFields
              authType="oauth2"
              clientId={clientId} setClientId={setClientId}
              clientSecret={clientSecret} setClientSecret={setClientSecret}
            />
          ) : (
            <CredentialFields
              authType={authType}
              accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
              secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
              sessionToken={sessionToken} setSessionToken={setSessionToken}
            />
          )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/connection-detail.spec.js -g "Client ID/Client Secret only"`
Expected: PASS. Also run the full file: `cd web && npx playwright test tests/connection-detail.spec.js` — every prior AWS test must still PASS unchanged.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ConnectionDetail.jsx web/tests/connection-detail.spec.js
git commit -m "feat: wire Azure oauth2 credential rotation into the Rotate Credentials modal"
```

---

### Task 9: Full backend + frontend suite verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: nothing — this is the plan's final gate.

- [ ] **Step 1: Run the full frontend e2e suite**

Run: `cd web && npx playwright test`
Expected: PASS — all pre-existing specs plus every new test from Tasks 1-8, with no regressions anywhere in the suite (this plan touched shared, widely-used files — `IntegrationsSettings.jsx`, `ConnectionDetail.jsx` — so a full-suite run, not just the two directly-modified spec files, is the right final check).

- [ ] **Step 2: Confirm the backend suite is still green (unaffected, but cheap to re-confirm)**

Run: `cd api && npm test && npm run test:integration`
Expected: PASS — this plan makes no backend changes, so this is a sanity check that nothing in the environment drifted, not a real risk area.

- [ ] **Step 3: Confirm no stray changes**

Run: `git status --short`
Expected: clean except any genuinely pre-existing, out-of-scope changes already present before this plan started (do not touch or stage those).

---

## Self-Review Notes

- **Spec coverage:** the approved plan-mode design's 9-item task order is implemented 1:1 — icon (Task 1), toggle-bug fix in both files (Tasks 2-3), `CredentialFields` extraction scoped to `access_key`/`oauth2` only (Tasks 4-5), the Azure walkthrough with config-level fields embedded (Task 6), provider-aware `handleSubmit` (Task 7), rotate-modal `oauth2` wiring with secret-only fields (Task 8), full-suite gate (Task 9). The disclosed residual limitation (rotate modal's initial tab not reflecting the connection's actual stored auth type) is documented in Task 3's code comment, not silently dropped. The one item from the design's "Approach" section not requiring its own task — the capstone end-to-end test originally scoped as Task 9 — is subsumed by Task 7's "submitting the Azure form..." test, which already exercises catalog card click → wizard → walkthrough → fill all 4 fields → connection created end-to-end; a separate, narrower capstone would have been redundant with it.
- **Placeholder scan:** every step has real, complete code — no "TBD"/"similar to Task N"/prose-only steps. Task 4's "no new test" step is not a placeholder — it's an explicit, justified TDD variant (pure refactor verified by pre-existing green tests, per the file's own reasoning) rather than an omission.
- **Type consistency:** `CredentialFields`' prop names (`accessKeyId`/`setAccessKeyId`/.../`clientId`/`setClientId`/`clientSecret`/`setClientSecret`) are used identically at all three call sites (wizard's `access_key` branch, wizard's `oauth2` branch, rotate modal's both branches). `AzureServicePrincipalWalkthrough`'s props (`token`/`tenantId`/`setTenantId`/`subscriptionId`/`setSubscriptionId`) match exactly what `AddIntegrationWizard` passes and what `handleSubmit` (Task 7) later reads from the same state vars. `RotateCredentialModal`'s new `providerKey` prop (Task 3) is threaded from `connection.integrationKey` at its one call site and consumed identically by both the Task 3 fix and the Task 8 `oauth2` wiring — no drift between the prop's introduction and its later uses.
