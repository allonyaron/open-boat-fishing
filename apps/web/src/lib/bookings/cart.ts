import { z } from "zod";
import { isOnlineSalesOpen } from "@/lib/trips/online-sales";

/** A cart as POST /api/bookings and POST /api/bookings/quote accept it. */
export const cartSchema = z
  .array(
    z.object({
      tripId: z.string().uuid(),
      tickets: z
        .array(
          z.object({
            ticketType: z.enum(["adult", "child", "senior"]),
            quantity: z.number().int().min(1).max(30),
          }),
        )
        .min(1)
        .max(10),
    }),
  )
  .min(1)
  .max(10)
  .refine((items) => new Set(items.map((i) => i.tripId)).size === items.length, {
    message: "Duplicate tripId in cart",
  });

export type Cart = z.infer<typeof cartSchema>;

/** Seats requested per trip. */
export function seatsByTrip(cart: Cart): Record<string, number> {
  const seats: Record<string, number> = {};
  for (const item of cart) {
    for (const t of item.tickets) seats[item.tripId] = (seats[item.tripId] ?? 0) + t.quantity;
  }
  return seats;
}

type BookableTrip = Parameters<typeof isOnlineSalesOpen>[0] & {
  id: string;
  status: string;
  seatsRemaining: number | null;
};

/**
 * Throws (with an httpStatus) unless every trip in the cart can be booked
 * online now with the seats asked for. `trips` must already be scoped to the
 * operator. The booking route calls this under the trip locks.
 *
 * The quote passes checkSeats: false. It doesn't reclaim expired holds, so
 * its seat counts can be low, and only the booking decides seats.
 */
export function assertCartBookable(
  cart: Cart,
  trips: BookableTrip[],
  onlineCutoffMinutes: number,
  now: Date,
  { checkSeats = true }: { checkSeats?: boolean } = {},
) {
  if (trips.length !== cart.length) {
    throw Object.assign(new Error("One or more trips not found"), { httpStatus: 404 });
  }
  const seats = seatsByTrip(cart);
  for (const trip of trips) {
    if (trip.status !== "scheduled") {
      throw Object.assign(new Error("Trip is no longer available for booking"), { httpStatus: 409 });
    }
    if (!isOnlineSalesOpen(trip, onlineCutoffMinutes, now)) {
      throw Object.assign(new Error("Online sales for this trip have closed"), { httpStatus: 409 });
    }
    const requested = seats[trip.id] ?? 0;
    if (checkSeats && requested > (trip.seatsRemaining ?? 0)) {
      throw Object.assign(new Error(`Not enough seats available — only ${trip.seatsRemaining} left`), {
        httpStatus: 409,
      });
    }
  }
}
