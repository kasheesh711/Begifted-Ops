CREATE TYPE "public"."action_log_type" AS ENUM('set', 'clear', 'bulk-set', 'bulk-clear');--> statement-breakpoint
CREATE TYPE "public"."admin_key" AS ENUM('palm', 'kem', 'care', 'aya', 'petchy', 'muk', 'unassigned');--> statement-breakpoint
CREATE TYPE "public"."student_action_status" AS ENUM('contacted', 'pending-callback', 'resolved');--> statement-breakpoint
CREATE TABLE "follow_up_log" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_key" text NOT NULL,
	"student_name" text NOT NULL,
	"parent_name" text NOT NULL,
	"action_type" "action_log_type" NOT NULL,
	"status" "student_action_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_email" text NOT NULL,
	"actor_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_state" (
	"student_key" text PRIMARY KEY NOT NULL,
	"student_name" text NOT NULL,
	"parent_name" text NOT NULL,
	"status" "student_action_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_email" text NOT NULL,
	"updated_by_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inactive_students" (
	"student_key" text PRIMARY KEY NOT NULL,
	"student_name" text NOT NULL,
	"parent_name" text NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marked_by_email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_admin_ownership" (
	"student_key" text PRIMARY KEY NOT NULL,
	"admin_key" "admin_key" NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_email" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "follow_up_log_student_key_created_at_idx" ON "follow_up_log" USING btree ("student_key","created_at" DESC);--> statement-breakpoint
CREATE INDEX "follow_up_log_created_at_idx" ON "follow_up_log" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "follow_up_state_updated_at_idx" ON "follow_up_state" USING btree ("updated_at" DESC);--> statement-breakpoint
CREATE INDEX "student_admin_ownership_admin_key_idx" ON "student_admin_ownership" USING btree ("admin_key");