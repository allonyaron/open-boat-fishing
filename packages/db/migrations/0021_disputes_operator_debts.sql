CREATE TYPE "public"."operator_debt_kind" AS ENUM('dispute_fee');--> statement-breakpoint
CREATE TYPE "public"."operator_debt_status" AS ENUM('owed', 'reserved', 'collected');--> statement-breakpoint
ALTER TYPE "public"."stripe_command_kind" ADD VALUE 'transfer_reversal';--> statement-breakpoint
ALTER TYPE "public"."stripe_command_kind" ADD VALUE 'transfer';--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"booking_id" uuid,
	"payment_intent_id" text NOT NULL,
	"charge_id" text,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"respond_by" timestamp with time zone,
	"stripe_fee_cents" integer,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"kind" "operator_debt_kind" NOT NULL,
	"dispute_id" text,
	"amount_cents" integer NOT NULL,
	"status" "operator_debt_status" DEFAULT 'owed' NOT NULL,
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"collected_at" timestamp with time zone,
	CONSTRAINT "operator_debts_dispute_id_unique" UNIQUE("dispute_id")
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_debts" ADD CONSTRAINT "operator_debts_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_debts" ADD CONSTRAINT "operator_debts_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_debts" ADD CONSTRAINT "operator_debts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_operator_opened_idx" ON "disputes" USING btree ("operator_id","opened_at");--> statement-breakpoint
CREATE INDEX "disputes_booking_idx" ON "disputes" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "operator_debts_operator_status_idx" ON "operator_debts" USING btree ("operator_id","status","created_at");--> statement-breakpoint
CREATE INDEX "operator_debts_booking_idx" ON "operator_debts" USING btree ("booking_id");--> statement-breakpoint
COMMENT ON TABLE "disputes" IS 'Chargebacks on bookings (row 11), kept up to date by the charge.dispute.* webhook handlers. Read by the Money page and the passenger list.';--> statement-breakpoint
COMMENT ON COLUMN "disputes"."status" IS 'Stripe''s dispute status: warning_* (an inquiry; no money taken), needs_response, under_review, won, lost.';--> statement-breakpoint
COMMENT ON COLUMN "disputes"."respond_by" IS 'Stripe''s deadline for evidence (evidence_details.due_by).';--> statement-breakpoint
COMMENT ON COLUMN "disputes"."stripe_fee_cents" IS 'Stripe''s dispute fees net of any it returned, summed from the dispute''s balance transactions when it closes. The operator owes this (operator_debts).';--> statement-breakpoint
COMMENT ON TABLE "operator_debts" IS 'Money an operator owes the platform: the Stripe fee on a chargeback (row 11). Collected by adding it to the platform fee on the operator''s next booking, because Standard connected accounts can''t be debited.';--> statement-breakpoint
COMMENT ON COLUMN "operator_debts"."status" IS 'owed (waiting for a booking), reserved (added to booking_id''s platform fee, not yet paid), collected (booking_id''s payment carried it).';--> statement-breakpoint
COMMENT ON COLUMN "operator_debts"."booking_id" IS 'The booking whose platform fee carries the debt, while reserved or collected.';
