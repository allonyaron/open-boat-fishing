CREATE TYPE "public"."ticket_status" AS ENUM('held', 'live', 'refunded', 'voided', 'disputed');--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "status" "ticket_status" DEFAULT 'held' NOT NULL;--> statement-breakpoint
-- Backfill (blocker 7). One statement, so the mapping can't depend on order.
-- "Paid" means a payments row exists (written only at payment_intent.succeeded);
-- seed bookings have none, so a confirmed booking's unvoided tickets are live
-- either way. A dispute and a refund leave the same data behind, so past
-- disputes come out as refunded. Tickets that end up off but whose fee was
-- still held were never charged: their fee is reversed too.
WITH "mapped" AS (
	SELECT
		t."id",
		(CASE
			WHEN t."voided" AND EXISTS (SELECT 1 FROM "payments" p WHERE p."booking_id" = t."booking_id") THEN 'refunded'
			WHEN t."voided" THEN 'voided'
			WHEN b."status" = 'confirmed' THEN 'live'
			WHEN b."status" = 'pending' THEN 'held'
			WHEN EXISTS (SELECT 1 FROM "payments" p WHERE p."booking_id" = t."booking_id") THEN 'refunded'
			ELSE 'voided'
		END)::"ticket_status" AS "status"
	FROM "tickets" t
	JOIN "bookings" b ON b."id" = t."booking_id"
)
UPDATE "tickets" t
SET
	"status" = m."status",
	"voided" = m."status" NOT IN ('held', 'live'),
	"fee_status" = CASE
		WHEN m."status" NOT IN ('held', 'live') AND t."fee_status" = 'held' THEN 'reversed'::"fee_status"
		ELSE t."fee_status"
	END
FROM "mapped" m
WHERE m."id" = t."id";--> statement-breakpoint
COMMENT ON COLUMN "tickets"."status" IS 'held (awaiting payment) -> live (paid) -> refunded | disputed; held -> voided when never paid. Only live boards, counts as sold and earns the fee. Set only through lib/tickets.';--> statement-breakpoint
COMMENT ON COLUMN "tickets"."voided" IS 'Superseded by status and kept in step with it (true unless held or live) for code deployed before status existed. To be dropped.';
