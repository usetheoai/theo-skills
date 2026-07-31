CREATE TABLE "skill_channels" (
	"workspace_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"channel" text NOT NULL,
	"revision_id" text NOT NULL,
	"previous_revision_id" text,
	"updated_by" text,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_channels_pkey" PRIMARY KEY("workspace_id","skill_id","channel")
);
--> statement-breakpoint
ALTER TABLE "skill_revisions" ADD COLUMN "version" text;