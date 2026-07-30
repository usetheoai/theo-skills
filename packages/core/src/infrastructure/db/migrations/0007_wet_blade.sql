-- M11 — isolamento por workspace.
--
-- REESCRITA À MÃO. O que o drizzle-kit gerou não roda: emitia
-- `ADD CONSTRAINT skills_pkey PRIMARY KEY("workspace_id","skill_id")` ANTES do
-- `ADD COLUMN "workspace_id"`, e deixava o `DROP CONSTRAINT` da PK antiga comentado com um
-- "descubra o nome você mesmo". Aplicada como veio, aborta em dois pontos.
--
-- Ordem correta: coluna → troca de PK → índices.

-- Fase 1 — as colunas do inquilino.
--
-- `DEFAULT 'default' NOT NULL` preenche as linhas existentes com o workspace da ponte legada,
-- então a instalação atual continua inteira e alcançável: nenhuma linha órfã.
ALTER TABLE "skills" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_revisions" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint

-- Fase 2 — a identidade da skill passa a ser o PAR (workspace, skill).
--
-- Como PK global, o primeiro inquilino a registrar `deploy-helper` bloquearia o nome para
-- todos os outros para sempre — e a regra de reserva pós-delete agrava isso. O nome da
-- constraint segue a convenção do Postgres (`<tabela>_pkey`); dropamos e recriamos com o
-- MESMO nome para não deixar duas convenções no banco.
ALTER TABLE "skills" DROP CONSTRAINT "skills_pkey";--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("workspace_id", "skill_id");--> statement-breakpoint

-- Fase 3 — índices liderados pelo inquilino.
--
-- A idempotência passa a ser POR INQUILINO. Fosse global, um inquilino poderia adivinhar a
-- chave de outro e receber de volta a operação alheia — vazamento por canal lateral.
DROP INDEX IF EXISTS "operations_idempotency_key_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "operations_ws_idempotency_key_uq" ON "operations" USING btree ("workspace_id","idempotency_key") WHERE "operations"."idempotency_key" IS NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "skill_revisions_skill_id_create_time_idx";--> statement-breakpoint
CREATE INDEX "skill_revisions_ws_skill_create_idx" ON "skill_revisions" USING btree ("workspace_id","skill_id","create_time" desc);--> statement-breakpoint

-- Caminho barato para o recorte do inquilino. Importa especialmente em `embeddings`: o HNSW
-- indexa apenas o vetor (pgvector não aceita coluna de filtro liderando um índice ANN), então
-- é este B-tree que o planner combina com a busca vetorial.
CREATE INDEX "skills_workspace_idx" ON "skills" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "operations_workspace_idx" ON "operations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "embeddings_workspace_idx" ON "embeddings" USING btree ("workspace_id");
