import fs from "fs";
import path from "path";

export const FIXTURE_PATH = path.join("e2e", ".fixtures.json");

// CI serves the app on a port other than 3000, so nothing can work only
// because it happens to reach localhost:3000 (P8-2).
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

type Fixtures = { code: string | null; bookingId: string | null };

export default async function globalSetup(): Promise<void> {
  // Confirmation code matches seed-test-customers.ts:
  //   D = today's MMDD (e.g. "0806"), code = `${D}02` (Maria Garcia)
  const today = new Date().toISOString().slice(0, 10); // "2026-08-06"
  const D = today.replace(/-/g, "").slice(4); // "0806"
  const code = `${D}02`;
  const email = "maria.garcia@gmail.com";

  const write = (data: Fixtures) => fs.writeFileSync(FIXTURE_PATH, JSON.stringify(data, null, 2));

  let res: Response;
  try {
    res = await fetch(
      `${BASE_URL}/api/bookings?email=${encodeURIComponent(email)}&code=${code}`,
    );
  } catch {
    console.warn(
      `\n[global-setup] Could not reach ${BASE_URL} — is the dev server running?` +
        "\n               Steps 08-delivery and 09-boarding will be skipped.\n",
    );
    write({ code: null, bookingId: null });
    return;
  }

  if (!res.ok) {
    console.warn(
      `\n[global-setup] Seed booking not found (code=${code}, status=${res.status}).` +
        "\n               Run: DATABASE_URL=... tsx packages/db/src/seed-test-customers.ts" +
        "\n               Steps 08-delivery and 09-boarding will be skipped.\n",
    );
    write({ code: null, bookingId: null });
    return;
  }

  const data = (await res.json()) as { id: string; confirmationCode: string };
  write({ code: data.confirmationCode, bookingId: data.id });
  console.log(
    `\n[global-setup] Fixture booking ready — code=${data.confirmationCode} id=${data.id}\n`,
  );
}
