import { test, expect, type TestInfo } from "@playwright/test";
import path from "path";
import fs from "fs";

// Default credentials created by: DATABASE_URL=... pnpm --filter @openboat/db seed:admin
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "changeme";

function screenshotter(testInfo: TestInfo) {
  const dir = path.join("screenshots", testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  return (name: string) => path.join(dir, `${name}.png`);
}

async function adminLogin(page: Parameters<Parameters<typeof test>[1]>[0]) {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");

  const emailInput = page.locator('input[type="email"]');
  if (!(await emailInput.isVisible().catch(() => false))) return false;

  await emailInput.fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();

  try {
    await page.waitForURL("/admin/trips", { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test("admin login → trips list", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  const ok = await adminLogin(page);
  if (!ok) {
    test.skip(true, "Admin user not seeded or server not running. Run seed:admin first.");
    return;
  }

  // ── Trips list renders ─────────────────────────────────────────────────────
  await page.waitForSelector("h1:has-text('Trips')", { timeout: 8_000 });
  // Wait for loading spinner to disappear
  await page.waitForFunction(
    () => !document.querySelector("div.text-center.text-gray-400.py-16:not(:has(text))"),
    { timeout: 8_000 },
  );
  await page.screenshot({ path: shot("10-admin-trips-list") });

  // At least one trip or "No upcoming trips" message renders — either is valid
  const hasTrips = await page.locator('a:has-text("Manifest")').count();
  const isEmpty = await page.locator('text=No upcoming trips').count();
  expect(hasTrips + isEmpty).toBeGreaterThan(0);
});

test("admin trip detail + cancel dialog", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  const ok = await adminLogin(page);
  if (!ok) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  // Wait for client-side data to finish loading (spinner disappears)
  await page.waitForSelector("h1:has-text('Trips')");
  await page.waitForFunction(
    () => !document.querySelector(".text-center.text-gray-400.py-16"),
    { timeout: 10_000 },
  );

  // Skip if no trips are listed after loading
  const manifestLinks = page.locator('a:has-text("Manifest")');
  if ((await manifestLinks.count()) === 0) {
    test.skip(true, "No trips in the list. Run seed-test-trip.ts first.");
    return;
  }

  // ── Navigate to first trip manifest ───────────────────────────────────────
  await Promise.all([
    page.waitForURL(/\/admin\/trips\/.+/),
    manifestLinks.first().click(),
  ]);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("11-admin-trip-detail") });

  // Trip detail page shows vessel name or departure info
  const heading = page.locator("h1, h2").first();
  await expect(heading).toBeVisible();

  // ── Cancel trip dialog (open + dismiss without submitting) ────────────────
  await Promise.all([
    page.waitForURL("/admin/trips"),
    page.goto("/admin/trips"),
  ]);
  await page.waitForSelector("h1:has-text('Trips')");

  const cancelBtn = page.locator('button:has-text("Cancel trip")').first();
  if (!(await cancelBtn.isVisible().catch(() => false))) return; // all trips already cancelled

  await cancelBtn.click();
  // Modal should appear with a reason input
  await page.waitForSelector('textarea, input[placeholder*="reason" i]', { timeout: 5_000 });
  await page.screenshot({ path: shot("12-cancel-trip-dialog") });

  // Dismiss by pressing Escape or clicking away — don't submit
  await page.keyboard.press("Escape");
});

test("public fishing reports page renders", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  await page.goto("/fishing-reports");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("13-fishing-reports-list") });

  // Page always renders the heading — even with zero reports
  await expect(page.locator("h1, h2").first()).toBeVisible();
  // Should not be a Next.js error page
  await expect(page.locator("body")).not.toContainText("Application error");
});
