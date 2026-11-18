CREATE TYPE "public"."stripe_event_outcome" AS ENUM('handled', 'ignored', 'needs_review');--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"account" text,
	"livemode" boolean NOT NULL,
	"stripe_created_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"outcome" "stripe_event_outcome",
	"operator_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_events_unprocessed_idx" ON "stripe_events" USING btree ("stripe_created_at") WHERE "stripe_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "stripe_events_operator_outcome_idx" ON "stripe_events" USING btree ("operator_id","outcome");--> statement-breakpoint
COMMENT ON TABLE "stripe_events" IS 'Inbox of Stripe webhook events, saved before they are acted on (row 10). A redelivery of a saved event is a no-op on the primary key. Unfinished rows (processed_at null) are retried by Stripe redeliveries and the expiry cron.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."account" IS 'Set only on events from a connected account; those are always ignored.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."stripe_created_at" IS 'When Stripe created the event. Drain order, and the clock for giving up after three days.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."claimed_at" IS 'Lease taken by the worker processing the event; another worker may take it over after five minutes.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."processed_at" IS 'When processing finished. Null = still to do.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."outcome" IS 'handled, ignored (not this deployment''s payment, or nothing to do) or needs_review (shown on the Money page).';--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."operator_id" IS 'Operator the event belongs to, once a handler resolved it. Null for events that aren''t ours.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."last_error" IS 'Last failure while unfinished; once finished, why it was ignored or needs review.';
