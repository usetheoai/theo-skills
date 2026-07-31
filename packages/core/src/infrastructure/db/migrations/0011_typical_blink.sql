CREATE TABLE "install_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"token_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"version" text,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "install_events_bundle_idx" ON "install_events" USING btree ("workspace_id","bundle_id","create_time");