import { test, expect, type TestInfo, type Page, type BrowserContext } from "@playwright/test";
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

// Admin login is rate limited (10 per 15 minutes per IP), so each worker signs
// in once through the form and the remaining tests reuse that session cookie.
let sessionCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | null = null;

async function signInThroughForm(page: Page): Promise<boolean> {
  await page.goto("/admin/login");
  // AdminLayout checks /api/admin/auth/me before rendering the form, so wait
  // for the field rather than for network idle.
  const email = page.getByLabel("Email");
  try {
    await email.waitFor({ timeout: 10_000 });
  } catch {
    return false;
  }
  await email.fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  try {
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10_000 });
  } catch {
    return false;
  }
  sessionCookies = await page.context().cookies();
  return true;
}

async function adminSession(page: Page): Promise<boolean> {
  if (sessionCookies) {
    await page.context().addCookies(sessionCookies);
    return true;
  }
  return signInThroughForm(page);
}

/** Waits for the screen's own loading lines to clear. */
async function settled(page: Page) {
  await page.waitForFunction(() => !document.body.innerText.includes("Loading"), null, { timeout: 15_000 });
}

test("admin sign in → Today", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);
  const ok = await signInThroughForm(page);
  if (!ok) {
    test.skip(true, "Admin user not seeded or server not running. Run seed:admin first.");
    return;
  }

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today’s departures" })).toBeVisible();
  await settled(page);
  await page.screenshot({ path: shot("10-admin-today") });

  // Either today's trips or the empty state.
  const trips = page.getByRole("button", { name: /Who’s coming|^List/ });
  const empty = page.getByText("Nothing is going out today.");
  await expect(trips.or(empty).first()).toBeVisible();
});

test("calendar → cancel dialog needs a reason", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);
  if (!(await adminSession(page))) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin/calendar");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const cancel = page.getByRole("button", { name: /^Cancel( trip)?$|^Cancel, / }).first();
  if (!(await cancel.isVisible().catch(() => false))) {
    test.skip(true, "No trips on today's calendar day. Run seed-test-trip.ts first.");
    return;
  }

  await cancel.click();
  const dialog = page.getByRole("dialog", { name: "Cancel trip" });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: /^Cancel and refund/ });
  // Nothing is pre-selected; a reason has to be picked on purpose.
  await expect(confirm).toBeDisabled();
  // The radio input is visually hidden behind its big label; click the label as a user would.
  await dialog.getByText("Other", { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Other" })).toBeChecked();
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: shot("11-admin-cancel-dialog") });

  // Dismiss without submitting.
  await dialog.getByRole("button", { name: "Keep the trip" }).click();
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

test("admin money page", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);
  if (!(await adminSession(page))) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin/money");
  await settled(page);
  await page.screenshot({ path: shot("14-admin-money") });

  await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();
  const period = page.getByRole("radiogroup", { name: "Period" });
  for (const label of ["30 days", "90 days", "12 months"]) {
    await expect(period.getByRole("radio", { name: label })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Trip by trip" })).toBeVisible();
});

test("passenger list from Today", async ({ page }, testInfo) => {
  // Requires seed-test-trip.ts (+ seed-test-customers.ts for bookings). Passes
  // either way: it checks whichever state the list is in.
  const shot = screenshotter(testInfo);
  if (!(await adminSession(page))) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin");
  await settled(page);
  const open = page.getByRole("button", { name: /Who’s coming|^List/ }).first();
  if (!(await open.isVisible().catch(() => false))) {
    test.skip(true, "No trips today. Run seed-test-trip.ts first.");
    return;
  }

  await Promise.all([page.waitForURL(/\/admin\/trips\/.+\/passengers/), open.click()]);
  await settled(page);
  await page.screenshot({ path: shot("15-admin-passengers") });

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Show" })).toBeVisible();
  const nobody = page.getByText("Nobody has booked this trip yet.");
  const booking = page.getByRole("listitem").first();
  const table = page.getByRole("columnheader", { name: "Who" });
  await expect(nobody.or(booking).or(table).first()).toBeVisible();
});

test("seats dialog opens and closes", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);
  if (!(await adminSession(page))) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin");
  await settled(page);
  const seats = page.getByRole("button", { name: /^Seats/ }).first();
  if (!(await seats.isVisible().catch(() => false))) {
    test.skip(true, "No trips today. Run seed-test-trip.ts first.");
    return;
  }

  await seats.click();
  const dialog = page.getByRole("dialog", { name: "Seats on this trip" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Seats", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();
  await page.screenshot({ path: shot("16-admin-seats-dialog") });

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
});

test("report dialog — trip waiting on a report", async ({ page }, testInfo) => {
  // Needs a sailed trip without a report in the last 5 days (seed-sailed-trip.ts).
  const shot = screenshotter(testInfo);
  if (!(await adminSession(page))) {
    test.skip(true, "Admin user not seeded or server not running.");
    return;
  }

  await page.goto("/admin/reports");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();

  const post = page.getByRole("button", { name: "Post the report" }).first();
  if (!(await post.isVisible().catch(() => false))) {
    test.skip(true, "No trips waiting on a report. Run seed-sailed-trip.ts to test this.");
    return;
  }

  await post.click();
  const dialog = page.getByRole("dialog", { name: "Post the report" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder("How the day went, conditions, where they were biting…")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Post it" })).toBeVisible();
  await page.screenshot({ path: shot("17-admin-report-dialog") });

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
