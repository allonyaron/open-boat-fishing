import { test, expect, type TestInfo } from "@playwright/test";
import path from "path";
import fs from "fs";
import { bookableDate } from "./book-dates";

// Interactive coverage for the BookingCalendar refactor: everything that curl
// smoke tests can't reach — the cart store's adjust/remove, its localStorage
// round-trip, the server-quoted total, and cart survival across month
// navigation.
//
// Seed-independent: it books the first trip on a day from the 15th of next
// month on (?date= opens that day's panel) and reads the seat price off the
// page instead of assuming one.

function screenshotter(testInfo: TestInfo) {
  const dir = path.join("screenshots", testInfo.project.name, "cart-interactions");
  fs.mkdirSync(dir, { recursive: true });
  return (name: string) => path.join(dir, `${name}.png`);
}

let target: Date;

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

  test.beforeEach(async ({ page }) => {
    const date = await bookableDate(page.request);
    target = new Date(`${date}T12:00:00Z`);
    // Avoid cross-test leakage from the previous run's cart.
    await page.goto(`/book?date=${date}`);
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

    // localStorage carries the cart: one trip, two seats.
    const stored = await page.evaluate(() => localStorage.getItem("openboat_cart"));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.lines).toHaveLength(1);
    expect(Object.values(parsed.lines[0].quantities)).toEqual([2]);

    // Reload — cart must survive.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText(`$${price * 2}`);
    await page.screenshot({ path: shot("04-after-reload") });

    // Decrement once; back to one seat.
    await removeSeat.click();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText(`$${price}`);

    // Remove button clears the item entirely, and takes a real pointer click.
    const removeFromCart = page.getByRole("button", { name: /^Remove .* from cart$/ }).first();
    await expect(removeFromCart).toBeVisible();
    await removeFromCart.click();
    await expect(page.getByText("No seats yet.")).toBeVisible();
    // With the cart empty, focus falls back to the rail's heading.
    await expect(rail.getByText(/^YOUR SEATS/)).toBeFocused();

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

    // Scope month-nav assertions to the desktop calendar in the main column
    // (the mobile month card is lg:hidden but still in the DOM).
    const cal = page.locator(".booking-main");
    await expect(cal.getByRole("heading", { name: monthLabel(target) })).toBeVisible();

    // The cart keeps its trip snapshots and the total comes from the server
    // quote, so the total stays correct when the trip row is no longer in
    // the DOM.
    await cal.getByRole("button", { name: "Next month" }).click();
    await expect(cal.getByRole("heading", { name: monthLabel(target, 1) })).toBeVisible();
    await expect(checkoutBtn).toContainText(total);
    // Paging the month closes the day panel.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: shot("06-after-month-next") });

    await cal.getByRole("button", { name: "Previous month" }).click();
    await expect(cal.getByRole("heading", { name: monthLabel(target) })).toBeVisible();
    await expect(checkoutBtn).toContainText(total);
  });
});
