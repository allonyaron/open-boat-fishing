CREATE TYPE "public"."fee_bearer" AS ENUM('passenger', 'operator');--> statement-breakpoint
CREATE TYPE "public"."fee_display" AS ENUM('itemized', 'folded');--> statement-breakpoint
CREATE TYPE "public"."fee_status" AS ENUM('held', 'earned', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('scheduled', 'pending_settlement', 'sailed', 'cancelled');--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "fee_bearer" "fee_bearer" DEFAULT 'passenger' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "fee_display" "fee_display" DEFAULT 'itemized' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "cancel_window_hrs" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "settle_grace_hrs" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "fee_amount_cents" integer DEFAULT 150 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "fee_status" "fee_status" DEFAULT 'held' NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "status" "trip_status" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "sailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "boarding_time" time;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "duration_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "duration_hr" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "duration_min" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "online_cutoff" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "deposit_percentage" integer;--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "cancelled";