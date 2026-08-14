/**
 * Creates a single mate staff user with a PIN. Safe to re-run — skips if the email exists.
 *
 * Usage:
 *   DATABASE_URL=... MATE_EMAIL=... MATE_PIN=... pnpm --filter @openboat/db seed:mate
 *
 * Or set DATABASE_URL in packages/db/.env
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const MATE_EMAIL = process.env.MATE_EMAIL ?? "mate@example.com";
const MATE_PIN = process.env.MATE_PIN ?? "1234";
const MATE_NAME = process.env.MATE_NAME ?? "Mate";

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

async function seedMate() {
  const [operator] = await db.select().from(schema.operators).limit(1);
  if (!operator) {
    console.error("No operator found. Run the main seed first.");
    process.exit(1);
  }

  const existing = await db
    .select({ id: schema.staff.id })
    .from(schema.staff)
    .where(eq(schema.staff.email, MATE_EMAIL));

  if (existing.length > 0) {
    console.log(`Mate user ${MATE_EMAIL} already exists — skipping.`);
    await client.end();
    return;
  }

  const pinHash = await bcrypt.hash(MATE_PIN, 12);

  const [member] = await db
    .insert(schema.staff)
    .values({
      operatorId: operator.id,
      name: MATE_NAME,
      email: MATE_EMAIL,
      pinHash,
      role: "mate",
      active: true,
    })
    .returning();

  console.log(`✓ Mate user created: ${member.email} (id: ${member.id})`);
  console.log(`  PIN: ${MATE_PIN}`);
  console.log(`  Login at: /(mate)/login in the mate app`);

  await client.end();
}

seedMate().catch((err) => {
  console.error(err);
  process.exit(1);
});
