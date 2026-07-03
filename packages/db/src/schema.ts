import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  time,
  date,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const staffRoleEnum = pgEnum("staff_role", ["admin", "mate"]);
export const dayOfWeekEnum = pgEnum("day_of_week", [
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",    // payment not yet confirmed
  "confirmed",  // payment_intent.succeeded received
  "cancelled",  // refunded or admin-cancelled
]);
export const ticketTypeEnum = pgEnum("ticket_type", [
  "adult", "child", "senior",
]);
export const checkInMethodEnum = pgEnum("check_in_method", [
  "qr", "name_search", "manual",
]);

// ─── Operators ─────────────────────────────────────────────────────────────────
// One row per fishing boat business. In production each deployment has exactly
// one row — the client that owns this deployment.

export const operators = pgTable("operators", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  stripeAccountId: text("stripe_account_id"),        // Stripe Connect account
  stripeOnboardingComplete: boolean("stripe_onboarding_complete").notNull().default(false),
  emailFrom: text("email_from").notNull(),            // e.g. office@oceansidecharters.example.com
  emailDomain: text("email_domain").notNull(),        // e.g. oceansidecharters.example.com
  twilioFromNumber: text("twilio_from_number"),
  termsUrl: text("terms_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Vessels ──────────────────────────────────────────────────────────────────

export const vessels = pgTable("vessels", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  color: text("color").notNull(),                    // hex, e.g. "#1D4ED8" (blue for Blue Wave)
  capacity: integer("capacity").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique().on(t.operatorId, t.slug),
]);

// ─── Products ─────────────────────────────────────────────────────────────────
// Trip type per vessel (e.g. "Sea Bass Fishing Express" on Blue Wave Express).
// category = fish species label ("Sea Bass"), displayName = full name shown in UI.

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  vesselId: uuid("vessel_id").notNull().references(() => vessels.id),
  category: text("category").notNull(),              // "Sea Bass", "Fluke", "Night Stripers"
  displayName: text("display_name").notNull(),       // "Sea Bass Fishing Express"
  description: text("description"),
  imageUrl: text("image_url"),
  showRemaining: boolean("show_remaining").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Product Prices ───────────────────────────────────────────────────────────
// Per-ticket-type pricing within a product. Adult, Child, Senior each get a row.

export const productPrices = pgTable("product_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  ticketType: ticketTypeEnum("ticket_type").notNull(),
  priceCents: integer("price_cents").notNull(),       // e.g. 6800 = $68.00
  active: boolean("active").notNull().default(true),
}, (t) => [
  unique().on(t.productId, t.ticketType),
]);

// ─── Schedules ────────────────────────────────────────────────────────────────
// Recurring patterns. Trips are materialized from these on save.

export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  daysOfWeek: dayOfWeekEnum("days_of_week").array().notNull(),
  departureTime: time("departure_time").notNull(),
  returnTime: time("return_time").notNull(),          // fishing trips span 4-5 hours
  capacity: integer("capacity").notNull(),            // can differ from vessel default
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Trips ────────────────────────────────────────────────────────────────────
// Materialized individual departures. Written by the materialize-on-save logic
// and the admin re-materialize action. (schedule_id, departure_date) is unique.

export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  scheduleId: uuid("schedule_id").notNull().references(() => schedules.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  vesselId: uuid("vessel_id").notNull().references(() => vessels.id),
  departureDate: date("departure_date").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  capacity: integer("capacity").notNull(),
  seatsRemaining: integer("seats_remaining").notNull(),
  cancelled: boolean("cancelled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique().on(t.scheduleId, t.departureDate),
  index("trips_operator_date_idx").on(t.operatorId, t.departureDate),
]);

// ─── Trip Overrides ───────────────────────────────────────────────────────────
// Admin-applied exceptions: cancellations or capacity changes for a specific trip.

export const tripOverrides = pgTable("trip_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => trips.id),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  cancelled: boolean("cancelled"),
  capacityOverride: integer("capacity_override"),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Customers ────────────────────────────────────────────────────────────────
// Consumer-facing accounts. Email-based auth. Separate from staff — incompatible
// login mechanisms and different data (order history vs. boat assignment).

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  email: text("email").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash"),               // null = guest checkout
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique().on(t.operatorId, t.email),
]);

// ─── Staff ────────────────────────────────────────────────────────────────────
// Admin and mate accounts. PIN-based auth (mates use tablet at gangway).

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  pinHash: text("pin_hash"),                         // for mate tablet login
  passwordHash: text("password_hash"),               // for admin web login
  role: staffRoleEnum("role").notNull(),
  vesselId: uuid("vessel_id").references(() => vessels.id), // mates assigned to a boat
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique().on(t.operatorId, t.email),
]);

// ─── Bookings ────────────────────────────────────────────────────────────────
// One per customer purchase session. Can span multiple trips (multi-trip cart).
// Tickets hang off booking_items, not directly off bookings.

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  customerId: uuid("customer_id").references(() => customers.id), // null = guest
  confirmationCode: text("confirmation_code").notNull().unique(),  // 6-char alphanumeric
  status: bookingStatusEnum("status").notNull().default("pending"),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  totalCents: integer("total_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),       // $2.50 × ticket count
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("bookings_operator_status_idx").on(t.operatorId, t.status),
  index("bookings_payment_intent_idx").on(t.stripePaymentIntentId),
]);

// ─── Booking Items ────────────────────────────────────────────────────────────
// One row per trip within a booking (multi-trip cart support).

export const bookingItems = pgTable("booking_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  tripId: uuid("trip_id").notNull().references(() => trips.id),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  subtotalCents: integer("subtotal_cents").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("booking_items_booking_idx").on(t.bookingId),
]);

// ─── Tickets ──────────────────────────────────────────────────────────────────
// One per passenger. Hangs off a booking_item (which points at the trip).

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingItemId: uuid("booking_item_id").notNull().references(() => bookingItems.id),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  ticketType: ticketTypeEnum("ticket_type").notNull(),
  priceCents: integer("price_cents").notNull(),
  passengerName: text("passenger_name"),
  qrPayload: text("qr_payload").notNull(),           // encodes ticket id for scanning
  voided: boolean("voided").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Check-ins ────────────────────────────────────────────────────────────────

export const checkIns = pgTable("check_ins", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id),
  tripId: uuid("trip_id").notNull().references(() => trips.id),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  staffId: uuid("staff_id").references(() => staff.id),
  method: checkInMethodEnum("method").notNull(),
  note: text("note"),                                // for manual override (walk-ups, comps)
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),  // null = originated offline
}, (t) => [
  unique().on(t.ticketId),                           // one check-in per ticket
  index("check_ins_trip_idx").on(t.tripId),
]);

// ─── Payments ─────────────────────────────────────────────────────────────────
// Stripe payment record. Written after payment_intent.succeeded webhook.

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id).unique(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
  stripeChargeId: text("stripe_charge_id"),
  stripeTransferId: text("stripe_transfer_id"),
  applicationFeeId: text("application_fee_id"),
  amountCents: integer("amount_cents").notNull(),
  applicationFeeCents: integer("application_fee_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Domains ──────────────────────────────────────────────────────────────────
// Domain → operator_id mapping. Captree has two domains (your-domain.com +
// your-domain.com) both pointing at the same operator record.

export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  domain: text("domain").notNull().unique(),         // e.g. "your-domain.com"
  primary: boolean("primary").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const operatorsRelations = relations(operators, ({ many }) => ({
  vessels: many(vessels),
  products: many(products),
  schedules: many(schedules),
  trips: many(trips),
  customers: many(customers),
  staff: many(staff),
  bookings: many(bookings),
  domains: many(domains),
}));

export const vesselsRelations = relations(vessels, ({ one, many }) => ({
  operator: one(operators, { fields: [vessels.operatorId], references: [operators.id] }),
  products: many(products),
  trips: many(trips),
  staff: many(staff),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  operator: one(operators, { fields: [products.operatorId], references: [operators.id] }),
  vessel: one(vessels, { fields: [products.vesselId], references: [vessels.id] }),
  prices: many(productPrices),
  schedules: many(schedules),
  trips: many(trips),
}));

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  product: one(products, { fields: [productPrices.productId], references: [products.id] }),
}));

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  operator: one(operators, { fields: [schedules.operatorId], references: [operators.id] }),
  product: one(products, { fields: [schedules.productId], references: [products.id] }),
  trips: many(trips),
}));

export const tripsRelations = relations(trips, ({ one, many }) => ({
  operator: one(operators, { fields: [trips.operatorId], references: [operators.id] }),
  schedule: one(schedules, { fields: [trips.scheduleId], references: [schedules.id] }),
  product: one(products, { fields: [trips.productId], references: [products.id] }),
  vessel: one(vessels, { fields: [trips.vesselId], references: [vessels.id] }),
  overrides: many(tripOverrides),
  bookingItems: many(bookingItems),
  checkIns: many(checkIns),
}));

export const tripOverridesRelations = relations(tripOverrides, ({ one }) => ({
  trip: one(trips, { fields: [tripOverrides.tripId], references: [trips.id] }),
  operator: one(operators, { fields: [tripOverrides.operatorId], references: [operators.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  operator: one(operators, { fields: [customers.operatorId], references: [operators.id] }),
  bookings: many(bookings),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  operator: one(operators, { fields: [staff.operatorId], references: [operators.id] }),
  vessel: one(vessels, { fields: [staff.vesselId], references: [vessels.id] }),
  checkIns: many(checkIns),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  operator: one(operators, { fields: [bookings.operatorId], references: [operators.id] }),
  customer: one(customers, { fields: [bookings.customerId], references: [customers.id] }),
  items: many(bookingItems),
  tickets: many(tickets),
  payment: one(payments, { fields: [bookings.id], references: [payments.bookingId] }),
}));

export const bookingItemsRelations = relations(bookingItems, ({ one, many }) => ({
  booking: one(bookings, { fields: [bookingItems.bookingId], references: [bookings.id] }),
  trip: one(trips, { fields: [bookingItems.tripId], references: [trips.id] }),
  operator: one(operators, { fields: [bookingItems.operatorId], references: [operators.id] }),
  tickets: many(tickets),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
  bookingItem: one(bookingItems, { fields: [tickets.bookingItemId], references: [bookingItems.id] }),
  booking: one(bookings, { fields: [tickets.bookingId], references: [bookings.id] }),
  operator: one(operators, { fields: [tickets.operatorId], references: [operators.id] }),
  checkIn: one(checkIns, { fields: [tickets.id], references: [checkIns.ticketId] }),
}));

export const checkInsRelations = relations(checkIns, ({ one }) => ({
  ticket: one(tickets, { fields: [checkIns.ticketId], references: [tickets.id] }),
  trip: one(trips, { fields: [checkIns.tripId], references: [trips.id] }),
  operator: one(operators, { fields: [checkIns.operatorId], references: [operators.id] }),
  staff: one(staff, { fields: [checkIns.staffId], references: [staff.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  booking: one(bookings, { fields: [payments.bookingId], references: [bookings.id] }),
  operator: one(operators, { fields: [payments.operatorId], references: [operators.id] }),
}));

export const domainsRelations = relations(domains, ({ one }) => ({
  operator: one(operators, { fields: [domains.operatorId], references: [operators.id] }),
}));
