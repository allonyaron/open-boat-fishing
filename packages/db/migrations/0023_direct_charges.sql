ALTER TABLE "bookings" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "stripe_commands" ADD COLUMN "stripe_account" text;--> statement-breakpoint
COMMENT ON COLUMN "bookings"."stripe_account_id" IS 'The operator''s Stripe account the PaymentIntent was created on (direct charges, row 32). Later calls on the PI use it; null for a destination charge on the platform from before row 32.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."stripe_account_id" IS 'The connected account the charge is on (row 32); null for a destination charge from before row 32.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."stripe_fee_cents" IS 'Stripe''s processing fee on the charge, read from its balance transaction. Paid by the operator (row 32).';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."stripe_account" IS 'The connected account a refund is made on (row 32); null = the platform.';
--> statement-breakpoint
COMMENT ON COLUMN "payments"."stripe_transfer_id" IS 'Transfer to the operator''s connected account, for a destination charge from before row 32. Direct charges have none.';
