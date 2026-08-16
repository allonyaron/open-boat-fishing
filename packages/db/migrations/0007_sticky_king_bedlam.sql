CREATE TABLE "fishing_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"vessel_id" uuid NOT NULL,
	"staff_id" uuid,
	"catch_summary" text,
	"fish_counts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_urls" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fishing_reports_trip_id_unique" UNIQUE("trip_id")
);
--> statement-breakpoint
ALTER TABLE "fishing_reports" ADD CONSTRAINT "fishing_reports_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fishing_reports" ADD CONSTRAINT "fishing_reports_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fishing_reports" ADD CONSTRAINT "fishing_reports_vessel_id_vessels_id_fk" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fishing_reports" ADD CONSTRAINT "fishing_reports_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fishing_reports_operator_idx" ON "fishing_reports" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "fishing_reports_vessel_idx" ON "fishing_reports" USING btree ("vessel_id");
