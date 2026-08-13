import { chromium } from "@playwright/test";

export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Pre-warm Vite's module cache so tests don't pay the cold-compilation cost.
    // App.jsx eagerly imports all pages, so one root navigation compiles everything.
    await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 30_000 });
  } catch {
    // Non-fatal — tests proceed normally, just with a slower first navigation
  } finally {
    await browser.close();
  }
}
