import { test, type TestInfo } from "@playwright/test";
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
  // Wait for JS hydration to complete so the view-mode switch settles
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("01-calendar") });

  // On desktop, hydration flips to calendar mode (md breakpoint useEffect).
  // Click the "list" toggle to bring trip rows back into the DOM.
  const listToggle = page.locator("button").filter({ hasText: /^list$/ }).first();
  if (await listToggle.isVisible().catch(() => false)) {
    await listToggle.click();
  }

  // Wait for at least one trip row (identified by its teal category label)
  await page.waitForSelector("button:not([disabled]):has(.text-teal)", {
    timeout: 10_000,
  });

  // ── 02  Trip detail sheet ──────────────────────────────────────────────────
  // Click the first enabled trip row
  await page.locator("button:not([disabled]):has(.text-teal)").first().click();
  // Sheet overlay — wait for the stepper + button (present on both mobile and desktop)
  await page.waitForSelector("button:text('+')"); // ✕ is hidden on mobile (md:flex)
  await page.screenshot({ path: shot("02-trip-sheet") });

  // ── 03  Select 2 adult tickets ────────────────────────────────────────────
  // Two steppers in the sheet: adult first, child second. First + is adult.
  await page.locator("button:text('+')").first().click();
  await page.locator("button:text('+')").first().click();
  await page.screenshot({ path: shot("03-qty-selected") });

  // ── 04  Add to cart ────────────────────────────────────────────────────────
  await page.locator("button:text('Add to cart')").click();
  // Sheet closes; mobile CartBar or desktop SidebarCartFooter shows "Reserve".
  // waitForSelector picks the first DOM match which may be CSS-hidden on one viewport,
  // so use waitForFunction to check any visible Reserve button.
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")]
      .some((b) => b.textContent?.trim().startsWith("Reserve") && b.checkVisibility())
  );
  await page.screenshot({ path: shot("04-cart-bar") });

  // ── 05  Cart page ──────────────────────────────────────────────────────────
  // "Reserve" calls window.location.href = "/cart" — waitForURL handles navigation.
  // CartBar is last in DOM (after DesktopSidebar); SidebarCartFooter is first but CSS-hidden on mobile.
  // Use filter to click the visible one.
  const reserveBtn = page.locator("button:text('Reserve')");
  const visibleReserve = (await reserveBtn.first().isVisible()) ? reserveBtn.first() : reserveBtn.last();
  await Promise.all([page.waitForURL("/cart"), visibleReserve.click()]);
  await page.waitForSelector("text=Your cart");
  await page.screenshot({ path: shot("05-cart") });

  // ── 06  Contact overlay (opens when user clicks Checkout) ─────────────────
  await page.locator("button:text('Checkout')").first().click();
  await page.waitForSelector('input[placeholder="Jane Smith"]');
  await page.fill('input[placeholder="Jane Smith"]', "Alex Johnson");
  await page.fill('input[placeholder="jane@example.com"]', "alex@example.com");
  await page.fill('input[placeholder="(555) 000-0000"]', "(555) 123-4567");
  await page.screenshot({ path: shot("06-contact-form") });

  // ── 07  Checkout page (Stripe Payment Element) ────────────────────────────
  // "Continue to payment" submits the form and sets window.location.href = "/checkout"
  await Promise.all([
    page.waitForURL("/checkout"),
    page.locator("button:text('Continue to payment')").click(),
  ]);
  // Give Stripe's iframe time to mount before screenshotting
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: shot("07-checkout") });
});

test("post-payment screens", async ({ page }, testInfo) => {
  const { code, bookingId } = loadFixtures();

  if (!code || !bookingId) {
    test.skip(
      true,
      "Seed booking not found. Run seed-test-customers.ts first, then re-run."
    );
    return;
  }

  const shot = screenshotter(testInfo);

  // ── 08  Delivery / ticket delivery screen ─────────────────────────────────
  // The delivery page requires redirect_status=succeeded to render (otherwise
  // it redirects to the confirmation page).
  await page.goto(
    `/booking/delivery?code=${code}&redirect_status=succeeded`
  );
  await page.waitForSelector("text=You're booked!");
  await page.screenshot({ path: shot("08-delivery") });

  // ── 09  Boarding pass (printable) ─────────────────────────────────────────
  await page.goto(`/boarding/${bookingId}`);
  // Wait for the first ticket block to render
  await page.waitForSelector(".ticket-page");
  await page.screenshot({ path: shot("09-boarding-pass"), fullPage: true });
});
