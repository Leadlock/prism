import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const VAULT_ITEM = {
  id: 1,
  title: "Security Policy v1",
  fileName: "policy.pdf",
  fileType: "application/pdf",
  fileSize: 12000,
  uploadedBy: "admin@test.com",
  createdAt: "2025-01-01T00:00:00Z",
  linkedCount: 0,
  locked: false,
  description: "",
};

const MOCK_REQUEST = {
  id: 1,
  title: "Upload Q3 pen test report",
  status: "Open",
  priority: "High",
  assigneeName: null,
  dueDate: "2025-12-01",
  questionId: null,
  createdAt: "2025-01-01T00:00:00Z",
  createdByName: "admin@test.com",
};

test.describe("Evidence workflows", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("Upload file to vault → item appears in list", async ({ page }) => {
    await setAuth(page, "ADMIN");
    // Route handler differentiates GET (initial list) from POST (upload)
    await page.route("**/api/vault", async (r) => {
      if (r.request().method() === "POST") {
        await r.fulfill({ json: VAULT_ITEM });
      } else {
        await r.fulfill({ json: [] });
      }
    });

    await page.goto("/vault");
    await expect(page.getByText("Evidence Vault")).toBeVisible({ timeout: 10_000 });

    // Open upload modal
    await page.getByRole("button", { name: /Upload Evidence/ }).click();
    await expect(page.getByText("Upload to Evidence Vault")).toBeVisible({ timeout: 5_000 });

    // Fill title
    await page.locator(".module-modal input[type=text]").fill("Security Policy v1");

    // Attach a file to the hidden file input
    await page.locator(".module-modal input[type=file]").setInputFiles({
      name: "policy.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("test-content"),
    });

    // Submit upload
    await page.getByRole("button", { name: "Upload to Vault" }).click();

    // Modal closes and item appears in vault list
    await expect(page.getByText("Upload to Evidence Vault")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Security Policy v1")).toBeVisible({ timeout: 5_000 });
  });

  test("Create evidence request → request appears in list", async ({ page }) => {
    await setAuth(page, "LEAD");
    // Route handler differentiates GET from POST for /api/requests*
    await page.route("**/api/requests*", async (r) => {
      if (r.request().method() === "POST") {
        await r.fulfill({ status: 201, json: MOCK_REQUEST });
      } else {
        await r.fulfill({ json: [] });
      }
    });

    await page.goto("/requests");
    await expect(page.getByText("Evidence Requests")).toBeVisible({ timeout: 10_000 });

    // Open create modal
    await page.getByRole("button", { name: /New Request/ }).click();
    await expect(page.getByText("New Evidence Request")).toBeVisible({ timeout: 5_000 });

    // Fill title in the modal
    await page.locator(".module-modal input[type=text]").first().fill("Upload Q3 pen test report");

    // Submit
    await page.getByRole("button", { name: "Create Request" }).click();

    // Item appears in the list (state update is immediate — no GET refetch)
    await expect(page.getByText("Upload Q3 pen test report")).toBeVisible({ timeout: 5_000 });
  });
});
