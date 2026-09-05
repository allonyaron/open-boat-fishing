ALTER TABLE "operators" ADD COLUMN "arrive_minutes_before" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "what_to_bring" text[] DEFAULT '{}' NOT NULL;