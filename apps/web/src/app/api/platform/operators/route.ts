import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { operators, domains, staff } from "@openboat/db";
import { eq } from "drizzle-orm";
import { requirePlatform } from "@/lib/platform-session";

const hostnameRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

const createOperatorSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().regex(hostnameRe, "Invalid domain format"),
  emailFrom: z.string().email(),
  emailDomain: z.string().regex(hostnameRe, "Invalid email domain format"),
  adminName: z.string().min(1).max(100),
  adminEmail: z.string().email(),
});

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

  const parsed = createOperatorSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { name, domain, emailFrom, emailDomain, adminName, adminEmail } = parsed.data;

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
