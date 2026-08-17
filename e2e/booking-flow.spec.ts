import { test, expect, type TestInfo } from "@playwright/test";
import path from "path";
import fs from "fs";
import { FIXTURE_PATH } from "./global-setup";

type Fixtures = { code: string | null; bookingId: string | null };

function screenshotter(testInfo: TestInfo) {
  const dir = path.join("screenshots", testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  return (name: string) => path.join(dir, `${name}.png`);
}

function loadFixtures(): Fixtures {
  try {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as Fixtures;
  } catch {
    return { code: null, bookingId: null };
  }
}

test("booking flow", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  // ── 01  Calendar / list view ───────────────────────────────────────────────
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("01-calendar") });

  // On desktop, hydration flips to calendar view. Switch to list so trip rows
  // are in the DOM on both viewports.
  const listBtn = page.getByRole("button", { name: "list" });
  if (await listBtn.isVisible().catch(() => false)) {
    await listBtn.click();
  }

  // Wait for at least one enabled trip row button to appear
  const tripRow = page.getByRole("button", { disabled: false }).filter({
    hasText: /AM|PM/,
  });
  await tripRow.first().waitFor({ timeout: 10_000 });

  // ── 02  Trip detail sheet ──────────────────────────────────────────────────
  await tripRow.first().click();
  // Sheet opens — wait for the ticket quantity stepper to appear
  await page.getByRole("button", { name: /Increase adult count/i }).waitFor({ timeout: 8_000 });
  await page.screenshot({ path: shot("02-trip-sheet") });

  // ── 03  Select adult tickets (1 or 2 depending on availability) ──────────
  const increaseAdult = page.getByRole("button", { name: /Increase adult count/i });
  await increaseAdult.click();
  // Click again only if the trip has more than 1 seat
  if (await increaseAdult.isEnabled().catch(() => false)) {
    await increaseAdult.click();
  }
  await page.screenshot({ path: shot("03-qty-selected") });

  // ── 04  Add to cart ────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Add to cart" }).click();
  // Either the mobile CartBar or the desktop sidebar "Checkout" button becomes visible
  await page.getByRole("button", { name: /Checkout/i }).first().waitFor({ timeout: 8_000 });
  await page.screenshot({ path: shot("04-cart-bar") });

  // ── 05  Checkout page (cart + inline contact form) ─────────────────────────
  // CartBar "Checkout" navigates directly to /checkout — there is no separate /cart page.
  const checkoutBtn = page.getByRole("button", { name: /Checkout/i });
  // On desktop the sidebar button comes first; on mobile the CartBar comes last.
  const visibleCheckout = (await checkoutBtn.first().isVisible())
    ? checkoutBtn.first()
    : checkoutBtn.last();
  await Promise.all([page.waitForURL("/checkout"), visibleCheckout.click()]);
  await page.getByRole("heading", { name: "Checkout" }).waitFor();
  await page.screenshot({ path: shot("05-checkout-summary") });

  // ── 06  Contact form (inline on /checkout) ────────────────────────────────
  await page.getByLabel("Email").fill("alex@example.com");
  await page.getByLabel(/Mobile/i).fill("(555) 123-4567");
  await page.screenshot({ path: shot("06-contact-form") });

  // ── 07  Stripe Payment Element ────────────────────────────────────────────
  // Clicking "Continue to payment" calls /api/bookings then renders the Stripe element
  // on the same /checkout page (no navigation).
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForTimeout(5_000); // Give Stripe's iframe time to mount
  await page.screenshot({ path: shot("07-payment") });
});

test("post-payment screens", async ({ page }, testInfo) => {
  const { code, bookingId } = loadFixtures();

  if (!code || !bookingId) {
    test.skip(true, "Seed booking not found. Run seed-test-customers.ts first, then re-run.");
    return;
  }

  const shot = screenshotter(testInfo);

  // ── 08  Delivery / ticket delivery screen ─────────────────────────────────
  await page.goto(`/booking/delivery?code=${code}&redirect_status=succeeded`);
  await page.getByText("You're booked!").waitFor();
  await page.screenshot({ path: shot("08-delivery") });

  // ── 09  Boarding pass (printable) ─────────────────────────────────────────
  await page.goto(`/boarding/${bookingId}`);
  await page.locator(".ticket-page").first().waitFor();
  await page.screenshot({ path: shot("09-boarding-pass"), fullPage: true });
});
