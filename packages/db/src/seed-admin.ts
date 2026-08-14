/**
 * Creates a single admin staff user. Safe to re-run — skips if the email exists.
 *
 * Usage:
 *   DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm --filter @openboat/db seed:admin
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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "changeme";
const ADMIN_NAME = process.env.ADMIN_NAME ?? "Admin";

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

async function seedAdmin() {
  const [operator] = await db.select().from(schema.operators).limit(1);
  if (!operator) {
    console.error("No operator found. Run the main seed first.");
    process.exit(1);
  }

  const existing = await db
    .select({ id: schema.staff.id })
    .from(schema.staff)
    .where(eq(schema.staff.email, ADMIN_EMAIL));

  if (existing.length > 0) {
    console.log(`Admin user ${ADMIN_EMAIL} already exists — skipping.`);
    await client.end();
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const [member] = await db
    .insert(schema.staff)
    .values({
      operatorId: operator.id,
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      active: true,
    })
    .returning();

  console.log(`✓ Admin user created: ${member.email} (id: ${member.id})`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log(`  Login at: /admin/login`);

  await client.end();
}

seedAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
