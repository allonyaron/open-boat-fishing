import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

// ── In-memory SQLite mock ─────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => {
  class InMemoryDB {
    tables = new Map<string, Record<string, unknown>[]>();
    private pkMap = new Map<string, string>();

    clearData(): void {
      for (const rows of this.tables.values()) rows.length = 0;
    }

    private tbl(name: string): Record<string, unknown>[] {
      if (!this.tables.has(name)) this.tables.set(name, []);
      return this.tables.get(name)!;
    }

    async execAsync(sql: string): Promise<void> {
      for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([^)]+)\)/g)) {
        const [, name, cols] = m;
        if (!this.tables.has(name)) this.tables.set(name, []);
        const pk = cols.match(/(\w+)\s+\w+\s+PRIMARY KEY/)?.[1];
        if (pk) this.pkMap.set(name, pk);
      }
    }

    async runAsync(sql: string, params: unknown[] = []): Promise<void> {
      const s = sql.replace(/\s+/g, " ").trim();
      let m: RegExpMatchArray | null;

      // DELETE FROM t WHERE col = ?
      if ((m = s.match(/^DELETE FROM (\w+) WHERE (\w+) = \?$/i))) {
        const rows = this.tbl(m[1]);
        const idx = rows.findIndex((r) => r[m![2]] === params[0]);
        if (idx >= 0) rows.splice(idx, 1);
        return;
      }

      // DELETE FROM t
      if ((m = s.match(/^DELETE FROM (\w+)$/i))) {
        this.tables.set(m[1], []);
        return;
      }

      // UPDATE t SET ... WHERE col = ?
      if ((m = s.match(/^UPDATE (\w+) SET (.+?) WHERE (\w+) = \?$/i))) {
        const [, t, setClause, whereCol] = m;
        const whereVal = params[params.length - 1];
        const updates: Record<string, unknown> = {};
        let pIdx = 0;
        for (const pair of setClause.split(",")) {
          const sm = pair.trim().match(/^(\w+)\s*=\s*(\?|\d+)$/);
          if (!sm) continue;
          updates[sm[1]] = sm[2] === "?" ? params[pIdx++] : Number(sm[2]);
        }
        for (const row of this.tbl(t)) {
          if (row[whereCol] === whereVal) Object.assign(row, updates);
        }
        return;
      }

      // INSERT [OR IGNORE] INTO t (cols) VALUES (...)
      if (
        (m = s.match(
          /^INSERT\s+(OR IGNORE\s+)?INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
        ))
      ) {
        const [, orIgnore, t, colsStr, valsStr] = m;
        const isIgnore = !!orIgnore;
        const isUpsert = /ON CONFLICT/i.test(s);
        const cols = colsStr.split(",").map((c) => c.trim());
        const vals = valsStr.split(",").map((v) => v.trim());
        const pk = this.pkMap.get(t);

        const row: Record<string, unknown> = {};
        let pIdx = 0;
        for (let i = 0; i < cols.length; i++) {
          row[cols[i]] = vals[i] === "?" ? params[pIdx++] : Number(vals[i]);
        }

        const rows = this.tbl(t);
        const existingIdx = pk ? rows.findIndex((r) => r[pk] === row[pk]) : -1;

        if (existingIdx >= 0) {
          if (isIgnore) return;
          if (isUpsert) {
            const um = s.match(/ON CONFLICT\([^)]+\) DO UPDATE SET (.+)$/i);
            if (um) {
              for (const pair of um[1].split(",")) {
                const pm = pair.trim().match(/(\w+)\s*=\s*excluded\.(\w+)/);
                if (pm) rows[existingIdx][pm[1]] = row[pm[2]];
              }
            }
          }
        } else {
          rows.push(row);
        }
      }
    }

    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const s = sql.replace(/\s+/g, " ").trim();
      const m = s.match(
        /^SELECT (.+?) FROM (\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+(\w+))?$/i,
      );
      if (!m) return [];
      const [, colsStr, t, where, orderBy] = m;
      let rows = [...this.tbl(t)];

      if (where) {
        const wm = where.trim().match(/^(\w+)\s*=\s*(\?|\d+)$/);
        if (wm) {
          const filterVal = wm[2] === "?" ? params[0] : Number(wm[2]);
          rows = rows.filter((r) => r[wm[1]] === filterVal);
        }
      }

      if (orderBy && orderBy.toLowerCase() !== "rowid") {
        rows.sort((a, b) => String(a[orderBy] ?? "").localeCompare(String(b[orderBy] ?? "")));
      }

      if (colsStr.trim() === "*") return rows as T[];
      const cols = colsStr.split(",").map((c) => c.trim());
      return rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const c of cols) out[c] = r[c];
        return out;
      }) as T[];
    }

    async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const rows = await this.getAllAsync<T>(sql, params);
      return rows[0] ?? null;
    }

    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      await fn();
    }
  }

  return { mockDb: new InMemoryDB() };
});

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn().mockResolvedValue(mockDb),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { upsertBooking, getAllBookings, getTicketById, removeBooking } from "../wallet";
import type { WalletBooking } from "../wallet";

function makeBooking(overrides: Partial<WalletBooking> = {}): Omit<WalletBooking, "syncedAt"> {
  return {
    id: "booking-1",
    confirmationCode: "ABC123",
    customerName: "Alice",
    customerEmail: "alice@example.com",
    customerPhone: null,
    totalCents: 5000,
    groupDiscountCents: 0,
    createdAt: "2026-01-01T10:00:00.000Z",
    items: [
      {
        id: "item-1",
        tripId: "trip-1",
        subtotalCents: 5000,
        trip: {
          id: "trip-1",
          startTime: "08:00",
          endTime: "12:00",
          departureDate: "2026-01-15",
          boardingTime: null,
          status: "scheduled",
          vessel: { id: "v-1", name: "Lady Luck", color: "#003366" },
          product: { id: "p-1", displayName: "Full Day", category: "party_boat" },
        },
        tickets: [
          {
            id: "ticket-1",
            ticketType: "adult",
            priceCents: 5000,
            feeAmountCents: 150,
            qrPayload: "uuid-abc",
            voided: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDb.clearData();
});

describe("upsertBooking", () => {
  it("inserts a new booking and returns it with syncedAt", async () => {
    const booking = makeBooking();
    const result = await upsertBooking(booking);
    expect(result.id).toBe("booking-1");
    expect(result.syncedAt).toBeTruthy();
    expect(typeof result.syncedAt).toBe("string");
  });

  it("returns the booking with all original fields intact", async () => {
    const booking = makeBooking();
    const result = await upsertBooking(booking);
    expect(result.confirmationCode).toBe("ABC123");
    expect(result.customerEmail).toBe("alice@example.com");
    expect(result.items).toHaveLength(1);
  });

  it("updates syncedAt and raw_json on conflict (same id)", async () => {
    const booking = makeBooking();
    const first = await upsertBooking(booking);
    await new Promise((r) => setTimeout(r, 5)); // ensure different timestamp
    const second = await upsertBooking({ ...booking, customerName: "Alice Updated" });
    // Second upsert returns a new record with updated name
    expect(second.customerName).toBe("Alice Updated");
    // Only one row in the DB
    const all = await getAllBookings();
    expect(all).toHaveLength(1);
    expect(all[0].customerName).toBe("Alice Updated");
  });
});

describe("getAllBookings", () => {
  it("returns an empty array when no bookings are stored", async () => {
    expect(await getAllBookings()).toEqual([]);
  });

  it("returns all stored bookings", async () => {
    await upsertBooking(makeBooking({ id: "b-1" }));
    await upsertBooking(makeBooking({ id: "b-2", confirmationCode: "XYZ789" }));
    const all = await getAllBookings();
    expect(all).toHaveLength(2);
  });

  it("returns bookings in id order", async () => {
    await upsertBooking(makeBooking({ id: "b-z" }));
    await upsertBooking(makeBooking({ id: "b-a" }));
    const all = await getAllBookings();
    expect(all[0].id).toBe("b-a");
    expect(all[1].id).toBe("b-z");
  });
});

describe("getTicketById", () => {
  it("returns the booking, item, and ticket when the ticket exists", async () => {
    await upsertBooking(makeBooking());
    const result = await getTicketById("ticket-1");
    expect(result).not.toBeNull();
    expect(result!.booking.id).toBe("booking-1");
    expect(result!.item.id).toBe("item-1");
    expect(result!.ticket.id).toBe("ticket-1");
  });

  it("returns null when the ticket id is not found", async () => {
    await upsertBooking(makeBooking());
    expect(await getTicketById("nonexistent")).toBeNull();
  });

  it("returns null when there are no bookings", async () => {
    expect(await getTicketById("ticket-1")).toBeNull();
  });
});

describe("removeBooking", () => {
  it("removes the booking so it no longer appears in getAllBookings", async () => {
    await upsertBooking(makeBooking({ id: "b-1" }));
    await upsertBooking(makeBooking({ id: "b-2" }));
    await removeBooking("b-1");
    const all = await getAllBookings();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("b-2");
  });

  it("is a no-op when the booking does not exist", async () => {
    await upsertBooking(makeBooking({ id: "b-1" }));
    await removeBooking("nonexistent");
    expect(await getAllBookings()).toHaveLength(1);
  });
});
