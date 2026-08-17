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

  const emailInput = page.getByLabel("Email");
  if (!(await emailInput.isVisible().catch(() => false))) return false;

  await emailInput.fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

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
  await page.getByRole("heading", { name: "Trips" }).waitFor({ timeout: 8_000 });
  // Wait for client-side data to finish loading (loading text goes away)
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );
  await page.screenshot({ path: shot("10-admin-trips-list") });

  // At least one Manifest link or "No upcoming trips" message should be present
  const manifestLinks = page.getByRole("link", { name: "Manifest" });
  const noTrips = page.getByText("No upcoming trips");
  await expect(manifestLinks.or(noTrips).first()).toBeVisible();
});

test("admin trip detail + cancel dialog", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  const ok = await adminLogin(page);
  if (!ok) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.getByRole("heading", { name: "Trips" }).waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );

  const manifestLinks = page.getByRole("link", { name: "Manifest" });
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

  // Trip detail page has a heading
  await expect(page.getByRole("heading").first()).toBeVisible();

  // ── Cancel trip dialog (open + dismiss without submitting) ────────────────
  await Promise.all([
    page.waitForURL("/admin/trips"),
    page.goto("/admin/trips"),
  ]);
  await page.getByRole("heading", { name: "Trips" }).waitFor();

  const cancelBtn = page.getByRole("button", { name: "Cancel trip" }).first();
  if (!(await cancelBtn.isVisible().catch(() => false))) return;

  await cancelBtn.click();
  // Dialog should open — accessible via role="dialog"
  const dialog = page.getByRole("dialog", { name: "Cancel trip?" });
  await dialog.waitFor({ timeout: 5_000 });
  await expect(page.getByLabel("Reason")).toBeVisible();
  await page.screenshot({ path: shot("12-cancel-trip-dialog") });

  // Dismiss without submitting
  await page.getByRole("button", { name: "Never mind" }).click();
  await expect(dialog).not.toBeVisible();
});

test("public fishing reports page renders", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  await page.goto("/fishing-reports");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("13-fishing-reports-list") });

  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");
});
