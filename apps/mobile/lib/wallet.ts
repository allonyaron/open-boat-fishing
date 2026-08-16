import * as SQLite from "expo-sqlite";

// ─── Types ────────────────────────────────────────────────────────────────────
// Mirror the shape returned by GET /api/bookings, plus a syncedAt timestamp
// added by this layer.

export type WalletTicket = {
  id: string;
  ticketType: "adult" | "child" | "senior";
  priceCents: number;
  feeAmountCents: number;
  qrPayload: string;
  voided: boolean;
};

export type WalletBookingItem = {
  id: string;
  tripId: string;
  subtotalCents: number;
  trip: {
    id: string;
    startTime: string;
    endTime: string;
    departureDate: string;
    boardingTime: string | null;
    status: string;
    vessel: { id: string; name: string; color: string };
    product: { id: string; displayName: string; category: string };
  };
  tickets: WalletTicket[];
};

export type WalletBooking = {
  id: string;
  confirmationCode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  totalCents: number;
  groupDiscountCents: number;
  createdAt: string;
  items: WalletBookingItem[];
  syncedAt: string;
};

// ─── DB init ─────────────────────────────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync("wallet.db");
    await _db.execAsync(`
      CREATE TABLE IF NOT EXISTS wallet_bookings (
        id TEXT PRIMARY KEY,
        confirmation_code TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
    `);
  }
  return _db;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function upsertBooking(
  booking: Omit<WalletBooking, "syncedAt">,
): Promise<WalletBooking> {
  const db = await getDb();
  const syncedAt = new Date().toISOString();
  const record: WalletBooking = { ...booking, syncedAt };
  await db.runAsync(
    `INSERT INTO wallet_bookings (id, confirmation_code, customer_email, synced_at, raw_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       synced_at = excluded.synced_at,
       raw_json = excluded.raw_json`,
    [booking.id, booking.confirmationCode, booking.customerEmail, syncedAt, JSON.stringify(record)],
  );
  return record;
}

export async function getAllBookings(): Promise<WalletBooking[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ raw_json: string }>(
    "SELECT raw_json FROM wallet_bookings ORDER BY id",
  );
  return rows.map((r) => JSON.parse(r.raw_json) as WalletBooking);
}

export async function getTicketById(
  ticketId: string,
): Promise<{ booking: WalletBooking; item: WalletBookingItem; ticket: WalletTicket } | null> {
  const bookings = await getAllBookings();
  for (const booking of bookings) {
    for (const item of booking.items) {
      const ticket = item.tickets.find((t) => t.id === ticketId);
      if (ticket) return { booking, item, ticket };
    }
  }
  return null;
}

export async function removeBooking(bookingId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM wallet_bookings WHERE id = ?", [bookingId]);
}
