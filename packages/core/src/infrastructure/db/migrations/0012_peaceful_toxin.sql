ALTER TABLE "skills" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "published_by" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "published_at" timestamp with time zone;