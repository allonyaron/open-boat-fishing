CREATE TYPE "public"."stripe_command_kind" AS ENUM('refund', 'fee_refund');--> statement-breakpoint
CREATE TYPE "public"."stripe_command_status" AS ENUM('pending', 'sent', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "stripe_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"kind" "stripe_command_kind" NOT NULL,
	"booking_id" uuid,
	"reason" text NOT NULL,
	"target_id" text NOT NULL,
	"amount_cents" integer,
	"params" jsonb NOT NULL,
	"dedupe_key" text,
	"status" "stripe_command_status" DEFAULT 'pending' NOT NULL,
	"stripe_object_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "stripe_commands_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "stripe_commands" ADD CONSTRAINT "stripe_commands_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_commands" ADD CONSTRAINT "stripe_commands_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_commands_status_idx" ON "stripe_commands" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "stripe_commands_operator_status_idx" ON "stripe_commands" USING btree ("operator_id","status");--> statement-breakpoint
CREATE INDEX "stripe_commands_booking_idx" ON "stripe_commands" USING btree ("booking_id");--> statement-breakpoint
COMMENT ON TABLE "stripe_commands" IS 'Outbox of refunds the app asks Stripe for (row 10). Written in the same transaction as the ticket and seat changes, then sent; the id is the Stripe idempotency key and the refund''s metadata.command_id. Pending rows are retried by the expiry cron.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."target_id" IS 'The PaymentIntent (pi_…) for a refund, or the application fee (fee_…) for a fee refund.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."amount_cents" IS 'Amount to refund. Null = everything left.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."params" IS 'The exact request sent to Stripe, so every retry sends the same one.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."dedupe_key" IS 'Unique key for a command that could otherwise be queued twice (an auto-refund, a fee reversal on a Dashboard refund).';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."status" IS 'pending (not yet accepted by Stripe), sent (accepted; a refund is confirmed when charge.refunded arrives), confirmed, failed (refused by Stripe; shown on the Money page).';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."stripe_object_id" IS 'The Stripe refund (re_…) or fee refund (fr_…) created.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."claimed_at" IS 'Lease taken by the worker sending the command; another may take it over after five minutes.';
