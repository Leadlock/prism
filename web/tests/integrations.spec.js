import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const CATALOG = [
  { id: 1, key: "aws", name: "Amazon Web Services", category: "cloud", authType: "iam_role", status: "active" },
];

const CONNECTIONS = [
  { id: 10, integrationKey: "aws", name: "Prod AWS", status: "connected", lastRunAt: "2026-08-17T10:00:00Z", lastRunStatus: "success" },
];

const SETUP_INFO = {
  principalArn: "arn:aws:iam::999999999999:role/prism-backend",
  principalError: null,
  permissionsPolicy: { Version: "2012-10-17", Statement: [{ Sid: "PrismReadOnlyEvidenceCollection", Effect: "Allow", Action: ["iam:ListUsers"], Resource: "*" }] },
};

const AZURE_SETUP_INFO = {
  roleDefinition: {
    properties: {
      roleName: "Prism Read-Only Evidence Collection",
      description: "Least-privilege read access for Prism's automated ISO 27001 evidence collection.",
      assignableScopes: ["/subscriptions/<subscription-id>"],
      permissions: [
        {
          actions: [
            "Microsoft.Storage/storageAccounts/read",
            "Microsoft.Network/networkSecurityGroups/read",
            "Microsoft.Insights/diagnosticSettings/read",
            "Microsoft.Security/pricings/read",
            "Microsoft.Resources/subscriptions/resourceGroups/read",
          ],
          notActions: [],
          dataActions: [],
          notDataActions: [],
        },
      ],
    },
  },
};

test.describe("Integrations settings", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("lists the AWS catalog entry and an existing connection", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Prod AWS")).toBeVisible();
    await expect(page.getByText("connected")).toBeVisible();
  });

  test("failed connections show a Delete button that removes them from the list", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));

    let deleted = false;
    await page.route("**/api/integrations", r => {
      const failedConn = { id: 11, integrationKey: "aws", name: "Broken AWS", status: "error", lastRunAt: null, lastRunStatus: null };
      return r.fulfill({ json: deleted ? CONNECTIONS : [...CONNECTIONS, failedConn] });
    });
    await page.route("**/api/integrations/11", r => {
      if (r.request().method() === "DELETE") { deleted = true; return r.fulfill({ status: 204 }); }
      return r.fulfill({ json: {} });
    });

    await page.goto("/settings/integrations");
    await expect(page.getByText("Broken AWS")).toBeVisible({ timeout: 10_000 });

    // A connected connection must not get a Delete button.
    const connectedRow = page.locator(".admin-row", { has: page.getByText("Prod AWS") });
    await expect(connectedRow.getByRole("button", { name: "Delete" })).toHaveCount(0);

    page.once("dialog", d => d.accept());
    const failedRow = page.locator(".admin-row", { has: page.getByText("Broken AWS") });
    const [delReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/11") && req.method() === "DELETE"),
      failedRow.getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(delReq.method()).toBe("DELETE");

    await expect(page.getByText("Broken AWS")).toHaveCount(0);
  });

  test("shows the Azure catalog entry with its own icon", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[title="Microsoft Azure"] svg')).toBeVisible();
  });

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

  test("clicking the AWS card opens the wizard, shows the real trust policy, and creates a connection", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/aws/setup-info", r => r.fulfill({ json: SETUP_INFO }));

    // The page reloads the connection list (GET /api/integrations) right after
    // creating one, so the mock must reflect that a connection now exists —
    // a static empty-array response would make the final assertion below fail.
    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 11, integrationKey: "aws", name: "New AWS", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 11, integrationKey: "aws", name: "New AWS", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/11/credentials", r =>
      r.fulfill({ json: { id: 11, integrationKey: "aws", name: "New AWS", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Amazon Web Services").click();

    // The trust policy should embed the *real* principal ARN from setup-info,
    // not a placeholder — this is the whole point of fetching it.
    await expect(page.getByText(SETUP_INFO.principalArn)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('"iam:ListUsers"')).toBeVisible();

    await page.getByLabel("Connection name").fill("New AWS");
    await page.getByLabel(/Role ARN/).fill("arn:aws:iam::123456789012:role/prism-readonly");

    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq.postDataJSON().name).toBe("New AWS");

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("retrying after a failed credentials step does not create a duplicate connection", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/aws/setup-info", r => r.fulfill({ json: SETUP_INFO }));

    let createCount = 0;
    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        createCount += 1;
        created = true;
        return r.fulfill({ status: 201, json: { id: 12, integrationKey: "aws", name: "Retry AWS", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 12, integrationKey: "aws", name: "Retry AWS", status: "connected" }] : [] });
    });

    // First credentials attempt fails (e.g. a bad role ARN); the second, identical
    // retry succeeds. Only the credentials call should differ between attempts —
    // the connection-create call must not fire again.
    let credentialsAttempts = 0;
    await page.route("**/api/integrations/12/credentials", r => {
      credentialsAttempts += 1;
      if (credentialsAttempts === 1) {
        return r.fulfill({ status: 400, json: { error: "Unable to assume role" } });
      }
      return r.fulfill({ json: { id: 12, integrationKey: "aws", name: "Retry AWS", status: "connected" } });
    });

    await page.goto("/settings/integrations");
    await page.getByTitle("Amazon Web Services").click();

    await page.getByLabel("Connection name").fill("Retry AWS");
    await page.getByLabel(/Role ARN/).fill("arn:aws:iam::123456789012:role/prism-readonly");

    // First attempt — credentials step fails, wizard stays open with an error.
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("Unable to assume role")).toBeVisible({ timeout: 10_000 });

    // Retry with the same form state — should reuse the already-created connection.
    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/12/credentials")),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq).toBeTruthy();

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
    expect(createCount).toBe(1);
  });

  test("non-admin/lead roles cannot reach the page", async ({ page }) => {
    await setAuth(page, "CONTRIBUTOR");
    await page.goto("/settings/integrations");
    await expect(page).not.toHaveURL(/\/settings\/integrations/);
  });

  test("AUDITOR can view the connection list read-only but cannot open the connect wizard", async ({ page }) => {
    await setAuth(page, "AUDITOR");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page).toHaveURL(/\/settings\/integrations/);
    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Prod AWS")).toBeVisible();

    await page.getByTitle("Amazon Web Services").click();
    await expect(page.getByText("Connect Amazon Web Services")).toHaveCount(0);
  });
});
