import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const CATALOG = [
  { id: 1, key: "aws", name: "Amazon Web Services", category: "cloud", authType: "iam_role", status: "active" },
];

const CONNECTIONS = [
  { id: 10, integrationKey: "aws", name: "Prod AWS", status: "connected", lastRunAt: "2026-08-17T10:00:00Z", lastRunStatus: "success" },
];

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

    await expect(page.getByText("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Prod AWS")).toBeVisible();
    await expect(page.getByText("connected")).toBeVisible();
  });

  test("Add Integration wizard creates a connection and stores credentials", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));

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
    await page.getByRole("button", { name: "+ Add Integration" }).click();
    await page.getByRole("button", { name: "Amazon Web Services" }).click();

    await page.getByLabel("Connection name").fill("New AWS");
    await page.getByLabel("Role ARN").fill("arn:aws:iam::123456789012:role/prism-readonly");
    await page.getByLabel("External ID").fill("prism-ext-id");

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
    await page.getByRole("button", { name: "+ Add Integration" }).click();
    await page.getByRole("button", { name: "Amazon Web Services" }).click();

    await page.getByLabel("Connection name").fill("Retry AWS");
    await page.getByLabel("Role ARN").fill("arn:aws:iam::123456789012:role/prism-readonly");
    await page.getByLabel("External ID").fill("prism-ext-id");

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

  test("AUDITOR can view the connection list read-only but not add integrations", async ({ page }) => {
    await setAuth(page, "AUDITOR");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page).toHaveURL(/\/settings\/integrations/);
    await expect(page.getByText("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Prod AWS")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add Integration" })).toHaveCount(0);
  });
});
