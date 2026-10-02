import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "@/app/api/health/route";
import { db } from "@/lib/db";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns 200 with ok:true when the DB answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 503 without leaking the error when the DB query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "execute").mockRejectedValueOnce(new Error("connect ECONNREFUSED secret-host"));

    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("returns 503 when the DB doesn't answer within the timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A query that never settles, like an unreachable host before postgres-js gives up.
    vi.spyOn(db, "execute").mockReturnValueOnce(
      new Promise(() => {}) as unknown as ReturnType<typeof db.execute>,
    );

    const pending = GET();
    await vi.advanceTimersByTimeAsync(3_000);
    const res = await pending;
    expect(res.status).toBe(503);
  });
});
