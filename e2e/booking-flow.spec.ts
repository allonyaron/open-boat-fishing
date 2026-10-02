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

test("/book server-renders this month's trips", async ({ request }) => {
  // Raw HTML, no JS: the trip list must come from the server render, not a
  // client fetch (P8-2 — the page loads its first month during SSR).
  const res = await request.get("/book");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toMatch(/aria-label="One more (adult )?seat/);
});

test("booking flow", async ({ page }, testInfo) => {
  const shot = screenshotter(testInfo);

  // ── 01  Trip list ──────────────────────────────────────────────────────────
  await page.goto("/book");
  const addAdult = page.getByRole("button", { name: "One more adult seat" }).first();
  await expect(addAdult).toBeVisible();
  await page.screenshot({ path: shot("01-trips") });

  // ── 02  Add a seat — the cart appears with a checkout button ──────────────
  await addAdult.click();
  const checkout = page.getByRole("button", { name: /check out/i });
  await expect(checkout).toBeVisible();
  await page.screenshot({ path: shot("02-cart") });

  // ── 03  Checkout page (cart summary + contact form + payment) ─────────────
  await Promise.all([page.waitForURL("**/checkout"), checkout.click()]);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/1 adult ×/)).toBeVisible();
  await page.screenshot({ path: shot("03-checkout") });

  // ── 04  Contact form ───────────────────────────────────────────────────────
  await page.getByLabel("Name on the manifest").fill("Alex Angler");
  await page.getByLabel(/^Mobile/).fill("(555) 123-4567");
  await page.getByLabel(/^Email/).fill("alex@example.com");
  await expect(page.getByRole("button", { name: /^Pay \$/i })).toBeVisible();
  await page.screenshot({ path: shot("04-contact-form") });

  // Payment is not driven here: the booking POST only fires after Stripe's
  // Payment Element validates, which needs real Stripe test keys, a connected
  // account, and webhook delivery. The post-payment screens are covered below
  // against a seeded confirmed booking.
});

test("post-payment screens", async ({ page }, testInfo) => {
  const { code, bookingId } = loadFixtures();

  if (!code || !bookingId) {
    // Locally, skipping is a convenience when the seed hasn't been run. In CI
    // the seed is part of the job, so a missing fixture is a failure.
    if (process.env.CI) throw new Error("Seed booking not found — check the seed steps in CI");
    test.skip(true, "Seed booking not found. Run seed-test-customers.ts first, then re-run.");
    return;
  }

  const shot = screenshotter(testInfo);

  // ── 05  Delivery screen ────────────────────────────────────────────────────
  await page.goto(`/booking/delivery?code=${code}&redirect_status=succeeded`);
  await expect(page.getByRole("heading", { name: /seats confirmed/i })).toBeVisible();
  await expect(page.getByRole("img", { name: "Boarding pass QR code" })).toBeVisible();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await page.screenshot({ path: shot("05-delivery") });

  // ── 06  Boarding passes (printable) ───────────────────────────────────────
  await page.goto(`/boarding/${bookingId}`);
  await expect(page.getByRole("button", { name: "Print / Save PDF" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^QR code for ticket / }).first()).toBeVisible();
  await page.screenshot({ path: shot("06-boarding-pass"), fullPage: true });
});
