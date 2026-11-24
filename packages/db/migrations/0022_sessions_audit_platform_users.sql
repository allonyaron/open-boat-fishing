CREATE TYPE "public"."audit_actor_kind" AS ENUM('staff', 'platform', 'customer', 'system', 'stripe');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_table" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_operator_created_idx" ON "audit_log" USING btree ("operator_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_table","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_kind","actor_id","created_at");--> statement-breakpoint
COMMENT ON TABLE "audit_log" IS 'Who changed money, seats or settings (row 12, AR-9). Written by each command in the transaction that makes the change. Read-only once written.';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."operator_id" IS 'The operator the change belongs to; null for platform-wide changes such as adding a platform user.';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."actor_id" IS 'staff.id (staff), platform_users.id (platform), customers.id (customer), the job name (system) or the evt_… id (stripe).';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."action" IS 'What was done, as noun.verb: ticket.refund, trip.cancel, trip.set_capacity, operator.update, staff.update, …';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."target_id" IS 'Text, with no foreign key, so the row outlives what it describes (a deleted booking, a demo reset).';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."before" IS 'The changed fields before the change; secrets (password and PIN hashes) are recorded only as changed.';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."request_id" IS 'The request that made the change (Vercel''s x-vercel-id), to find it in the logs.';--> statement-breakpoint
COMMENT ON TABLE "platform_users" IS 'Named accounts for the platform console (row 12). PLATFORM_SECRET creates only the first one.';--> statement-breakpoint
COMMENT ON COLUMN "platform_users"."session_version" IS 'Sealed into the platform session and compared on every request; deactivation or a new password adds one.';--> statement-breakpoint
COMMENT ON COLUMN "staff"."session_version" IS 'Sealed into the admin session and compared on every request (row 12, P5-1); deactivation or a new password or PIN adds one.';
