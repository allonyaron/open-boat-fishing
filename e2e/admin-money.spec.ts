// Office money actions end to end (row 10): refunding a ticket, cancelling a
// trip with a paid booking, and clearing an item from the Money page's
// "Needs attention" list.
//
// Needs: seed-demo.ts, seed-admin.ts and seed-e2e-admin.ts (run it again
// before each run: these tests change its data). Desktop (Chromium) only: in a
// production build the admin cookie is Secure, which WebKit drops on
// http://localhost.
//
// In CI the server's Stripe key is a placeholder, so every refund the app
// sends is refused at authentication and stays queued; with a real test key
// Stripe refuses the fixture's made-up payment instead. Either way the office
// sees the ticket refunded and the trip cancelled; the wording about the money
// differs, and the tests accept both.
import { test, expect, type Page } from "@playwright/test";

// Kept in step with packages/db/src/seed-e2e-admin.ts.
const REFUND_PRODUCT = "E2E Refund Trip";
const CANCEL_PRODUCT = "E2E Cancel Trip";
const REFUSED_NOTE = "E2E sample refusal";
const DAYS_AHEAD = 30;
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "changeme";

const tripDate = new Date(Date.now() + DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);

test.skip(({ browserName }) => browserName !== "chromium", "Admin sign-in needs Chromium on http://localhost");

// One sign-in for the file: admin login is rate limited per IP.
test.describe.configure({ mode: "serial" });
let cookies: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>> | null = null;

async function signIn(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    return;
  }
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
  cookies = await page.context().cookies();
}

type AdminTrip = { id: string; status: string; product: { displayName: string } };

/** The fixture trip with this product, read through the admin API. */
async function fixtureTrip(page: Page, product: string): Promise<AdminTrip> {
  const res = await page.request.get(`/api/admin/trips?from=${tripDate}&to=${tripDate}&limit=400`);
  expect(res.ok(), `GET /api/admin/trips answered ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as AdminTrip[] | { trips: AdminTrip[] };
  const trips = Array.isArray(body) ? body : body.trips;
  const trip = trips.find((t) => t.product.displayName === product);
  expect(trip, `No "${product}" trip on ${tripDate}: run seed-e2e-admin.ts`).toBeTruthy();
  return trip!;
}

/** Waits for the screen's own loading lines to clear. */
async function settled(page: Page) {
  await page.waitForFunction(() => !document.body.innerText.includes("Loading"), null, { timeout: 15_000 });
}

test("refunding a ticket takes it out of service and says where the money is", async ({ page }) => {
  await signIn(page);
  const trip = await fixtureTrip(page, REFUND_PRODUCT);
  await page.goto(`/admin/trips/${trip.id}/passengers`);
  await settled(page);

  await page.getByRole("button", { name: "Refund", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Refund one ticket" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^Refund this ticket · \$68$/ }).click();

  // The ticket is refunded and the seat is back on sale whether or not Stripe
  // took the money request; the message says which.
  await expect(
    page.getByText(
      /^Ticket refunded and the seat is back on sale(\. The \$68 will go back once Stripe responds|, but Stripe refused the \$68)/,
    ),
  ).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Refunded", { exact: true }).first()).toBeVisible();
});

test("cancelling a trip with a paid booking goes through even when its refund can't be sent", async ({ page }) => {
  await signIn(page);
  const trip = await fixtureTrip(page, CANCEL_PRODUCT);
  expect(trip.status).toBe("scheduled");

  await page.goto(`/admin/calendar?date=${tripDate}`);
  await settled(page);
  // The visible row for this trip, then its own Cancel button (Dock view
  // labels it "Cancel", Desk view "Cancel, <time> <trip>").
  const row = page.getByRole("listitem").filter({ hasText: CANCEL_PRODUCT }).filter({ visible: true });
  await row.getByRole("button", { name: /^Cancel(,| trip|$)/ }).first().click();

  const dialog = page.getByRole("dialog", { name: "Cancel trip" });
  await expect(dialog).toContainText(CANCEL_PRODUCT);
  // The radio is drawn over; pick the reason by its words, as a person would.
  await dialog.getByText(/^Weather/).click();
  await expect(dialog.getByRole("radio", { name: /^Weather/ })).toBeChecked();
  await dialog.getByRole("button", { name: /^Cancel and refund/ }).click();

  await expect(page.getByText(/^Trip cancelled(\.|,)/)).toBeVisible();
  await expect(page.getByText(/1 refund will go out once Stripe responds|Stripe refused 1 refund/)).toBeVisible();
  expect((await fixtureTrip(page, CANCEL_PRODUCT)).status).toBe("cancelled");
});

test("a refused refund shows under Needs attention and can be marked dealt with", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/money");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();

  const item = page.getByRole("listitem").filter({ hasText: REFUSED_NOTE });
  await expect(item).toContainText("Stripe refused a refund");
  await expect(item).toContainText("$12.34");
  await expect(item).toContainText("Booking E2EREF");
  // Stripe's error class is left out of what the office reads.
  await expect(item).not.toContainText("StripeInvalidRequestError");

  await item.getByRole("button", { name: "Mark dealt with" }).click();
  await expect(page.getByText("Marked as dealt with.")).toBeVisible();
  await expect(item).toHaveCount(0);
});
