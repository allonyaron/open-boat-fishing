ALTER TABLE "trips" ADD CONSTRAINT "trips_seats_remaining_non_negative" CHECK ("seats_remaining" >= 0);
