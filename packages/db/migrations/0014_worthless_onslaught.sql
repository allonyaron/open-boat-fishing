ALTER TABLE "operators" ADD COLUMN "online_cutoff_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "online_cutoff_minutes" integer;--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_online_cutoff_minutes_check" CHECK ("operators"."online_cutoff_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_online_cutoff_minutes_check" CHECK ("trips"."online_cutoff_minutes" >= 0);