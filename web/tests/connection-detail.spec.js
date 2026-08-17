import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const CONNECTION = {
  id: 10, integrationKey: "aws", name: "Prod AWS", status: "connected",
  lastRunAt: "2026-08-17T10:00:00Z", lastRunStatus: "success",
};

const RUNS = [
  { id: 1, status: "success", triggerType: "manual", testsRun: 7, testsPassed: 7, testsFailed: 0, startedAt: "2026-08-17T10:00:00Z", finishedAt: "2026-08-17T10:01:00Z" },
  { id: 2, status: "partial_failure", triggerType: "manual", testsRun: 7, testsPassed: 5, testsFailed: 2, startedAt: "2026-08-16T10:00:00Z", finishedAt: "2026-08-16T10:01:00Z" },
];

test.describe("Connection detail", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("shows status, last run, and collection history", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: RUNS }));

    await page.goto("/settings/integrations/10");

    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("connected")).toBeVisible();
    await expect(page.getByText("partial_failure")).toBeVisible();
  });

  test("Run Now triggers a collection run", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: RUNS }));
    await page.route("**/api/integrations/10/run", r => r.fulfill({ json: { id: 3, status: "success", testsRun: 7, testsPassed: 7, testsFailed: 0 } }));

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    const [runReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10/run") && req.method() === "POST"),
      page.getByRole("button", { name: "Run Now" }).click(),
    ]);
    expect(runReq.method()).toBe("POST");
  });

  test("Revoke prompts confirmation and calls DELETE", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    page.once("dialog", d => d.accept());
    const [delReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10") && req.method() === "DELETE"),
      page.getByRole("button", { name: "Revoke" }).click(),
    ]);
    expect(delReq.method()).toBe("DELETE");
  });
});
