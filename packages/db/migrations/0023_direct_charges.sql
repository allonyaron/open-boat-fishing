ALTER TABLE "bookings" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "stripe_commands" ADD COLUMN "stripe_account" text;