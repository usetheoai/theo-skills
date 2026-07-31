CREATE TABLE "bundle_items" (
	"workspace_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"channel" text DEFAULT 'stable' NOT NULL,
	CONSTRAINT "bundle_items_pkey" PRIMARY KEY("workspace_id","bundle_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "bundles" (
	"workspace_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"name" text NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundles_pkey" PRIMARY KEY("workspace_id","bundle_id")
);
--> statement-breakpoint
CREATE TABLE "distribution_tokens" (
	"token_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"quota_per_window" integer,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distribution_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "distribution_tokens_bundle_idx" ON "distribution_tokens" USING btree ("workspace_id","bundle_id");