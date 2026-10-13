import { test, expect, type Page } from "@playwright/test";
import { nextMonth, tripsFor } from "./book-dates";

// Desktop /book: the month calendar, its trip lines, the day panel and the
// fixed cart rail (design_handoff_book_calendar). Line states need trips the
// seed can't promise (8 seats left, show_remaining off, sold out, 5 in a day),
// so next month's /api/trips is answered from a fixture. Cart checks use real
// trips from the month after, which nothing intercepts.

const FIX_MONTH = nextMonth(1);
const REAL_MONTH = nextMonth(2);
const d = (day: number) => `${FIX_MONTH}-${String(day).padStart(2, "0")}`;

const VESSELS = {
  a: { name: "Fixture Alpha", color: "#2f6db5", code: null },
  b: { name: "Fixture Bravo", color: "#b8342b", code: null },
  c: { name: "Fixture Charlie", color: "#c98a12", code: null },
  z: { name: "Fixture Zulu", color: "#186a4a", code: null },
};

function trip(
  id: string,
  date: string,
  hour: number,
  vessel: keyof typeof VESSELS,
  category: string,
  seatsRemaining: number,
  showRemaining = true,
) {
  const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-05:00`);
  return {
    id,
    departureDate: date,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 4 * 3600_000).toISOString(),
    capacity: 40,
    seatsRemaining,
    vessel: VESSELS[vessel],
    product: {
      category,
      displayName: `${category} Trip`,
      showRemaining,
      prices: [
        { ticketType: "adult", priceCents: 5500 },
        { ticketType: "child", priceCents: 3500 },
      ],
    },
  };
}

// The first Saturday of the fixture month: its box is in the last column.
const firstSat = (() => {
  const dow = new Date(`${d(1)}T12:00:00Z`).getUTCDay();
  return 1 + ((6 - dow + 7) % 7);
})();

const FIXTURE = [
  // The 20th: one of each line state, four trips.
  trip("t20-open", d(20), 5, "a", "Blackfish", 30),
  trip("t20-low", d(20), 6, "b", "Fluke", 8),
  trip("t20-hidden", d(20), 7, "c", "Bluefish", 8, false),
  trip("t20-full", d(20), 12, "b", "Sea Bass", 0),
  // The 22nd: five trips, more than a 1280×800 box shows.
  ...[5, 6, 7, 12, 16].map((h, i) => trip(`t22-${i}`, d(22), h, i % 2 ? "a" : "b", "Fluke", 30)),
  // The 24th: a boat that sails no other day.
  trip("t24-z", d(24), 6, "z", "Porgy", 30),
  trip(`tsat`, d(firstSat), 6, "a", "Fluke", 30),
];

const main = (page: Page) => page.locator(".booking-main");
const rail = (page: Page) => page.locator(".booking-rail");
const box = (page: Page, date: string) => page.locator(`[data-cal-day="${date}"]`);
const boxButton = (page: Page, date: string) => page.locator(`button[data-day-hit="${date}"]`);
const dialog = (page: Page) => page.getByRole("dialog");

/** Clicks a day box's date row (its trip lines cover the middle). */
async function openBox(page: Page, date: string) {
  await boxButton(page, date).click({ position: { x: 30, y: 10 } });
}

async function gotoFixtureMonth(page: Page) {
  await page.route(`**/api/trips?month=${FIX_MONTH}`, (route) => route.fulfill({ json: FIXTURE }));
  await page.goto("/book");
  await page.evaluate(() => localStorage.removeItem("openboat_cart"));
  await main(page).getByRole("button", { name: "Next month" }).click();
  await expect(boxButton(page, d(20))).toBeVisible();
}

/** Seeds the stored cart with real trips from REAL_MONTH. */
async function seedCart(page: Page, count: number) {
  const listed = (await tripsFor(page.request, REAL_MONTH)).filter((t) => t.seatsRemaining >= 2);
  const byDay = new Map(listed.map((t) => [t.departureDate, t]));
  const picked = [...byDay.values()].slice(0, count);
  expect(picked).toHaveLength(count);
  const lines = picked.map((t) => ({ trip: t, quantities: { [t.product.prices[0].ticketType]: 2 } }));
  await page.goto("/book");
  await page.evaluate(
    (raw) => localStorage.setItem("openboat_cart", raw),
    JSON.stringify({ version: 2, savedAt: Date.now(), lines }),
  );
  await page.reload();
  await expect(rail(page).locator("[data-cart-item]")).toHaveCount(count);
  return picked;
}

test.describe("booking calendar (desktop)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "desktop-only spec");
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("trip lines show seat state; boxes fit 4 lines at 1280×800", async ({ page }) => {
    await gotoFixtureMonth(page);

    const lines = box(page, d(20)).locator(".bk-line");
    await expect(lines).toHaveCount(4);
    const [open, low, hidden, full] = [0, 1, 2, 3].map((i) => lines.nth(i));

    await expect(open).toHaveText(/^5:00ABLACKFISH$/);
    await expect(low).toHaveText(/FLUKE8$/);
    await expect(low).toHaveCSS("color", "rgb(140, 59, 18)");
    // show_remaining off: rust, but no number.
    await expect(hidden).toHaveText(/BLUEFISH$/);
    await expect(hidden).toHaveCSS("color", "rgb(140, 59, 18)");
    await expect(full).toHaveText(/FULL$/);
    await expect(full.locator(".bk-line-name")).toHaveCSS("text-decoration-line", "line-through");

    // How many lines fit follows the box height: floor((h − 34) / 16).
    const h = await box(page, d(22)).evaluate((el) => el.clientHeight);
    const fit = Math.floor((h - 34) / 16);
    const weeks = (await page.locator(".bk-cal-grid > *").count()) / 7;
    if (weeks === 5) expect(fit).toBe(4);
    const day22 = box(page, d(22)).locator(".bk-line");
    await expect(day22).toHaveCount(fit); // fit − 1 trips plus "+N MORE"
    await expect(day22.last()).toHaveText(`+${5 - (fit - 1)} MORE`);
  });

  test("box, trip line and +N MORE open the same panel; nothing is added", async ({ page }) => {
    await gotoFixtureMonth(page);

    // Box → panel, focus on close.
    await openBox(page, d(20));
    await expect(dialog(page)).toHaveCount(1);
    await expect(dialog(page)).toContainText("4 TRIPS");
    await expect(dialog(page).getByRole("button", { name: "Close" })).toBeFocused();
    await expect(boxButton(page, d(20))).toHaveAttribute("aria-expanded", "true");

    // Esc closes and focus returns to the day.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(boxButton(page, d(20))).toBeFocused();

    // Trip line → same panel, that trip outlined, its first + focused.
    await box(page, d(20)).locator(".bk-line").nth(1).click();
    const card = dialog(page).locator('[data-trip-card="t20-low"]');
    await expect(card).toHaveClass(/is-focus/);
    await expect(card.getByRole("button", { name: /^One more .*seat$/ }).first()).toBeFocused();
    await expect(rail(page).getByText("No seats yet.")).toBeVisible();

    // Another day swaps the panel; "+N MORE" opens it too.
    await box(page, d(22)).getByRole("button", { name: /MORE$/ }).click();
    await expect(dialog(page)).toHaveCount(1);
    await expect(dialog(page)).toContainText("5 TRIPS");

    // × closes.
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(boxButton(page, d(22))).toBeFocused();

    // A click outside the panel and the rail closes it; one inside the rail doesn't.
    await openBox(page, d(20));
    await rail(page).getByText("No seats yet.").click();
    await expect(dialog(page)).toHaveCount(1);
    await page.locator(".bk-cal-dow").click();
    await expect(dialog(page)).toHaveCount(0);

    // Sold out: WAITLIST, no stepper.
    await openBox(page, d(20));
    const soldOut = dialog(page).locator('[data-trip-card="t20-full"]');
    await expect(soldOut).toContainText("SOLD OUT");
    await expect(soldOut.getByRole("button", { name: "WAITLIST" })).toBeVisible();
    await expect(dialog(page).locator('[data-trip-card="t20-hidden"]')).toContainText("ALMOST FULL");
  });

  test("panel placement: never over the rail, flips left in the last column", async ({ page }) => {
    await gotoFixtureMonth(page);
    const railBox = (await rail(page).boundingBox())!;

    await openBox(page, d(firstSat));
    const panel = (await dialog(page).boundingBox())!;
    const sat = (await box(page, d(firstSat)).boundingBox())!;
    expect(panel.x + panel.width).toBeLessThanOrEqual(railBox.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(sat.x); // left of the box
    expect(panel.width).toBe(460);

    // ‹ › step through sailing days; ‹ is disabled on the first.
    await expect(dialog(page).getByRole("button", { name: "Previous sailing day" })).toBeDisabled();
    await dialog(page).getByRole("button", { name: "Next sailing day" }).click();
    await expect(dialog(page)).toContainText("4 TRIPS"); // the 20th
    await expect(boxButton(page, d(20))).toHaveAttribute("aria-expanded", "true");
    await dialog(page).getByRole("button", { name: "Previous sailing day" }).click();
    await expect(boxButton(page, d(firstSat))).toHaveAttribute("aria-expanded", "true");
  });

  test("the boat filter updates the lines and the open panel", async ({ page }) => {
    await gotoFixtureMonth(page);
    const chips = page.getByRole("group", { name: "Filter by boat" });

    await openBox(page, d(20));
    await chips.getByRole("button", { name: "FIXTURE BRAVO" }).click();
    await expect(dialog(page)).toContainText("2 TRIPS"); // still has Bravo's trips
    await expect(box(page, d(20)).locator(".bk-line")).toHaveCount(2);

    await chips.getByRole("button", { name: "FIXTURE ZULU" }).click();
    await expect(dialog(page)).toHaveCount(0); // no Zulu trip on the 20th
    await expect(boxButton(page, d(20))).toHaveCount(0);
    await expect(box(page, d(24)).locator(".bk-line")).toHaveCount(1);
  });

  test("keyboard: one tab stop, arrows move, Enter opens", async ({ page }) => {
    await gotoFixtureMonth(page);
    const tabbable = page.locator('button[data-day-hit][tabindex="0"]');
    await expect(tabbable).toHaveCount(1);
    await tabbable.focus();
    const first = await tabbable.getAttribute("data-day-hit");
    await page.keyboard.press("ArrowRight");
    const moved = page.locator("button[data-day-hit]:focus");
    await expect(moved).not.toHaveAttribute("data-day-hit", first!);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(1);
  });

  test("5 trips at 1280×800: every REMOVE clickable, none under the shelf, page never scrolls", async ({ page }) => {
    await seedCart(page, 5);
    const list = rail(page).locator(".bk-rail-list");
    const shelf = rail(page).locator(".bk-rail-shelf");
    await expect(rail(page).getByText(/↓ \d MORE/)).toBeVisible();

    const removes = rail(page).getByRole("button", { name: /^Remove .* from cart$/ });
    await expect(removes).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      // A trial click runs every actionability check (including "not covered")
      // and scrolls only the rail list.
      await removes.nth(i).click({ trial: true });
      const r = (await removes.nth(i).boundingBox())!;
      const s = (await shelf.boundingBox())!;
      expect(r.y + r.height).toBeLessThanOrEqual(s.y);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

    // A real click on the first REMOVE: focus moves to the next item's REMOVE.
    await list.evaluate((l) => (l.scrollTop = 0));
    const secondId = await removes.nth(1).getAttribute("data-remove");
    await removes.first().click();
    await expect(removes).toHaveCount(4);
    await expect(rail(page).locator(`[data-remove="${secondId}"]`)).toBeFocused();
  });

  test("the rail never moves when the main column scrolls", async ({ page }) => {
    await seedCart(page, 5);
    const before = await rail(page).boundingBox();
    await main(page).evaluate((m) => (m.scrollTop = m.scrollHeight));
    await expect(page.getByRole("link", { name: "← BACK TO HOME" })).toBeInViewport();
    expect(await rail(page).boundingBox()).toEqual(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("a cart item's date line opens that day's panel, switching month", async ({ page }) => {
    const [first] = await seedCart(page, 1);
    // /book opens on this month; the item is two months out.
    await rail(page).locator(".bk-cart-date").click();
    const card = dialog(page).locator(`[data-trip-card="${first.id}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/is-focus/);
    await expect(boxButton(page, first.departureDate)).toHaveAttribute("aria-expanded", "true");
  });

  test("short window: address bar hidden, 3 lines per box at 1280×680", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 680 });
    await gotoFixtureMonth(page);
    await expect(page.locator(".booking-nav-addr")).toBeHidden();
    const weeks = (await page.locator(".bk-cal-grid > *").count()) / 7;
    if (weeks === 5) await expect(box(page, d(22)).locator(".bk-line")).toHaveCount(3);
  });

  test("1024 wide is desktop; 1023 is mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/book");
    await expect(page.locator(".bk-cal")).toBeVisible();
    await expect(rail(page)).toBeVisible();
    await expect(page.locator(".booking-mobile-bar")).toBeHidden();

    await page.setViewportSize({ width: 1023, height: 768 });
    await expect(page.locator(".bk-cal")).toBeHidden();
    await expect(rail(page)).toBeHidden();
    await expect(page.locator(".booking-mobile-bar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible(); // the mobile month card
  });
});
