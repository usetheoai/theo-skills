ALTER TABLE "skills" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "execution" text DEFAULT 'remote' NOT NULL;--> statement-breakpoint
CREATE INDEX "skills_workspace_category_idx" ON "skills" USING btree ("workspace_id","category");