ALTER TABLE "bookings" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "terms_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "dock_address" text;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "dock_maps_url" text;