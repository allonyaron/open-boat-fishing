import * as SQLite from 'expo-sqlite';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MateTrip = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  boardingTime: string | null;
  capacity: number;
  seatsRemaining: number;
  status: string;
  vessel: { id: string; name: string; color: string };
  product: { id: string; displayName: string; category: string };
  ticketsSold: number;
  checkedIn: number;
};

export type MateTicket = {
  id: string;
  ticketType: string;
  passengerName: string | null;
  qrPayload: string;
  voided: boolean;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkInMethod: string | null;
};

export type MateBooking = {
  id: string;
  confirmationCode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  status: string;
  tickets: MateTicket[];
};

export type MateManifest = {
  trip: MateTrip;
  bookings: MateBooking[];
};

export type CheckInQueueEntry = {
  localId: string;
  ticketId: string;
  tripId: string;
  method: 'qr' | 'name_search' | 'manual';
  note: string | null;
  checkedInAt: string;
  synced: boolean;
  syncError: string | null;
};

// ─── DB init ─────────────────────────────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync('mate.db');
    await _db.execAsync(`
      CREATE TABLE IF NOT EXISTS mate_trips (
        id TEXT PRIMARY KEY,
        raw_json TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mate_manifests (
        trip_id TEXT PRIMARY KEY,
        raw_json TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mate_checkin_queue (
        local_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        trip_id TEXT NOT NULL,
        method TEXT NOT NULL,
        note TEXT,
        checked_in_at TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        sync_error TEXT
      );
    `);
  }
  return _db;
}

// ─── Trips cache ─────────────────────────────────────────────────────────────

export async function cacheTrips(tripList: MateTrip[]): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM mate_trips');
    for (const trip of tripList) {
      await db.runAsync(
        'INSERT INTO mate_trips (id, raw_json, cached_at) VALUES (?, ?, ?)',
        [trip.id, JSON.stringify(trip), now]
      );
    }
  });
}

export async function getCachedTrips(): Promise<MateTrip[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ raw_json: string }>(
    'SELECT raw_json FROM mate_trips ORDER BY rowid'
  );
  return rows.map((r) => JSON.parse(r.raw_json) as MateTrip);
}

// ─── Manifest cache ───────────────────────────────────────────────────────────

export async function cacheManifest(tripId: string, manifest: MateManifest): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO mate_manifests (trip_id, raw_json, cached_at) VALUES (?, ?, ?)
     ON CONFLICT(trip_id) DO UPDATE SET raw_json = excluded.raw_json, cached_at = excluded.cached_at`,
    [tripId, JSON.stringify(manifest), now]
  );
}

export async function getCachedManifest(tripId: string): Promise<MateManifest | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ raw_json: string }>(
    'SELECT raw_json FROM mate_manifests WHERE trip_id = ?',
    [tripId]
  );
  return row ? (JSON.parse(row.raw_json) as MateManifest) : null;
}

// ─── Check-in queue ───────────────────────────────────────────────────────────

export async function queueCheckIn(
  entry: Omit<CheckInQueueEntry, 'synced' | 'syncError'>
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO mate_checkin_queue
       (local_id, ticket_id, trip_id, method, note, checked_in_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [
      entry.localId,
      entry.ticketId,
      entry.tripId,
      entry.method,
      entry.note ?? null,
      entry.checkedInAt,
    ]
  );
}

export async function getUnsyncedCheckIns(): Promise<CheckInQueueEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    local_id: string;
    ticket_id: string;
    trip_id: string;
    method: string;
    note: string | null;
    checked_in_at: string;
    sync_error: string | null;
  }>('SELECT * FROM mate_checkin_queue WHERE synced = 0');
  return rows.map((r) => ({
    localId: r.local_id,
    ticketId: r.ticket_id,
    tripId: r.trip_id,
    method: r.method as 'qr' | 'name_search' | 'manual',
    note: r.note,
    checkedInAt: r.checked_in_at,
    synced: false,
    syncError: r.sync_error,
  }));
}

export async function markCheckInSynced(localId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE mate_checkin_queue SET synced = 1 WHERE local_id = ?',
    [localId]
  );
}

export async function markCheckInError(localId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE mate_checkin_queue SET sync_error = ? WHERE local_id = ?',
    [error, localId]
  );
}

export async function getLocalCheckedInTickets(tripId: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ ticket_id: string }>(
    'SELECT ticket_id FROM mate_checkin_queue WHERE trip_id = ?',
    [tripId]
  );
  return new Set(rows.map((r) => r.ticket_id));
}
