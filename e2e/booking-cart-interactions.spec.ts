import { test, expect, type TestInfo } from "@playwright/test";
import path from "path";
import fs from "fs";

// Interactive coverage for the BookingCalendar refactor: everything that curl
// smoke tests can't reach — useCart's adjust/remove, localStorage round-trip,
// subtotal math, and cart survival across month navigation.
//
// Seed-independent: it books the first trip on the 15th of next month (every
// month of the demo seed has weekday trips; see booking-flow.spec.ts) and reads
// the seat price off the page instead of assuming one.

function screenshotter(testInfo: TestInfo) {
  const dir = path.join("screenshots", testInfo.project.name, "cart-interactions");
  fs.mkdirSync(dir, { recursive: true });
  return (name: string) => path.join(dir, `${name}.png`);
}

const target = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15));
})();

function monthLabel(d: Date, offset = 0): string {
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return m.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

function dollars(text: string): number {
  const m = text.match(/\$(\d+)/);
  if (!m) throw new Error(`No dollar amount in "${text}"`);
  return Number(m[1]);
}

// Only desktop: the mobile viewport renders a different top-level layout
// (MobilePanelCalendar + MobileCartBar). Run with --project=desktop.
test.describe("booking cart interactions", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "desktop-only spec");
  });

  const bookUrl = `/book?date=${target.toISOString().slice(0, 10)}`;

  test.beforeEach(async ({ page }) => {
    // Avoid cross-test leakage from the previous run's cart.
    await page.goto(bookUrl);
    await page.evaluate(() => localStorage.removeItem("openboat_cart"));
    await page.reload();
  });

  test("add → increment → persist across reload → remove", async ({ page }, testInfo) => {
    const shot = screenshotter(testInfo);
    const rail = page.locator(".booking-rail");

    // The first ticket row's steppers, whatever its ticket type is called.
    const addSeat = page.getByRole("button", { name: /^One more .*seat$/ }).first();
    const removeSeat = page.getByRole("button", { name: /^One fewer .*seat$/ }).first();

    await expect(addSeat).toBeVisible();
    await page.screenshot({ path: shot("01-initial") });

    // Add one seat. Checkout CTA (always rendered) should now show the price.
    await addSeat.click();
    const checkoutBtn = page.getByRole("button", { name: /^Check out/i });
    await expect(checkoutBtn).toContainText("$");
    const price = dollars(await checkoutBtn.innerText());
    expect(price).toBeGreaterThan(0);
    // Ticket-line text proves cartItems reflects the add.
    await expect(rail.getByText(/^1\s*×/)).toBeVisible();
    await page.screenshot({ path: shot("02-after-add-1") });

    // Add a second seat. Subtotal must double, ticket line must increment.
    await addSeat.click();
    await expect(checkoutBtn).toContainText(`$${price * 2}`);
    await expect(rail.getByText(/^2\s*×/)).toBeVisible();
    await page.screenshot({ path: shot("03-after-add-2") });

    // localStorage carries the cart.
    const stored = await page.evaluate(() => localStorage.getItem("openboat_cart"));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tickets[0].quantity).toBe(2);

    // Reload — cart must survive.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText(`$${price * 2}`);
    await page.screenshot({ path: shot("04-after-reload") });

    // Decrement once; back to one seat.
    await removeSeat.click();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText(`$${price}`);

    // Remove button clears the item entirely. Pressed from the keyboard: at
    // 1280x800 the rail's sticky calendar and total shelf leave ~100px for the
    // cart list, so a pointer click only lands within a narrow scroll range.
    // This spec covers the cart logic, not that layout.
    const removeFromCart = page.getByRole("button", { name: /^Remove .* from cart$/ }).first();
    await expect(removeFromCart).toBeVisible();
    await removeFromCart.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("No seats yet.")).toBeVisible();

    // localStorage must be cleared.
    const after = await page.evaluate(() => localStorage.getItem("openboat_cart"));
    expect(after).toBeNull();
    await page.screenshot({ path: shot("05-after-remove") });
  });

  test("cart survives month navigation", async ({ page }, testInfo) => {
    const shot = screenshotter(testInfo);

    const addSeat = page.getByRole("button", { name: /^One more .*seat$/ }).first();
    await addSeat.click();
    const checkoutBtn = page.getByRole("button", { name: /^Check out/i });
    await expect(checkoutBtn).toContainText("$");
    const total = `$${dollars(await checkoutBtn.innerText())}`;

    // Scope month-nav assertions to the rail calendar, which is the only
    // visible calendar at desktop width (the mobile panel is lg:hidden but
    // still in the DOM and would silently absorb clicks).
    const rail = page.locator(".booking-rail");
    await expect(rail.getByText(monthLabel(target))).toBeVisible();

    // useCart stores priceCents independently of the current month's trip
    // list, so the total must stay correct even when the trip row is no
    // longer in the DOM.
    await rail.getByRole("button", { name: "Next month" }).click();
    await expect(rail.getByText(monthLabel(target, 1))).toBeVisible();
    await expect(checkoutBtn).toContainText(total);
    await page.screenshot({ path: shot("06-after-month-next") });

    await rail.getByRole("button", { name: "Previous month" }).click();
    await expect(rail.getByText(monthLabel(target))).toBeVisible();
    await expect(checkoutBtn).toContainText(total);
  });
});
