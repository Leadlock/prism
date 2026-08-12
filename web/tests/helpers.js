export const CONSENT = JSON.stringify({
  action: "accepted_all",
  choices: { strictly_necessary: true, functional: true, analytics: true, marketing: true },
  version: "1.0",
  timestamp: 1000000000000,
});

/**
 * Seeds localStorage before React initialises and registers ambient API mocks.
 * Register test-specific route overrides AFTER calling setAuth so they take
 * LIFO priority over the catch-all **/api/** handler registered here.
 */
export async function setAuth(page, role, { onboardingCompleted = true, isVerified = true } = {}) {
  const user = { id: 1, email: `${role.toLowerCase()}@test.com`, role, onboardingCompleted };
  const company = { id: 1, name: "Test Corp", isVerified };

  await page.route("**/api/prefs/version", r => r.fulfill({ json: { version: "1.0" } }));
  await page.route("**/api/settings", r =>
    r.fulfill({ json: { logoUrl: null, primaryColor: null, aiEnabled: true } })
  );
  await page.route("**/api/auth/me", r => r.fulfill({ json: { user, company } }));
  await page.route("**/api/**", r => r.fulfill({ json: [] }));

  await page.addInitScript(({ u, c, consent }) => {
    localStorage.setItem("token", "mock-token");
    localStorage.setItem("user", JSON.stringify(u));
    localStorage.setItem("company", JSON.stringify(c));
    localStorage.setItem("cookie_consent", consent);
  }, { u: user, c: company, consent: CONSENT });
}

/** Pre-seeds cookie_consent so the banner never shows on any navigation. */
export async function addConsent(page) {
  await page.addInitScript(c => { localStorage.setItem("cookie_consent", c); }, CONSENT);
}
