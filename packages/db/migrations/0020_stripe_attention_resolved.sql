ALTER TABLE "stripe_commands" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_commands" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "stripe_commands" ADD CONSTRAINT "stripe_commands_resolved_by_staff_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_resolved_by_staff_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."resolved_at" IS 'When a person marked a needs_review event dealt with on the Money page.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_events"."resolved_by" IS 'Staff member who marked it dealt with.';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."resolved_at" IS 'When a person marked a failed command dealt with on the Money page (for example, refunded by hand in Stripe).';--> statement-breakpoint
COMMENT ON COLUMN "stripe_commands"."resolved_by" IS 'Staff member who marked it dealt with.';
