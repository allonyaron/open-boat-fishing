ALTER TABLE "vessels" ADD COLUMN "certificate_capacity" integer;--> statement-breakpoint
CREATE TABLE "capacity_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id"),
  "operator_id" uuid NOT NULL REFERENCES "operators"("id"),
  "staff_id" uuid REFERENCES "staff"("id"),
  "previous_capacity" integer NOT NULL,
  "new_capacity" integer NOT NULL,
  "changed_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "capacity_changes_trip_idx" ON "capacity_changes" ("trip_id");
