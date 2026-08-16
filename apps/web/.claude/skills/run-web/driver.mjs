#!/usr/bin/env node
/**
 * Playwright driver for the open-boat-fishing Next.js web app.
 * Run from apps/web/ or any directory; resolves playwright from monorepo root.
 *
 * Usage:
 *   node .claude/skills/run-web/driver.mjs [--url URL] [--out DIR] [--flow FLOW]
 *
 * Flows:
 *   smoke    - homepage renders, calendar loads (default)
 *   booking  - homepage → click day → click trip → add 2 adults to cart
 *   admin    - /admin/login renders + fills dev credentials
 *
 * Screenshots land in --out (default /tmp/web-screenshots).
 * Exit 0 = success. Any console error is printed to stderr.
 */

import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { join } from "path";

const get = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
};

const BASE_URL = get("--url", "http://localhost:3000");
const OUT_DIR = get("--out", "/tmp/web-screenshots");
const FLOW = get("--flow", "smoke");

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const ss = async (name) => {
  const p = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`screenshot → ${p}`);
};

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(e.message));

try {
  if (FLOW === "smoke") {
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForSelector("header", { timeout: 10_000 });
    await ss("01-homepage-calendar");

    // Verify trip dots render (calendar has loaded data)
    await page.waitForSelector('[class*="cursor-pointer"]', { timeout: 10_000 });
    const dayCells = await page.locator('[class*="cursor-pointer"]').count();
    console.log(`Calendar day cells rendered: ${dayCells}`);
    await ss("02-calendar-loaded");
  }

  if (FLOW === "booking") {
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForSelector('[class*="cursor-pointer"]', { timeout: 10_000 });

    // Click a day with multiple vessels (day 8 — Saturday with 4 vessels in seed data)
    // Falls back to the first available day cell if 8 is in the past
    const targetDay = page.locator('[class*="cursor-pointer"]').filter({ hasText: /^8$/ });
    const anyDay = page.locator('[class*="cursor-pointer"]').first();
    const dayToClick = (await targetDay.count()) ? targetDay : anyDay;
    await dayToClick.click();
    await page.waitForTimeout(800);
    await ss("01-day-selected");

    // Click the first trip card in the side panel
    const firstTrip = page.locator("text=/Bay Fluke|Sea Bass|Bluefish|Striped Bass|Tuna/").first();
    await firstTrip.waitFor({ timeout: 5_000 });
    await firstTrip.click();
    await page.waitForTimeout(800);
    await ss("02-ticket-selector");

    // Add 2 adults (+  button)
    const plusBtn = page.locator("button").filter({ hasText: "+" }).first();
    await plusBtn.click();
    await page.waitForTimeout(200);
    await plusBtn.click();
    await page.waitForTimeout(200);
    await ss("03-two-adults");

    // Verify "Add to cart" button is now visible
    const addToCart = page.locator("button", { hasText: "Add to cart" });
    await addToCart.waitFor({ timeout: 5_000 });
    const total = await page
      .locator("text=/\\$[0-9]+/")
      .first()
      .textContent()
      .catch(() => "");
    console.log(`Cart total visible: ${total}`);
    await ss("04-add-to-cart-ready");
  }

  if (FLOW === "admin") {
    await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "networkidle", timeout: 20_000 });
    await page.waitForSelector("form", { timeout: 10_000 });
    await ss("01-admin-login");

    // Dev credentials (seed-admin.ts defaults)
    await page.fill('input[type="email"]', "admin@your-domain.com");
    await page.fill('input[type="password"]', "changeme");
    await ss("02-admin-login-filled");

    // Submit — will 401 unless seed was run against the DB
    await page.locator("button", { hasText: "Sign in" }).click();
    await page.waitForTimeout(1500);
    await ss("03-admin-post-login");
    const url = page.url();
    console.log(`After login redirect: ${url}`);
  }
} finally {
  if (errors.length) {
    console.error("Console errors:");
    errors.forEach((e) => console.error(" ", e));
  }
  await browser.close();
}

console.log(`Done. Screenshots in ${OUT_DIR}`);
