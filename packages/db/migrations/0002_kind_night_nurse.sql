CREATE TABLE "holiday_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_dates_operator_id_date_unique" UNIQUE("operator_id","date")
);
--> statement-breakpoint
CREATE TABLE "schedule_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"ticket_type" "ticket_type" NOT NULL,
	"price_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_prices_schedule_id_ticket_type_unique" UNIQUE("schedule_id","ticket_type")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "group_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "group_discount_threshold" integer;--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "group_discount_pct" integer;--> statement-breakpoint
ALTER TABLE "holiday_dates" ADD CONSTRAINT "holiday_dates_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_prices" ADD CONSTRAINT "schedule_prices_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_prices" ADD CONSTRAINT "schedule_prices_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_prices_schedule_idx" ON "schedule_prices" USING btree ("schedule_id");