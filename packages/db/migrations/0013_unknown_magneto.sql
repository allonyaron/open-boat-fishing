ALTER TABLE "trips" ALTER COLUMN "schedule_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "code" text;