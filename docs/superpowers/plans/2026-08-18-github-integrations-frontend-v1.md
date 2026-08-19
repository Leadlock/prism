# GitHub Integrations Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GitHub backend (connector, credential resolution, catalog seed, `GET /:id/github/setup-info`, `GET /github/manifest-callback`, `GET /github/install-callback` — see `docs/superpowers/plans/2026-08-18-github-evidence-collection-v1.md`) reachable from the UI — today the "Add Integration" wizard only knows how to render AWS's `iam_role`/`access_key` fields and Azure's `oauth2` Client ID/Secret fields; there is no way to create a GitHub connection through the app at all.

**Architecture:** GitHub is the first provider whose connect flow is not "fill a form, click Connect" — it's two clicks that each leave the SPA entirely (a real `<form method="post">` submission to `github.com`, not a `fetch`), with GitHub's own redirects landing the browser back on `/settings/integrations/:id` carrying `?githubInstallUrl=...` or `?githubError=...` query params instead of a JSON response `apiFetch` can await. This plan adds one new shared component, `GithubAppWalkthrough` (fetches `setup-info`, renders the manifest-POST button), used identically from both the "Add Integration" wizard (first-time connect) and the "Rotate credentials" modal (reconnect, i.e. re-running the manifest flow to mint a new App). `CredentialFields` is not extended — GitHub never has a manually-typed secret, so its render branches are bypassed entirely for this provider, not given a new case.

**Tech Stack:** React 18 (function components, hooks), `react-icons/fa`'s `FaGithub` (already available in the installed `react-icons@5.7.0` — it's one of the package's original, long-standing brand icons, same tier as `FaAws`). `react-router-dom`'s `useSearchParams` (same package `useNavigate`/`useParams` already come from) to read the `githubInstallUrl`/`githubError` query params GitHub's redirect chain lands on `ConnectionDetail`.

**Spec:** `/Users/aum/.claude/plans/understand-my-codebase-and-deep-matsumoto.md`'s Frontend design section (the approved plan-mode design) — read it for the full rationale behind why `CredentialFields` gets no new case, why rotation needs a distinct "Reconnect via GitHub" affordance instead of a form, and why the e2e strategy stops short of simulating GitHub's actual redirect chain.

## Global Constraints

- No new HTTP client, no new routing abstraction for `apiFetch`-backed calls — `setup-info` is still fetched via the existing `apiFetch(path, {token})`. The one deliberate exception: the manifest submission itself is a real `<form method="post" action="https://github.com/...">`, not a `fetch` call — GitHub's Manifest flow requires an actual cross-origin browser navigation carrying the manifest as form data, which `fetch`/`apiFetch` cannot do (and must not be made to do, since the whole point is leaving Prism's origin for GitHub's).
- `GithubAppWalkthrough` is shared between the connect wizard and the rotate modal, not per-context like `AwsRoleWalkthrough`/`AzureServicePrincipalWalkthrough` (which render different content in each place). It needs only `connectionId` and `token` — no provider-specific config fields flow through it the way Tenant ID/Subscription ID do for Azure, because GitHub's `config` (`installationId`/`org`) is populated entirely by the backend's callback routes, never typed in.
- `CredentialFields.jsx` gets no `github` case — the file's three existing branches (`access_key`, `oauth2`, and its `null` fallback) already cover every provider that manually types a secret; GitHub falls through to `null` by design, and every github-provider render path in `IntegrationsSettings.jsx`/`ConnectionDetail.jsx` must route around `CredentialFields` entirely rather than calling it with an unhandled `authType`.
- Region field visibility extends its existing `provider.key !== "azure"` guard to also exclude `"github"` — GitHub has no region concept, same reasoning Azure's guard already established.
- `githubInstallUrl`/`githubError` are read once from the URL on `ConnectionDetail` mount and then stripped (`navigate(location.pathname, {replace: true})`) so a manual page refresh doesn't replay a stale banner or install prompt from a completed or abandoned flow.
- The connect wizard still creates the `pending` `integration_connections` row via the existing, unmodified `POST /api/integrations` (`config: {}` for github — nothing is known yet) before rendering `GithubAppWalkthrough` — reusing the exact `createdConnection` retry-safe pattern AWS/Azure already use, not a new creation path.

---

## File Structure

- Modify: `web/src/pages/IntegrationsSettings.jsx` — icon map, Region guard, a `provider.key === "github"` wizard branch that creates the connection then renders `GithubAppWalkthrough` instead of `CredentialFields` + Connect button
- Create: `web/src/components/GithubAppWalkthrough.jsx` — shared setup-info fetch + manifest-POST form, used by both the wizard and the rotate modal
- Modify: `web/src/pages/ConnectionDetail.jsx` — reads `githubInstallUrl`/`githubError` query params and renders an Install button / error banner; `RotateCredentialModal`'s `providerKey === "github"` branch renders `GithubAppWalkthrough` instead of a form
- Modify: `web/tests/integrations.spec.js` — GitHub catalog entry, wizard walkthrough rendering, manifest form contents
- Modify: `web/tests/connection-detail.spec.js` — install-prompt/error-banner rendering, GitHub rotate flow

---

### Task 1: GitHub icon in the catalog grid

**Files:**
- Modify: `web/src/pages/IntegrationsSettings.jsx`
- Test: `web/tests/integrations.spec.js`

**Interfaces:**
- Consumes: `FaGithub` from `react-icons/fa` (already a project dependency, same package `FaAws`/`FaMicrosoft` already come from).
- Produces: `PROVIDER_ICON.github` — purely additive, independently testable, no dependency on any other task in this plan.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/integrations.spec.js`, as a new test inside the existing `test.describe("Integrations settings", ...)` block, right after the existing "shows the Azure catalog entry with its own icon" test:

```js
  test("shows the GitHub catalog entry with its own icon", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[title="GitHub"] svg')).toBeVisible();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "GitHub catalog entry"`
Expected: FAIL — the card renders (falls back to a plain text label, since no `PROVIDER_ICON.github` entry exists), but no `<svg>` is inside it.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/IntegrationsSettings.jsx`, change the import line:

```jsx
import { FaAws, FaMicrosoft, FaGithub } from "react-icons/fa";
```

And extend `PROVIDER_ICON`:

```jsx
const PROVIDER_ICON = {
  aws: { Icon: FaAws, color: "#FF9900" },
  azure: { Icon: FaMicrosoft, color: "#0078D4" },
  github: { Icon: FaGithub, color: "#181717" },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "GitHub catalog entry"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/IntegrationsSettings.jsx web/tests/integrations.spec.js
git commit -m "feat: add GitHub icon to the connector catalog grid"
```

---

### Task 2: Shared `GithubAppWalkthrough` component

**Files:**
- Create: `web/src/components/GithubAppWalkthrough.jsx`
- Test: `web/tests/integrations.spec.js`

**Interfaces:**
- Consumes: `GET /api/integrations/:id/github/setup-info` → `{manifest, state}` (already shipped by the backend plan). The existing `apiFetch` from `api/client.js`.
- Produces: `<GithubAppWalkthrough connectionId={id} token={token} />` — fetches `setup-info` on mount and renders a real HTML form targeting `https://github.com/settings/apps/new?state=<state>` with a hidden `manifest` field and a submit button. Tasks 3 and 5 both render this component; neither passes it anything beyond `connectionId`/`token`.

This component is independently testable in isolation via the wizard (Task 3 wires it into the render tree so it's reachable), so its test is written here but only becomes reachable once Task 3 lands — same "add the leaf component, wire it in next" sequencing the Azure frontend plan used for `CredentialFields`'s `oauth2` case.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/integrations.spec.js`, a new fixture near the top alongside `AZURE_SETUP_INFO`:

```js
const GITHUB_SETUP_INFO = {
  manifest: {
    name: "Prism Evidence Collection - Acme Corp",
    url: "https://api.prism.example.com",
    redirect_url: "https://api.prism.example.com/api/integrations/github/manifest-callback",
    hook_attributes: { url: "https://api.prism.example.com", active: false },
    public: false,
    default_permissions: { organization_administration: "read", administration: "read", metadata: "read" },
  },
  state: "signed-state-token-abc123",
};
```

Then a new test inside `test.describe("Integrations settings", ...)`, right after the Azure "clicking the Azure card..." test:

```js
  test("clicking the GitHub card creates a pending connection and shows the Create GitHub App button", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" }],
    }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending" }] : [] });
    });
    await page.route("**/api/integrations/30/github/setup-info", r => r.fulfill({ json: GITHUB_SETUP_INFO }));

    await page.goto("/settings/integrations");
    await page.getByTitle("GitHub").click();

    await page.getByLabel("Connection name").fill("Prod GitHub");

    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.getByRole("button", { name: "Start GitHub setup" }).click(),
    ]);
    expect(createReq.postDataJSON()).toEqual({ integrationKey: "github", name: "Prod GitHub", config: {} });

    const createButton = page.getByRole("button", { name: "Create GitHub App on GitHub" });
    await expect(createButton).toBeVisible({ timeout: 10_000 });

    const form = page.locator("form", { has: createButton });
    await expect(form).toHaveAttribute("action", "https://github.com/settings/apps/new?state=signed-state-token-abc123");
    await expect(form).toHaveAttribute("method", "post");
    const manifestValue = await form.locator('input[name="manifest"]').getAttribute("value");
    expect(JSON.parse(manifestValue)).toEqual(GITHUB_SETUP_INFO.manifest);

    // No AWS/Azure-shaped fields should render for GitHub.
    await expect(page.getByLabel("Region")).toHaveCount(0);
    await expect(page.getByLabel("Client ID")).toHaveCount(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "Create GitHub App button"`
Expected: FAIL — no `provider.key === "github"` branch exists yet in the wizard, so clicking the GitHub card falls into the default `access_key`-shaped path; there is no "Start GitHub setup" button at all.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/GithubAppWalkthrough.jsx`:

```jsx
import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";

export default function GithubAppWalkthrough({ connectionId, token }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch(`/api/integrations/${connectionId}/github/setup-info`, { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [connectionId, token]);

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Click "Create GitHub App on GitHub" below — GitHub will show you exactly the read-only permissions Prism is requesting.</li>
        <li>Confirm creating the App. GitHub sends you back here automatically.</li>
        <li>Click "Install the App" and choose which repositories Prism can read.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {setupInfo && (
        <form action={`https://github.com/settings/apps/new?state=${encodeURIComponent(setupInfo.state)}`} method="post">
          <input type="hidden" name="manifest" value={JSON.stringify(setupInfo.manifest)} />
          <button type="submit" className="btn btn-primary">Create GitHub App on GitHub</button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

This test won't fully pass until Task 3 wires `GithubAppWalkthrough` into the wizard's render tree — running it now still FAILs (no "Start GitHub setup" button yet), which is expected and correct; Task 3's Step 4 is where this test actually goes green. Confirm only that the new file has no syntax errors: `cd web && node --check src/components/GithubAppWalkthrough.jsx` (or equivalent — this file has no isolated unit-test harness, same disclosed limitation the Azure frontend plan's Task 5 noted for `CredentialFields`'s `oauth2` case).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/GithubAppWalkthrough.jsx
git commit -m "feat: add shared GithubAppWalkthrough component for the App manifest flow"
```

---

### Task 3: Wire the wizard's `provider.key === "github"` branch

**Files:**
- Modify: `web/src/pages/IntegrationsSettings.jsx`
- Test: `web/tests/integrations.spec.js`

**Interfaces:**
- Consumes: `GithubAppWalkthrough` (Task 2).
- Produces: for `provider.key === "github"`, the wizard renders a "Connection name" field and a "Start GitHub setup" button; clicking it creates the connection (`POST /api/integrations` with `config: {}`) via the existing `createdConnection` retry-safe pattern, then swaps to rendering `GithubAppWalkthrough` for that connection — no `authType` toggle, no `CredentialFields`, no "Connect" button, since there is no secret this wizard ever collects.

- [ ] **Step 1: Write the test** (already written in Task 2, Step 1 — "clicking the GitHub card creates a pending connection and shows the Create GitHub App button")

- [ ] **Step 2: Run the test to verify it still fails**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "Create GitHub App button"`
Expected: FAIL, same reason as Task 2's Step 2 — no `provider.key === "github"` branch exists yet.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/IntegrationsSettings.jsx`, add the import:

```jsx
import GithubAppWalkthrough from "../components/GithubAppWalkthrough.jsx";
```

In `AddIntegrationWizard`, add a new state var alongside `createdConnection`:

```jsx
  const [githubSetupStarted, setGithubSetupStarted] = useState(false);
```

Add a dedicated handler, alongside `handleSubmit`:

```jsx
  const handleStartGithubSetup = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let connection = createdConnection;
      if (!connection) {
        connection = await apiFetch("/api/integrations", {
          token, method: "POST",
          body: JSON.stringify({ integrationKey: provider.key, name, config: {} })
        });
        setCreatedConnection(connection);
      }
      setGithubSetupStarted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };
```

Gate the Region field on both non-azure and non-github — replace:
```jsx
          {provider.key !== "azure" && (
```
with:
```jsx
          {provider.key !== "azure" && provider.key !== "github" && (
```

Replace the form's body to branch on `provider.key === "github"` before the existing `authType`-driven three-way conditional — find the `<form onSubmit={handleSubmit}>` opening tag and the auth-toggle/Region block immediately inside it, and restructure so the github case short-circuits before any of that renders:

```jsx
        <form onSubmit={provider.key === "github" ? handleStartGithubSetup : handleSubmit}>
          {error && <p className="error-text">{error}</p>}
          <div className="form-group">
            <label htmlFor="conn-name">Connection name</label>
            <input id="conn-name" required value={name} onChange={e => setName(e.target.value)} placeholder={`My ${provider.name}`} />
          </div>

          {provider.key === "github" ? (
            githubSetupStarted && createdConnection ? (
              <GithubAppWalkthrough connectionId={createdConnection.id} token={token} />
            ) : null
          ) : (
            <>
              {provider.key === "aws" ? (
                <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                  {["iam_role", "access_key"].map(t => (
                    <button type="button" key={t}
                      className="btn btn-ghost"
                      style={{ fontWeight: authType === t ? 700 : 400, borderBottom: authType === t ? "2px solid var(--accent)" : "none" }}
                      onClick={() => setAuthType(t)}
                    >
                      {t === "iam_role" ? "IAM Role" : "Access Keys"}
                    </button>
                  ))}
                </div>
              ) : null}

              {provider.key !== "azure" && provider.key !== "github" && (
                <div className="form-group">
                  <label htmlFor="conn-region">Region</label>
                  <input id="conn-region" value={region} onChange={e => setRegion(e.target.value)} />
                </div>
              )}

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
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            {!(provider.key === "github" && githubSetupStarted) && (
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {provider.key === "github"
                  ? (submitting ? "Starting…" : "Start GitHub setup")
                  : (submitting ? "Connecting…" : "Connect")}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {provider.key === "github" && githubSetupStarted ? "Close" : "Cancel"}
            </button>
          </div>
        </form>
```

Note the submit button is hidden once `githubSetupStarted` is true — at that point the only actionable control is `GithubAppWalkthrough`'s own "Create GitHub App on GitHub" button, and the Cancel button relabels to "Close" since the connection already exists (closing now just dismisses the modal, matching how a `pending` AWS/Azure connection that failed credentials can be revisited later from the connection list, per the existing failed-connection Delete-button flow).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/integrations.spec.js -g "Create GitHub App button"`
Expected: PASS. Also run the full file: `cd web && npx playwright test tests/integrations.spec.js` — every prior AWS/Azure test must still PASS unchanged, since `provider.key === "github"` is never true for those providers.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/IntegrationsSettings.jsx web/tests/integrations.spec.js
git commit -m "feat: wire the GitHub App manifest flow into the Add Integration wizard"
```

---

### Task 4: `ConnectionDetail` reads `githubInstallUrl`/`githubError`

**Files:**
- Modify: `web/src/pages/ConnectionDetail.jsx`
- Test: `web/tests/connection-detail.spec.js`

**Interfaces:**
- Consumes: `useSearchParams` from `react-router-dom`.
- Produces: on mount, if the URL carries `?githubInstallUrl=<url>`, renders an "Install the App" link/button pointing at it, above the normal status section; if it carries `?githubError=<message>`, renders it through the page's existing `error` banner. Either way, the query params are stripped from the URL immediately after being read (`navigate(location.pathname, {replace: true})`) so a refresh doesn't replay them.

This is where the browser actually lands after `GET /github/manifest-callback` redirects (per the backend plan's Task 8) — GitHub's own redirect chain, not a click inside the SPA, is what puts these query params on the URL.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/connection-detail.spec.js`, two new tests inside `test.describe("Connection detail", ...)`, after the existing Azure rotate test:

```js
  test("shows an Install the App prompt when redirected back from GitHub with an install URL", async ({ page }) => {
    await setAuth(page, "ADMIN");
    const GITHUB_CATALOG_ENTRY = { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" };
    const GITHUB_CONNECTION = { id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending", lastRunAt: null, lastRunStatus: null };
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, GITHUB_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/30", r => r.fulfill({ json: GITHUB_CONNECTION }));
    await page.route("**/api/integrations/30/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/30?githubInstallUrl=" + encodeURIComponent("https://github.com/apps/prism-acme/installations/new?state=abc123"));

    await expect(page.getByText("Prod GitHub")).toBeVisible({ timeout: 10_000 });
    const installLink = page.getByRole("link", { name: "Install the App" });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute("href", "https://github.com/apps/prism-acme/installations/new?state=abc123");

    // The query param must not survive a client-side navigation replay.
    await expect(page).not.toHaveURL(/githubInstallUrl/);
  });

  test("shows a githubError banner when redirected back from GitHub with an error", async ({ page }) => {
    await setAuth(page, "ADMIN");
    const GITHUB_CATALOG_ENTRY = { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" };
    const GITHUB_CONNECTION = { id: 30, integrationKey: "github", name: "Prod GitHub", status: "error", lastRunAt: null, lastRunStatus: null };
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, GITHUB_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/30", r => r.fulfill({ json: GITHUB_CONNECTION }));
    await page.route("**/api/integrations/30/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/30?githubError=" + encodeURIComponent("GitHub returned 404 exchanging the manifest code"));

    await expect(page.getByText("GitHub returned 404 exchanging the manifest code")).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/githubError/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/connection-detail.spec.js -g "redirected back from GitHub"`
Expected: FAIL — neither query param is read anywhere yet, so no "Install the App" link renders and `githubError` never reaches the `error` state.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/ConnectionDetail.jsx`, update the import line:

```jsx
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
```

In the default-exported `ConnectionDetail` component, add alongside the other hooks near the top:

```jsx
  const [searchParams] = useSearchParams();
  const [githubInstallUrl, setGithubInstallUrl] = useState(null);
```

Add a new effect, alongside the existing `load`-triggering one:

```jsx
  useEffect(() => {
    const installUrl = searchParams.get("githubInstallUrl");
    const githubError = searchParams.get("githubError");
    if (installUrl) setGithubInstallUrl(installUrl);
    if (githubError) setError(githubError);
    if (installUrl || githubError) navigate(`/settings/integrations/${id}`, { replace: true });
    // Only ever meant to run once, reading whatever GitHub's redirect put on
    // the URL at load time — not on every searchParams identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Render the install prompt inside the existing status `<section>`, right after the opening `<section className="admin-section">` and before its `<div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>`:

```jsx
          {githubInstallUrl && (
            <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
              <p style={{ fontSize: 13, margin: "0 0 8px" }}>The GitHub App was created. Install it on your organization to finish connecting.</p>
              <a href={githubInstallUrl} className="btn btn-primary">Install the App</a>
            </div>
          )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/connection-detail.spec.js -g "redirected back from GitHub"`
Expected: PASS. Also run the full file: `cd web && npx playwright test tests/connection-detail.spec.js` — every prior AWS/Azure test must still PASS unchanged (the new effect only acts when one of the two query params is actually present).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ConnectionDetail.jsx web/tests/connection-detail.spec.js
git commit -m "feat: handle the GitHub manifest/install redirect landing on connection detail"
```

---

### Task 5: `RotateCredentialModal`'s GitHub branch — "Reconnect via GitHub"

**Files:**
- Modify: `web/src/pages/ConnectionDetail.jsx`
- Test: `web/tests/connection-detail.spec.js`

**Interfaces:**
- Consumes: `GithubAppWalkthrough` (Task 2).
- Produces: when `providerKey === "github"`, `RotateCredentialModal` renders `GithubAppWalkthrough` for the existing `connectionId` instead of any form — no toggle, no `CredentialFields`, no "Rotate" submit button, since reconnecting means re-running the manifest flow (a new App/keypair), not resubmitting a secret.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/connection-detail.spec.js`, after the "Rotate credentials on an Azure connection..." test:

```js
  test("Rotate credentials on a GitHub connection shows Reconnect via GitHub instead of a form", async ({ page }) => {
    await setAuth(page, "ADMIN");
    const GITHUB_CATALOG_ENTRY = { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" };
    const GITHUB_CONNECTION = { id: 31, integrationKey: "github", name: "Prod GitHub", status: "connected", lastRunAt: null, lastRunStatus: null };
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, GITHUB_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/31", r => r.fulfill({ json: GITHUB_CONNECTION }));
    await page.route("**/api/integrations/31/runs*", r => r.fulfill({ json: [] }));
    await page.route("**/api/integrations/31/github/setup-info", r => r.fulfill({
      json: { manifest: { name: "Prism Evidence Collection - Acme Corp" }, state: "reconnect-state-xyz" },
    }));

    await page.goto("/settings/integrations/31");
    await expect(page.getByText("Prod GitHub")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Rotate credentials" }).click();

    // No form fields, no auth-type toggle — just the manifest-flow button.
    await expect(page.getByRole("button", { name: "Rotate", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Client ID")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Access Keys" })).toHaveCount(0);

    const reconnectButton = page.getByRole("button", { name: "Create GitHub App on GitHub" });
    await expect(reconnectButton).toBeVisible({ timeout: 10_000 });
    const form = page.locator("form", { has: reconnectButton });
    await expect(form).toHaveAttribute("action", "https://github.com/settings/apps/new?state=reconnect-state-xyz");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx playwright test tests/connection-detail.spec.js -g "Reconnect via GitHub"`
Expected: FAIL — `RotateCredentialModal` has no `providerKey === "github"` branch yet, so it falls into the `oauth2`-shaped `CredentialFields` path and still renders a "Rotate" submit button plus (empty) Client ID/secret fields.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/ConnectionDetail.jsx`, add the import:

```jsx
import GithubAppWalkthrough from "../components/GithubAppWalkthrough.jsx";
```

In `RotateCredentialModal`, branch the whole form body on `providerKey === "github"` before the existing `authType`-driven conditional — replace:

```jsx
        <form onSubmit={handleSubmit}>
          {error && <p className="error-text">{error}</p>}
          {providerKey === "aws" ? (
```

with:

```jsx
        <form onSubmit={providerKey === "github" ? (e) => e.preventDefault() : handleSubmit}>
          {error && <p className="error-text">{error}</p>}
          {providerKey === "github" ? (
            <GithubAppWalkthrough connectionId={connectionId} token={token} />
          ) : providerKey === "aws" ? (
```

And close that new ternary branch before the existing `authType === "iam_role" ? ... : ...` block — replace:

```jsx
          ) : null}
          {authType === "iam_role" ? (
```

with:

```jsx
          ) : null}
          {providerKey === "github" ? null : authType === "iam_role" ? (
```

Finally, hide the "Rotate" submit button for github (there's nothing to submit — `GithubAppWalkthrough`'s own button is the only action) — replace:

```jsx
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Rotating…" : "Rotate"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
```

with:

```jsx
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            {providerKey !== "github" && (
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Rotating…" : "Rotate"}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {providerKey === "github" ? "Close" : "Cancel"}
            </button>
          </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx playwright test tests/connection-detail.spec.js -g "Reconnect via GitHub"`
Expected: PASS. Also run the full file: `cd web && npx playwright test tests/connection-detail.spec.js` — every prior AWS/Azure rotate test must still PASS unchanged, since `providerKey === "github"` is never true for those.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ConnectionDetail.jsx web/tests/connection-detail.spec.js
git commit -m "feat: wire GitHub reconnect-via-manifest-flow into the Rotate Credentials modal"
```

---

### Task 6: Full frontend + backend suite verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-5, and the backend plan (`2026-08-18-github-evidence-collection-v1.md`) this plan builds on.
- Produces: nothing — this is the plan's final gate.

- [ ] **Step 1: Run the full frontend e2e suite**

Run: `cd web && npx playwright test`
Expected: PASS — all pre-existing specs plus every new test from Tasks 1-5, with no regressions anywhere (this plan touched shared, widely-used files — `IntegrationsSettings.jsx`, `ConnectionDetail.jsx` — so a full-suite run, not just the two directly-modified spec files, is the right final check).

- [ ] **Step 2: Confirm the backend suite is still green**

Run: `cd api && npm test && npm run test:integration`
Expected: PASS — this plan makes no backend changes; this confirms the backend plan it depends on is actually merged and nothing drifted.

- [ ] **Step 3: Confirm no stray changes**

Run: `git status --short`
Expected: clean except any genuinely pre-existing, out-of-scope changes already present before this plan started.

---

## Self-Review Notes

- **Spec coverage:** the approved design's frontend section is covered exactly — icon (Task 1), the shared walkthrough component used by both call sites (Task 2), the wizard's github-specific flow bypassing `CredentialFields`/the auth-type toggle/Region entirely (Task 3), reading GitHub's redirect-carried query params on `ConnectionDetail` (Task 4, a piece the design named but didn't fully mechanize — `useSearchParams` + strip-after-read is the concrete realization of it), the rotate modal's "Reconnect via GitHub" button in place of a form (Task 5), full-suite gate (Task 6). The design's explicit call that e2e tests "can't realistically simulate GitHub's own redirect chain" is honored — every test in this plan either exercises the wizard's own state up to the point of leaving the SPA (asserting the form's `action`/hidden `manifest` value, never actually submitting it) or starts `page.goto` directly at the post-redirect URL, never simulating github.com itself.
- **Placeholder scan:** every step has real, complete code. Task 2's Step 4 is not a placeholder — like the Azure frontend plan's Task 5, it's an explicit, disclosed test-ordering choice (a leaf component with no reachable render path yet, verified only for syntax validity until the next task wires it in and a real assertion can pass).
- **Type consistency:** `GithubAppWalkthrough`'s props (`connectionId`, `token`) are identical at both call sites — Task 3's wizard (`createdConnection.id`) and Task 5's rotate modal (`connectionId`, already in scope as a prop). `setupInfo.state`/`setupInfo.manifest` (the shape `GET /:id/github/setup-info` returns, fixed by the backend plan) are consumed identically by the one place that reads them — `GithubAppWalkthrough` itself — so there's no duplicated, potentially-drifting parsing logic between the wizard and rotate-modal paths. `githubInstallUrl`/`githubError` (Task 4) are the exact query-param names the backend plan's Tasks 8-9 redirect with — verified against `2026-08-18-github-evidence-collection-v1.md`'s Task 8/9 code directly, not re-derived from memory.

