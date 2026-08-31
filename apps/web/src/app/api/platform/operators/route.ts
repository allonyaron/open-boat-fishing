import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { operators, domains, staff } from "@openboat/db";
import { eq } from "drizzle-orm";
import { requirePlatform } from "@/lib/platform-session";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function randomPassword(length = 16): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export async function GET(req: NextRequest) {
  const auth = await requirePlatform(req);
  if (auth instanceof NextResponse) return auth;

  const rows = await db
    .select({
      id: operators.id,
      name: operators.name,
      slug: operators.slug,
      stripeOnboardingComplete: operators.stripeOnboardingComplete,
      createdAt: operators.createdAt,
    })
    .from(operators)
    .orderBy(operators.createdAt);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requirePlatform(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const { name, domain, emailFrom, emailDomain, adminName, adminEmail } = body as {
    name: string;
    domain: string;
    emailFrom: string;
    emailDomain: string;
    adminName: string;
    adminEmail: string;
  };

  if (!name || !domain || !emailFrom || !emailDomain || !adminName || !adminEmail) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  // Ensure domain is unique
  const [existingDomain] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(eq(domains.domain, domain.toLowerCase().trim()));

  if (existingDomain) {
    return NextResponse.json({ error: "Domain already registered" }, { status: 409 });
  }

  const slug = slugify(name);
  const tempPassword = randomPassword();
  const passwordHash = await hash(tempPassword, 10);

  const [operator] = await db
    .insert(operators)
    .values({
      name: name.trim(),
      slug,
      emailFrom: emailFrom.trim(),
      emailDomain: emailDomain.trim(),
    })
    .returning({ id: operators.id, slug: operators.slug });

  await db.insert(domains).values({
    operatorId: operator.id,
    domain: domain.toLowerCase().trim(),
    primary: true,
  });

  await db.insert(staff).values({
    operatorId: operator.id,
    name: adminName.trim(),
    email: adminEmail.toLowerCase().trim(),
    passwordHash,
    role: "admin",
    active: true,
  });

  return NextResponse.json({
    operatorId: operator.id,
    slug: operator.slug,
    domain: domain.toLowerCase().trim(),
    adminEmail: adminEmail.toLowerCase().trim(),
    tempPassword,
    loginUrl: `https://${domain.toLowerCase().trim()}/admin`,
  });
}
