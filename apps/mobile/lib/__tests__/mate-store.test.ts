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
        rows.sort((a, b) =>
          String(a[orderBy] ?? "").localeCompare(String(b[orderBy] ?? "")),
        );
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

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  cacheTrips,
  getCachedTrips,
  cacheManifest,
  getCachedManifest,
  queueCheckIn,
  getUnsyncedCheckIns,
  markCheckInSynced,
  markCheckInError,
  getLocalCheckedInTickets,
  type MateTrip,
  type MateManifest,
  type CheckInQueueEntry,
} from "../mate-store";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTrip(id: string): MateTrip {
  return {
    id,
    departureDate: "2026-01-15",
    startTime: "08:00",
    endTime: "12:00",
    boardingTime: null,
    capacity: 29,
    seatsRemaining: 20,
    status: "scheduled",
    vessel: { id: "v-1", name: "Lady Luck", color: "#003366", certificateCapacity: 30 },
    product: { id: "p-1", displayName: "Full Day", category: "party_boat" },
    ticketsSold: 9,
    checkedIn: 0,
  };
}

function makeManifest(tripId: string): MateManifest {
  return {
    trip: makeTrip(tripId),
    bookings: [
      {
        id: "bk-1",
        confirmationCode: "ABC",
        customerName: "Alice",
        customerEmail: "alice@example.com",
        customerPhone: null,
        status: "confirmed",
        tickets: [
          {
            id: "tkt-1",
            ticketType: "adult",
            passengerName: null,
            qrPayload: "uuid-1",
            voided: false,
            checkedIn: false,
            checkedInAt: null,
            checkInMethod: null,
          },
        ],
      },
    ],
  };
}

function makeQueueEntry(localId: string, tripId = "trip-1"): Omit<CheckInQueueEntry, "synced" | "syncError"> {
  return {
    localId,
    ticketId: `tkt-${localId}`,
    tripId,
    method: "qr",
    note: null,
    checkedInAt: new Date().toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDb.clearData();
});

describe("cacheTrips / getCachedTrips", () => {
  it("stores and retrieves a list of trips", async () => {
    const trips = [makeTrip("t-1"), makeTrip("t-2")];
    await cacheTrips(trips);
    const result = await getCachedTrips();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("t-1");
    expect(result[1].id).toBe("t-2");
  });

  it("replaces all trips on a second call", async () => {
    await cacheTrips([makeTrip("t-1"), makeTrip("t-2")]);
    await cacheTrips([makeTrip("t-3")]);
    const result = await getCachedTrips();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t-3");
  });

  it("returns empty array when nothing is cached", async () => {
    expect(await getCachedTrips()).toEqual([]);
  });
});

describe("cacheManifest / getCachedManifest", () => {
  it("stores and retrieves a manifest by tripId", async () => {
    const manifest = makeManifest("trip-1");
    await cacheManifest("trip-1", manifest);
    const result = await getCachedManifest("trip-1");
    expect(result).not.toBeNull();
    expect(result!.trip.id).toBe("trip-1");
    expect(result!.bookings).toHaveLength(1);
  });

  it("returns null for an unknown tripId", async () => {
    expect(await getCachedManifest("nonexistent")).toBeNull();
  });

  it("updates the manifest on a second cacheManifest call for the same trip", async () => {
    await cacheManifest("trip-1", makeManifest("trip-1"));
    const updated = makeManifest("trip-1");
    updated.bookings = [];
    await cacheManifest("trip-1", updated);
    const result = await getCachedManifest("trip-1");
    expect(result!.bookings).toHaveLength(0);
  });
});

describe("queueCheckIn / getUnsyncedCheckIns", () => {
  it("queues an entry and retrieves it as unsynced", async () => {
    await queueCheckIn(makeQueueEntry("ci-1"));
    const unsynced = await getUnsyncedCheckIns();
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0].localId).toBe("ci-1");
    expect(unsynced[0].ticketId).toBe("tkt-ci-1");
    expect(unsynced[0].synced).toBe(false);
  });

  it("returns empty array when all entries are synced", async () => {
    await queueCheckIn(makeQueueEntry("ci-1"));
    await markCheckInSynced("ci-1");
    expect(await getUnsyncedCheckIns()).toHaveLength(0);
  });

  it("is idempotent — INSERT OR IGNORE skips duplicate localId", async () => {
    await queueCheckIn(makeQueueEntry("ci-1"));
    await queueCheckIn(makeQueueEntry("ci-1")); // same localId
    expect(await getUnsyncedCheckIns()).toHaveLength(1);
  });
});

describe("markCheckInSynced", () => {
  it("marks the entry synced so it no longer appears in getUnsyncedCheckIns", async () => {
    await queueCheckIn(makeQueueEntry("ci-1"));
    await queueCheckIn(makeQueueEntry("ci-2"));
    await markCheckInSynced("ci-1");
    const unsynced = await getUnsyncedCheckIns();
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0].localId).toBe("ci-2");
  });
});

describe("markCheckInError", () => {
  it("sets the sync_error on the entry", async () => {
    await queueCheckIn(makeQueueEntry("ci-1"));
    await markCheckInError("ci-1", "ticket_not_found");
    // The entry is still unsynced (synced is still 0)
    const unsynced = await getUnsyncedCheckIns();
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0].syncError).toBe("ticket_not_found");
  });
});

describe("getLocalCheckedInTickets", () => {
  it("returns a Set of ticket IDs for the given trip", async () => {
    await queueCheckIn(makeQueueEntry("ci-1", "trip-1"));
    await queueCheckIn(makeQueueEntry("ci-2", "trip-1"));
    await queueCheckIn(makeQueueEntry("ci-3", "trip-2")); // different trip

    const result = await getLocalCheckedInTickets("trip-1");
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(2);
    expect(result.has("tkt-ci-1")).toBe(true);
    expect(result.has("tkt-ci-2")).toBe(true);
    expect(result.has("tkt-ci-3")).toBe(false);
  });

  it("returns an empty Set when no entries exist for the trip", async () => {
    const result = await getLocalCheckedInTickets("trip-x");
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });
});
