import { test, expect, type TestInfo } from "@playwright/test";
import path from "path";
import fs from "fs";

// Interactive coverage for the BookingCalendar refactor: everything that curl
// smoke tests can't reach — useCart's adjust/remove, localStorage round-trip,
// subtotal math, and cart survival across month navigation. Targets Oct 2026
// where the dev seed has stable trips (adult/child, equal price → collapsed
// "seat" row).

function screenshotter(testInfo: TestInfo) {
  const dir = path.join("screenshots", testInfo.project.name, "cart-interactions");
  fs.mkdirSync(dir, { recursive: true });
  return (name: string) => path.join(dir, `${name}.png`);
}

// Only desktop: the mobile viewport renders a different top-level layout
// (MobilePanelCalendar + MobileCartBar). Run with --project=desktop.
test.describe("booking cart interactions", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "desktop-only spec");
  });

  const bookUrl = "/book?date=2026-10-10";

  test.beforeEach(async ({ page }) => {
    // Avoid cross-test leakage from the previous run's cart.
    await page.goto(bookUrl);
    await page.evaluate(() => localStorage.removeItem("openboat_cart"));
    await page.reload();
  });

  test("add → increment → persist across reload → remove", async ({ page }, testInfo) => {
    const shot = screenshotter(testInfo);

    const addSeat = page.getByRole("button", { name: "One more seat seat" }).first();
    const removeSeat = page.getByRole("button", { name: "One fewer seat seat" }).first();

    await expect(addSeat).toBeVisible();
    await page.screenshot({ path: shot("01-initial") });

    // Add one seat. Checkout CTA (always rendered) should now show the price.
    await addSeat.click();
    const checkoutBtn = page.getByRole("button", { name: /^Check out/i });
    await expect(checkoutBtn).toContainText("$475");
    // Unique ticket-line text proves cartItems reflects the add.
    await expect(page.getByText(/1\s*×\s*Seat/)).toBeVisible();
    await page.screenshot({ path: shot("02-after-add-1") });

    // Add a second seat. Subtotal must double, ticket line must increment.
    await addSeat.click();
    await expect(checkoutBtn).toContainText("$950");
    await expect(page.getByText(/2\s*×\s*Seat/)).toBeVisible();
    await page.screenshot({ path: shot("03-after-add-2") });

    // localStorage carries the cart.
    const stored = await page.evaluate(() => localStorage.getItem("openboat_cart"));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tickets[0].quantity).toBe(2);

    // Reload — cart must survive.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText("$950");
    await page.screenshot({ path: shot("04-after-reload") });

    // Decrement once; back to $475.
    await removeSeat.click();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText("$475");

    // Remove button clears the item entirely.
    const removeFromCart = page.getByRole("button", { name: /^Remove .* from cart$/ }).first();
    await expect(removeFromCart).toBeVisible();
    await removeFromCart.click();
    await expect(page.getByText("No seats yet.")).toBeVisible();

    // localStorage must be cleared.
    const after = await page.evaluate(() => localStorage.getItem("openboat_cart"));
    expect(after).toBeNull();
    await page.screenshot({ path: shot("05-after-remove") });
  });

  test("cart survives month navigation", async ({ page }, testInfo) => {
    const shot = screenshotter(testInfo);

    const addSeat = page.getByRole("button", { name: "One more seat seat" }).first();
    await addSeat.click();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText("$475");

    // Scope month-nav assertions to the rail calendar, which is the only
    // visible calendar at desktop width (the mobile panel is lg:hidden but
    // still in the DOM and would silently absorb clicks).
    const rail = page.locator(".booking-rail");
    await expect(rail.getByText("OCTOBER 2026")).toBeVisible();

    // useCart stores priceCents independently of the current month's trip
    // list, so the total must stay correct even when the trip row is no
    // longer in the DOM.
    await rail.getByRole("button", { name: "Next month" }).click();
    await expect(rail.getByText("NOVEMBER 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText("$475");
    await page.screenshot({ path: shot("06-after-month-next") });

    await rail.getByRole("button", { name: "Previous month" }).click();
    await expect(rail.getByText("OCTOBER 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Check out/i })).toContainText("$475");
  });
});
