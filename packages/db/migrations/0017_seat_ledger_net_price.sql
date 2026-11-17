CREATE TYPE "public"."seat_change_reason" AS ENUM('hold', 'release', 'refund', 'trip_cancel', 'capacity_edit', 'recount');--> statement-breakpoint
ALTER TABLE "capacity_changes" ALTER COLUMN "previous_capacity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "capacity_changes" ALTER COLUMN "new_capacity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capacity_changes" ADD COLUMN "delta" integer;--> statement-breakpoint
ALTER TABLE "capacity_changes" ADD COLUMN "reason" "seat_change_reason";--> statement-breakpoint
ALTER TABLE "capacity_changes" ADD COLUMN "seats_remaining_after" integer;--> statement-breakpoint
ALTER TABLE "capacity_changes" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "capacity_changes" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "list_price_cents" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capacity_changes" ADD CONSTRAINT "capacity_changes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_changes" ADD CONSTRAINT "capacity_changes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill (blocker 8). Until now tickets.price_cents held the fare (list
-- price). Keep it as list_price_cents and make price_cents what the ticket
-- paid: its fare minus its share of the item's discount (sum of fares minus
-- the item's subtotal), shared in proportion to the fares, whole cents, the
-- leftover cents to the largest remainders, as priceCart allocates. With no
-- discount every ticket keeps its fare. Only tickets without a list price
-- move, so running it again changes nothing.
WITH "base" AS (
	SELECT
		t."id",
		t."booking_item_id",
		t."ticket_type",
		t."price_cents"::bigint AS "list_cents",
		SUM(t."price_cents") OVER "w" AS "list_total",
		GREATEST(SUM(t."price_cents") OVER "w" - bi."subtotal_cents", 0) AS "discount"
	FROM "tickets" t
	JOIN "booking_items" bi ON bi."id" = t."booking_item_id"
	WHERE t."list_price_cents" IS NULL
	WINDOW "w" AS (PARTITION BY t."booking_item_id")
),
"floored" AS (
	SELECT
		*,
		CASE WHEN "list_total" = 0 THEN 0 ELSE ("discount" * "list_cents") / "list_total" END AS "share_floor",
		CASE WHEN "list_total" = 0 THEN 0 ELSE ("discount" * "list_cents") % "list_total" END AS "remainder"
	FROM "base"
),
"ranked" AS (
	SELECT
		*,
		"discount" - SUM("share_floor") OVER (PARTITION BY "booking_item_id") AS "leftover",
		ROW_NUMBER() OVER (PARTITION BY "booking_item_id" ORDER BY "remainder" DESC, "ticket_type", "id") AS "rn"
	FROM "floored"
)
UPDATE "tickets" t
SET
	"list_price_cents" = r."list_cents",
	"price_cents" = r."list_cents" - r."share_floor" - CASE WHEN r."rn" <= r."leftover" THEN 1 ELSE 0 END
FROM "ranked" r
WHERE r."id" = t."id";--> statement-breakpoint
COMMENT ON COLUMN "tickets"."price_cents" IS 'This ticket''s share of the amount charged, in cents: its fare minus its share of any group discount. What a refund of this ticket pays back.';--> statement-breakpoint
COMMENT ON COLUMN "tickets"."list_price_cents" IS 'The fare before any discount, for display. Null on tickets written before the column existed: read price_cents then.';--> statement-breakpoint
COMMENT ON TABLE "capacity_changes" IS 'Ledger of every change to a trip''s seats_remaining and capacity, written only by lib/inventory. sum(delta) over a trip reconciles to its seats_remaining; a recount row records drift it corrected.';--> statement-breakpoint
COMMENT ON COLUMN "capacity_changes"."delta" IS 'Change to seats_remaining; negative takes seats. Null on rows written before the ledger existed.';--> statement-breakpoint
COMMENT ON COLUMN "capacity_changes"."reason" IS 'hold, release, refund, trip_cancel, capacity_edit or recount.';--> statement-breakpoint
COMMENT ON COLUMN "capacity_changes"."seats_remaining_after" IS 'seats_remaining once this change was applied.';--> statement-breakpoint
COMMENT ON COLUMN "bookings"."status_changed_at" IS 'When status last changed. Written by transitionBookings (lib/bookings/status.ts), the only writer of status.';--> statement-breakpoint
COMMENT ON COLUMN "trips"."status_changed_at" IS 'When status last changed. Written by transitionTrips (lib/trips/status.ts), the only writer of status.';
