import { test, expect } from "@playwright/test";

// Sets localStorage auth state and mocks the startup /me sync
async function setAuth(page, role, { onboardingCompleted = true, isVerified = true } = {}) {
  const user = { id: 1, email: `${role.toLowerCase()}@test.com`, role, onboardingCompleted };
  const company = { id: 1, name: "Test Corp", isVerified };

  await page.route("**/api/prefs/version", r => r.fulfill({ json: {} }));
  await page.route("**/api/settings", r => r.fulfill({
    json: { logoUrl: null, primaryColor: null, aiEnabled: true },
  }));
  await page.route("**/api/auth/me", r => r.fulfill({ json: { user, company } }));
  await page.route("**/api/**", r => r.fulfill({ json: [] }));

  await page.evaluate(([u, c]) => {
    localStorage.setItem("token", "mock-token");
    localStorage.setItem("user", JSON.stringify(u));
    localStorage.setItem("company", JSON.stringify(c));
  }, [user, company]);
}

test.describe("Route guards", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
    });
  });

  test("unauthenticated access to /tracker redirects to /", async ({ page }) => {
    await page.route("**/api/prefs/version", r => r.fulfill({ json: {} }));
    await page.goto("/tracker");
    await expect(page).toHaveURL("/", { timeout: 5_000 });
  });

  test("unauthenticated access to /vault redirects to /login", async ({ page }) => {
    await page.route("**/api/prefs/version", r => r.fulfill({ json: {} }));
    await page.goto("/vault");
    await expect(page).toHaveURL("/login", { timeout: 5_000 });
  });

  test("VIEWER role at /tracker is redirected to /review", async ({ page }) => {
    await setAuth(page, "VIEWER");
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/review/, { timeout: 5_000 });
  });

  test("AUDITOR role at /tracker is redirected to /dashboard", async ({ page }) => {
    await setAuth(page, "AUDITOR");
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5_000 });
  });

  test("SUPERADMIN at /tracker is redirected to /superadmin", async ({ page }) => {
    await setAuth(page, "SUPERADMIN");
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/superadmin/, { timeout: 5_000 });
  });

  test("unverified ADMIN at /tracker is redirected to /self-assess", async ({ page }) => {
    await setAuth(page, "ADMIN", { isVerified: false, onboardingCompleted: true });
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/self-assess/, { timeout: 5_000 });
  });

  test("ADMIN with completed onboarding reaches /tracker", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/tracker/, { timeout: 5_000 });
  });
});
