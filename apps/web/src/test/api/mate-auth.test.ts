import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/mate/auth/route";
import { seedOperator, cleanupOperator } from "../db-helpers";

let ctx: Awaited<ReturnType<typeof seedOperator>>;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(body: unknown) {
  return new NextRequest("http://localhost/api/mate/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mate/auth", () => {
  it("returns 400 when email and pin are missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when pin is missing", async () => {
    const res = await POST(req({ email: ctx.staffEmail }));
    expect(res.status).toBe(400);
  });

  it("returns 401 for unknown email", async () => {
    const res = await POST(req({ email: "nobody@example.com", pin: "1234" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong PIN", async () => {
    const res = await POST(req({ email: ctx.staffEmail, pin: "9999" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 with token and name for valid credentials", async () => {
    const res = await POST(req({ email: ctx.staffEmail, pin: "1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.role).toBe("mate");
    expect(body.name).toBe("Test Mate");
  });

  it("token from login is accepted by requireMate", async () => {
    const loginRes = await POST(req({ email: ctx.staffEmail, pin: "1234" }));
    const { token } = await loginRes.json();

    const { requireMate } = await import("@/lib/mate-auth");
    const authReq = new NextRequest("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await requireMate(authReq);
    expect("staff" in result).toBe(true);
  });
});
