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

  // AdminLayout fetches /api/admin/auth/me before rendering children, so the
  // login form only appears after that check resolves. Wait for the input
  // explicitly rather than relying on networkidle (which can fire while the
  // layout is still in its undefined/loading state).
  const emailInput = page.locator('input[type="email"]');
  try {
    await emailInput.waitFor({ timeout: 10_000 });
  } catch {
    return false;
  }

  await emailInput.fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  try {
    await page.waitForURL("/admin/trips", { timeout: 10_000 });
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
  await page.goto("/admin/trips");
  await page.getByRole("heading", { name: "Trips" }).waitFor();
  // Wait for the client-side trip list to finish loading before looking for the button
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );

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

test("admin revenue page", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  const ok = await adminLogin(page);
  if (!ok) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin/revenue");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );
  await page.screenshot({ path: shot("14-admin-revenue") });

  await expect(page.getByRole("heading", { name: "Revenue" })).toBeVisible();
  // Summary cards — verify the three range buttons render (unambiguous text)
  await expect(page.getByRole("button", { name: "Last 30 days" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Last 90 days" })).toBeVisible();
});

test("admin manifest — passenger list and refund button", async ({ page }, testInfo) => {
  // Requires: seed-test-customers.ts run against today's trip for the refund button to appear.
  // The test passes either way — it screenshots whatever state the manifest is in.
  const shot = screenshotter(testInfo);

  const ok = await adminLogin(page);
  if (!ok) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin/trips");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );

  const manifestLinks = page.getByRole("link", { name: "Manifest" });
  if ((await manifestLinks.count()) === 0) {
    test.skip(true, "No trips in the list. Run seed-test-trip.ts first.");
    return;
  }

  await Promise.all([
    page.waitForURL(/\/admin\/trips\/.+/),
    manifestLinks.first().click(),
  ]);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );
  await page.screenshot({ path: shot("15-admin-manifest") });

  // Either "No bookings" or at least one booking card should be present
  const noBookings = page.getByText("No bookings for this trip");
  const bookingCard = page.locator(".bg-white.rounded-xl.border").first();
  await expect(noBookings.or(bookingCard).first()).toBeVisible();
});

test("admin capacity inline edit", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  const ok = await adminLogin(page);
  if (!ok) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin/trips");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );

  const manifestLinks = page.getByRole("link", { name: "Manifest" });
  if ((await manifestLinks.count()) === 0) {
    test.skip(true, "No trips in the list. Run seed-test-trip.ts first.");
    return;
  }

  await Promise.all([
    page.waitForURL(/\/admin\/trips\/.+/),
    manifestLinks.first().click(),
  ]);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );

  const editBtn = page.getByRole("button", { name: /Edit capacity/ });
  if (!(await editBtn.isVisible().catch(() => false))) {
    test.skip(true, "Trip is cancelled — no capacity edit button visible.");
    return;
  }

  await editBtn.click();
  // Inline input and Save button should appear
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  await page.screenshot({ path: shot("16-admin-capacity-edit") });

  // Dismiss without saving
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: /Edit capacity/ })).toBeVisible();
});

test("admin fishing report form — sailed trip", async ({ page }, testInfo) => {
  // Only runs if a trip with status=sailed or pending_settlement exists.
  // The fishing report section is gated by trip.status in the UI.
  const shot = screenshotter(testInfo);

  const ok = await adminLogin(page);
  if (!ok) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin/trips");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading…"),
    { timeout: 10_000 },
  );

  const manifestLinks = page.getByRole("link", { name: "Manifest" });
  const totalLinks = await manifestLinks.count();
  if (totalLinks === 0) {
    test.skip(true, "No trips. Run seed-test-trip.ts first.");
    return;
  }

  // Check up to 5 trips for a sailed one — beyond that, skip rather than timeout.
  const maxCheck = Math.min(totalLinks, 5);
  for (let i = 0; i < maxCheck; i++) {
    await page.goto("/admin/trips");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(
      () => !document.body.innerText.includes("Loading…"),
      { timeout: 10_000 },
    );

    const links = page.getByRole("link", { name: "Manifest" });
    await Promise.all([
      page.waitForURL(/\/admin\/trips\/.+/),
      links.nth(i).click(),
    ]);
    // networkidle waits for both the trip fetch and the follow-up report fetch
    await page.waitForLoadState("networkidle");

    const reportTextarea = page.getByPlaceholder("Describe today's catch…");
    if (await reportTextarea.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await page.screenshot({ path: shot("17-admin-report-form") });
      await expect(reportTextarea).toBeVisible();
      await expect(page.getByRole("button", { name: /Post Report|Update Report/ })).toBeVisible();
      return;
    }
  }

  test.skip(true, "No sailed trips found in first 5. Manually set a trip status to 'sailed' to test this.");
});
