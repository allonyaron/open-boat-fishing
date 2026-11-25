import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import {
  bookingKey,
  verifyBookingKey,
  bookingLinksOpen,
  boardingPassPath,
  confirmationPagePath,
  BOOKING_LINK_DAYS_AFTER_TRIP,
} from "@/lib/bookings/booking-key";
import { signHoldToken } from "@/lib/bookings/hold-token";

const bookingId = randomUUID();
const operatorId = randomUUID();
const DAY = 24 * 60 * 60 * 1000;

describe("booking keys", () => {
  it("verifies for the booking and operator it was made for", () => {
    expect(verifyBookingKey(bookingKey(operatorId, bookingId), operatorId, bookingId)).toBe(true);
  });

  it("rejects another booking's key", () => {
    expect(verifyBookingKey(bookingKey(operatorId, randomUUID()), operatorId, bookingId)).toBe(false);
  });

  it("rejects the key under another operator", () => {
    expect(verifyBookingKey(bookingKey(operatorId, bookingId), randomUUID(), bookingId)).toBe(false);
  });

  it("rejects a missing, empty, truncated or non-string key", () => {
    const key = bookingKey(operatorId, bookingId);
    for (const bad of [undefined, null, "", key.slice(0, -1), `${key}x`, ["a"], 42]) {
      expect(verifyBookingKey(bad, operatorId, bookingId)).toBe(false);
    }
  });

  it("isn't a hold token's signature, or the hold token itself", () => {
    const hold = signHoldToken({ bookingId, operatorId });
    expect(verifyBookingKey(hold, operatorId, bookingId)).toBe(false);
    expect(verifyBookingKey(hold.split(".")[1], operatorId, bookingId)).toBe(false);
  });

  it("puts the key in the boarding and confirmation links", () => {
    const key = bookingKey(operatorId, bookingId);
    expect(boardingPassPath(operatorId, bookingId)).toBe(`/boarding/${bookingId}?k=${key}`);
    expect(confirmationPagePath("AB12CD", operatorId, bookingId)).toBe(`/booking/confirmation?code=AB12CD&k=${key}`);
  });
});

describe("bookingLinksOpen", () => {
  const ends = new Date("2026-07-04T20:00:00Z");

  it("is open before and up to the window after the last trip ends", () => {
    expect(bookingLinksOpen(ends, new Date(ends.getTime() - 30 * DAY))).toBe(true);
    expect(bookingLinksOpen(ends, new Date(ends.getTime() + BOOKING_LINK_DAYS_AFTER_TRIP * DAY))).toBe(true);
  });

  it("closes once the window has passed", () => {
    expect(bookingLinksOpen(ends, new Date(ends.getTime() + BOOKING_LINK_DAYS_AFTER_TRIP * DAY + 1))).toBe(false);
  });
});
