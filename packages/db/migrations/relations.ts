import { relations } from "drizzle-orm/relations";
import {
  operators,
  staff,
  vessels,
  checkIns,
  tickets,
  trips,
  holidayDates,
  bookings,
  payments,
  customers,
  products,
  schedulePrices,
  schedules,
  bookingItems,
  domains,
  productPrices,
  tripOverrides,
  fishingReports,
  magicLinkOtps,
  pushTokens,
} from "./schema";

export const staffRelations = relations(staff, ({ one, many }) => ({
  operator: one(operators, {
    fields: [staff.operatorId],
    references: [operators.id],
  }),
  vessel: one(vessels, {
    fields: [staff.vesselId],
    references: [vessels.id],
  }),
  checkIns: many(checkIns),
  fishingReports: many(fishingReports),
}));

export const operatorsRelations = relations(operators, ({ many }) => ({
  staff: many(staff),
  checkIns: many(checkIns),
  holidayDates: many(holidayDates),
  payments: many(payments),
  customers: many(customers),
  products: many(products),
  schedulePrices: many(schedulePrices),
  tickets: many(tickets),
  domains: many(domains),
  schedules: many(schedules),
  bookings: many(bookings),
  tripOverrides: many(tripOverrides),
  bookingItems: many(bookingItems),
  trips: many(trips),
  vessels: many(vessels),
  fishingReports: many(fishingReports),
  magicLinkOtps: many(magicLinkOtps),
  pushTokens: many(pushTokens),
}));

export const vesselsRelations = relations(vessels, ({ one, many }) => ({
  staff: many(staff),
  products: many(products),
  trips: many(trips),
  operator: one(operators, {
    fields: [vessels.operatorId],
    references: [operators.id],
  }),
  fishingReports: many(fishingReports),
}));

export const checkInsRelations = relations(checkIns, ({ one }) => ({
  operator: one(operators, {
    fields: [checkIns.operatorId],
    references: [operators.id],
  }),
  staff: one(staff, {
    fields: [checkIns.staffId],
    references: [staff.id],
  }),
  ticket: one(tickets, {
    fields: [checkIns.ticketId],
    references: [tickets.id],
  }),
  trip: one(trips, {
    fields: [checkIns.tripId],
    references: [trips.id],
  }),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  checkIns: many(checkIns),
  booking: one(bookings, {
    fields: [tickets.bookingId],
    references: [bookings.id],
  }),
  bookingItem: one(bookingItems, {
    fields: [tickets.bookingItemId],
    references: [bookingItems.id],
  }),
  operator: one(operators, {
    fields: [tickets.operatorId],
    references: [operators.id],
  }),
}));

export const tripsRelations = relations(trips, ({ one, many }) => ({
  checkIns: many(checkIns),
  tripOverrides: many(tripOverrides),
  bookingItems: many(bookingItems),
  operator: one(operators, {
    fields: [trips.operatorId],
    references: [operators.id],
  }),
  product: one(products, {
    fields: [trips.productId],
    references: [products.id],
  }),
  schedule: one(schedules, {
    fields: [trips.scheduleId],
    references: [schedules.id],
  }),
  vessel: one(vessels, {
    fields: [trips.vesselId],
    references: [vessels.id],
  }),
  fishingReports: many(fishingReports),
}));

export const holidayDatesRelations = relations(holidayDates, ({ one }) => ({
  operator: one(operators, {
    fields: [holidayDates.operatorId],
    references: [operators.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  booking: one(bookings, {
    fields: [payments.bookingId],
    references: [bookings.id],
  }),
  operator: one(operators, {
    fields: [payments.operatorId],
    references: [operators.id],
  }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  payments: many(payments),
  tickets: many(tickets),
  customer: one(customers, {
    fields: [bookings.customerId],
    references: [customers.id],
  }),
  operator: one(operators, {
    fields: [bookings.operatorId],
    references: [operators.id],
  }),
  bookingItems: many(bookingItems),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  operator: one(operators, {
    fields: [customers.operatorId],
    references: [operators.id],
  }),
  bookings: many(bookings),
  pushTokens: many(pushTokens),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  operator: one(operators, {
    fields: [products.operatorId],
    references: [operators.id],
  }),
  vessel: one(vessels, {
    fields: [products.vesselId],
    references: [vessels.id],
  }),
  productPrices: many(productPrices),
  schedules: many(schedules),
  trips: many(trips),
}));

export const schedulePricesRelations = relations(schedulePrices, ({ one }) => ({
  operator: one(operators, {
    fields: [schedulePrices.operatorId],
    references: [operators.id],
  }),
  schedule: one(schedules, {
    fields: [schedulePrices.scheduleId],
    references: [schedules.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  schedulePrices: many(schedulePrices),
  operator: one(operators, {
    fields: [schedules.operatorId],
    references: [operators.id],
  }),
  product: one(products, {
    fields: [schedules.productId],
    references: [products.id],
  }),
  trips: many(trips),
}));

export const bookingItemsRelations = relations(bookingItems, ({ one, many }) => ({
  tickets: many(tickets),
  booking: one(bookings, {
    fields: [bookingItems.bookingId],
    references: [bookings.id],
  }),
  operator: one(operators, {
    fields: [bookingItems.operatorId],
    references: [operators.id],
  }),
  trip: one(trips, {
    fields: [bookingItems.tripId],
    references: [trips.id],
  }),
}));

export const domainsRelations = relations(domains, ({ one }) => ({
  operator: one(operators, {
    fields: [domains.operatorId],
    references: [operators.id],
  }),
}));

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  product: one(products, {
    fields: [productPrices.productId],
    references: [products.id],
  }),
}));

export const tripOverridesRelations = relations(tripOverrides, ({ one }) => ({
  operator: one(operators, {
    fields: [tripOverrides.operatorId],
    references: [operators.id],
  }),
  trip: one(trips, {
    fields: [tripOverrides.tripId],
    references: [trips.id],
  }),
}));

export const fishingReportsRelations = relations(fishingReports, ({ one }) => ({
  operator: one(operators, {
    fields: [fishingReports.operatorId],
    references: [operators.id],
  }),
  trip: one(trips, {
    fields: [fishingReports.tripId],
    references: [trips.id],
  }),
  vessel: one(vessels, {
    fields: [fishingReports.vesselId],
    references: [vessels.id],
  }),
  staff: one(staff, {
    fields: [fishingReports.staffId],
    references: [staff.id],
  }),
}));

export const magicLinkOtpsRelations = relations(magicLinkOtps, ({ one }) => ({
  operator: one(operators, {
    fields: [magicLinkOtps.operatorId],
    references: [operators.id],
  }),
}));

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  operator: one(operators, {
    fields: [pushTokens.operatorId],
    references: [operators.id],
  }),
  customer: one(customers, {
    fields: [pushTokens.customerId],
    references: [customers.id],
  }),
}));
