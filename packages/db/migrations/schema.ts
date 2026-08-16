import {
  pgTable,
  foreignKey,
  unique,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  date,
  integer,
  jsonb,
  time,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const bookingStatus = pgEnum("booking_status", ["pending", "confirmed", "cancelled"]);
export const checkInMethod = pgEnum("check_in_method", ["qr", "name_search", "manual"]);
export const dayOfWeek = pgEnum("day_of_week", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const feeBearer = pgEnum("fee_bearer", ["passenger", "operator"]);
export const feeDisplay = pgEnum("fee_display", ["itemized", "folded"]);
export const feeStatus = pgEnum("fee_status", ["held", "earned", "reversed"]);
export const staffRole = pgEnum("staff_role", ["admin", "mate"]);
export const ticketType = pgEnum("ticket_type", ["adult", "child", "senior"]);
export const tripStatus = pgEnum("trip_status", [
  "scheduled",
  "pending_settlement",
  "sailed",
  "cancelled",
]);

export const staff = pgTable(
  "staff",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    name: text().notNull(),
    email: text().notNull(),
    pinHash: text("pin_hash"),
    passwordHash: text("password_hash"),
    role: staffRole().notNull(),
    vesselId: uuid("vessel_id"),
    active: boolean().default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "staff_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.vesselId],
      foreignColumns: [vessels.id],
      name: "staff_vessel_id_vessels_id_fk",
    }),
    unique("staff_operator_id_email_unique").on(table.operatorId, table.email),
  ],
);

export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    ticketId: uuid("ticket_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    operatorId: uuid("operator_id").notNull(),
    staffId: uuid("staff_id"),
    method: checkInMethod().notNull(),
    note: text(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("check_ins_trip_idx").using("btree", table.tripId.asc().nullsLast().op("uuid_ops")),
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "check_ins_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: "check_ins_staff_id_staff_id_fk",
    }),
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
      name: "check_ins_ticket_id_tickets_id_fk",
    }),
    foreignKey({
      columns: [table.tripId],
      foreignColumns: [trips.id],
      name: "check_ins_trip_id_trips_id_fk",
    }),
    unique("check_ins_ticket_id_unique").on(table.ticketId),
  ],
);

export const holidayDates = pgTable(
  "holiday_dates",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    date: date().notNull(),
    label: text().notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "holiday_dates_operator_id_operators_id_fk",
    }),
    unique("holiday_dates_operator_id_date_unique").on(table.operatorId, table.date),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    bookingId: uuid("booking_id").notNull(),
    operatorId: uuid("operator_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull(),
    stripeChargeId: text("stripe_charge_id"),
    stripeTransferId: text("stripe_transfer_id"),
    applicationFeeId: text("application_fee_id"),
    amountCents: integer("amount_cents").notNull(),
    applicationFeeCents: integer("application_fee_cents").notNull(),
    currency: text().default("usd").notNull(),
    status: text().notNull(),
    metadata: jsonb(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.bookingId],
      foreignColumns: [bookings.id],
      name: "payments_booking_id_bookings_id_fk",
    }),
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "payments_operator_id_operators_id_fk",
    }),
    unique("payments_booking_id_unique").on(table.bookingId),
    unique("payments_stripe_payment_intent_id_unique").on(table.stripePaymentIntentId),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    email: text().notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text(),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "customers_operator_id_operators_id_fk",
    }),
    unique("customers_operator_id_email_unique").on(table.operatorId, table.email),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    vesselId: uuid("vessel_id").notNull(),
    category: text().notNull(),
    displayName: text("display_name").notNull(),
    description: text(),
    imageUrl: text("image_url"),
    showRemaining: boolean("show_remaining").default(false).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "products_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.vesselId],
      foreignColumns: [vessels.id],
      name: "products_vessel_id_vessels_id_fk",
    }),
  ],
);

export const schedulePrices = pgTable(
  "schedule_prices",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    operatorId: uuid("operator_id").notNull(),
    ticketType: ticketType("ticket_type").notNull(),
    priceCents: integer("price_cents").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("schedule_prices_schedule_idx").using(
      "btree",
      table.scheduleId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "schedule_prices_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.scheduleId],
      foreignColumns: [schedules.id],
      name: "schedule_prices_schedule_id_schedules_id_fk",
    }),
    unique("schedule_prices_schedule_id_ticket_type_unique").on(table.ticketType, table.scheduleId),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    bookingItemId: uuid("booking_item_id").notNull(),
    bookingId: uuid("booking_id").notNull(),
    operatorId: uuid("operator_id").notNull(),
    ticketType: ticketType("ticket_type").notNull(),
    priceCents: integer("price_cents").notNull(),
    passengerName: text("passenger_name"),
    qrPayload: text("qr_payload").notNull(),
    voided: boolean().default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    feeAmountCents: integer("fee_amount_cents").default(150).notNull(),
    feeStatus: feeStatus("fee_status").default("held").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.bookingId],
      foreignColumns: [bookings.id],
      name: "tickets_booking_id_bookings_id_fk",
    }),
    foreignKey({
      columns: [table.bookingItemId],
      foreignColumns: [bookingItems.id],
      name: "tickets_booking_item_id_booking_items_id_fk",
    }),
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "tickets_operator_id_operators_id_fk",
    }),
  ],
);

export const domains = pgTable(
  "domains",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    domain: text().notNull(),
    primary: boolean().default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "domains_operator_id_operators_id_fk",
    }),
    unique("domains_domain_unique").on(table.domain),
  ],
);

export const productPrices = pgTable(
  "product_prices",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    productId: uuid("product_id").notNull(),
    ticketType: ticketType("ticket_type").notNull(),
    priceCents: integer("price_cents").notNull(),
    active: boolean().default(true).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: "product_prices_product_id_products_id_fk",
    }),
    unique("product_prices_product_id_ticket_type_unique").on(table.ticketType, table.productId),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    productId: uuid("product_id").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    daysOfWeek: dayOfWeek("days_of_week").array().notNull(),
    departureTime: time("departure_time").notNull(),
    returnTime: time("return_time").notNull(),
    capacity: integer().notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "schedules_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: "schedules_product_id_products_id_fk",
    }),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    customerId: uuid("customer_id"),
    confirmationCode: text("confirmation_code").notNull(),
    status: bookingStatus().default("pending").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    totalCents: integer("total_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    notes: text(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    groupDiscountCents: integer("group_discount_cents").default(0).notNull(),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { mode: "string" }),
  },
  (table) => [
    index("bookings_operator_status_idx").using(
      "btree",
      table.operatorId.asc().nullsLast().op("enum_ops"),
      table.status.asc().nullsLast().op("uuid_ops"),
    ),
    index("bookings_payment_intent_idx").using(
      "btree",
      table.stripePaymentIntentId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "bookings_customer_id_customers_id_fk",
    }),
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "bookings_operator_id_operators_id_fk",
    }),
    unique("bookings_confirmation_code_unique").on(table.confirmationCode),
    unique("bookings_stripe_payment_intent_id_unique").on(table.stripePaymentIntentId),
  ],
);

export const tripOverrides = pgTable(
  "trip_overrides",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    tripId: uuid("trip_id").notNull(),
    operatorId: uuid("operator_id").notNull(),
    cancelled: boolean(),
    capacityOverride: integer("capacity_override"),
    reason: text(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "trip_overrides_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.tripId],
      foreignColumns: [trips.id],
      name: "trip_overrides_trip_id_trips_id_fk",
    }),
  ],
);

export const bookingItems = pgTable(
  "booking_items",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    bookingId: uuid("booking_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    operatorId: uuid("operator_id").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("booking_items_booking_idx").using(
      "btree",
      table.bookingId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.bookingId],
      foreignColumns: [bookings.id],
      name: "booking_items_booking_id_bookings_id_fk",
    }),
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "booking_items_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.tripId],
      foreignColumns: [trips.id],
      name: "booking_items_trip_id_trips_id_fk",
    }),
  ],
);

export const trips = pgTable(
  "trips",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    productId: uuid("product_id").notNull(),
    vesselId: uuid("vessel_id").notNull(),
    departureDate: date("departure_date").notNull(),
    startTime: timestamp("start_time", { withTimezone: true, mode: "string" }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true, mode: "string" }).notNull(),
    capacity: integer().notNull(),
    seatsRemaining: integer("seats_remaining").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    status: tripStatus().default("scheduled").notNull(),
    sailedAt: timestamp("sailed_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancellationReason: text("cancellation_reason"),
    boardingTime: time("boarding_time"),
    durationDay: integer("duration_day").default(0).notNull(),
    durationHr: integer("duration_hr"),
    durationMin: integer("duration_min"),
    onlineCutoff: timestamp("online_cutoff", { withTimezone: true, mode: "string" }),
    depositPercentage: integer("deposit_percentage"),
  },
  (table) => [
    index("trips_operator_date_idx").using(
      "btree",
      table.operatorId.asc().nullsLast().op("date_ops"),
      table.departureDate.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "trips_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: "trips_product_id_products_id_fk",
    }),
    foreignKey({
      columns: [table.scheduleId],
      foreignColumns: [schedules.id],
      name: "trips_schedule_id_schedules_id_fk",
    }),
    foreignKey({
      columns: [table.vesselId],
      foreignColumns: [vessels.id],
      name: "trips_vessel_id_vessels_id_fk",
    }),
    unique("trips_schedule_id_departure_date_unique").on(table.scheduleId, table.departureDate),
  ],
);

export const vessels = pgTable(
  "vessels",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    color: text().notNull(),
    capacity: integer().notNull(),
    description: text(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    groupDiscountThreshold: integer("group_discount_threshold"),
    groupDiscountPct: integer("group_discount_pct"),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "vessels_operator_id_operators_id_fk",
    }),
    unique("vessels_operator_id_slug_unique").on(table.slug, table.operatorId),
  ],
);

export const operators = pgTable(
  "operators",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    stripeAccountId: text("stripe_account_id"),
    stripeOnboardingComplete: boolean("stripe_onboarding_complete").default(false).notNull(),
    emailFrom: text("email_from").notNull(),
    emailDomain: text("email_domain").notNull(),
    twilioFromNumber: text("twilio_from_number"),
    termsUrl: text("terms_url"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    feeBearer: feeBearer("fee_bearer").default("passenger").notNull(),
    feeDisplay: feeDisplay("fee_display").default("itemized").notNull(),
    cancelWindowHrs: integer("cancel_window_hrs").default(48).notNull(),
    settleGraceHrs: integer("settle_grace_hrs").default(48).notNull(),
    phone: text(),
    dockAddress: text("dock_address"),
    dockMapsUrl: text("dock_maps_url"),
  },
  (table) => [unique("operators_slug_unique").on(table.slug)],
);

export const fishingReports = pgTable(
  "fishing_reports",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    vesselId: uuid("vessel_id").notNull(),
    staffId: uuid("staff_id"),
    catchSummary: text("catch_summary"),
    fishCounts: jsonb("fish_counts").default([]).notNull(),
    photoUrls: text("photo_urls").array().default([""]).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("fishing_reports_operator_idx").using(
      "btree",
      table.operatorId.asc().nullsLast().op("uuid_ops"),
    ),
    index("fishing_reports_vessel_idx").using(
      "btree",
      table.vesselId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "fishing_reports_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.tripId],
      foreignColumns: [trips.id],
      name: "fishing_reports_trip_id_trips_id_fk",
    }),
    foreignKey({
      columns: [table.vesselId],
      foreignColumns: [vessels.id],
      name: "fishing_reports_vessel_id_vessels_id_fk",
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: "fishing_reports_staff_id_staff_id_fk",
    }),
    unique("fishing_reports_trip_id_unique").on(table.tripId),
  ],
);

export const magicLinkOtps = pgTable(
  "magic_link_otps",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    email: text().notNull(),
    otpHash: text("otp_hash").notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    used: boolean().default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "magic_link_otps_operator_id_operators_id_fk",
    }),
  ],
);

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    operatorId: uuid("operator_id").notNull(),
    expoToken: text("expo_token").notNull(),
    customerId: uuid("customer_id"),
    customerEmail: text("customer_email"),
    active: boolean().default(true).notNull(),
    notifyReminders: boolean("notify_reminders").default(true).notNull(),
    notifyCancellations: boolean("notify_cancellations").default(true).notNull(),
    notifyConfirmations: boolean("notify_confirmations").default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorId],
      foreignColumns: [operators.id],
      name: "push_tokens_operator_id_operators_id_fk",
    }),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "push_tokens_customer_id_customers_id_fk",
    }),
    unique("push_tokens_operator_id_expo_token_unique").on(table.operatorId, table.expoToken),
  ],
);
