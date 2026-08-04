ALTER TABLE "skills" ADD COLUMN "lifecycle" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "deprecation_reason" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "superseded_by" text;--> statement-breakpoint
--
-- M32 / ADR D5 — CHECK escrito à mão, deliberadamente.
--
-- O `text('lifecycle', { enum: SKILL_LIFECYCLES })` do Drizzle tipa em TypeScript e NÃO gera
-- restrição no Postgres: a migração acima saiu como `text` puro. Sem esta cláusula, qualquer
-- escrita fora do caminho da aplicação (psql, script de migração de dados, correção manual em
-- incidente) grava um estágio que o domínio recusaria, e a busca passa a esconder — ou revelar —
-- skills por um valor que ninguém consegue explicar.
--
-- Divergimos aqui do padrão local: `state` e `visibility` são `text` livre. É essa ausência de
-- restrição que este milestone está pagando. Se o time preferir uniformizar, o caminho é
-- acrescentar CHECK às outras duas, não remover desta.
ALTER TABLE "skills" ADD CONSTRAINT "skills_lifecycle_check"
  CHECK ("lifecycle" IN ('active', 'draft', 'deprecated'));--> statement-breakpoint
--
-- Integridade do par deprecação↔motivo: um estágio `deprecated` sem motivo é o defeito que o
-- ADR D3 existe para impedir — o agente recebe "não use mais" sem saber o que usar no lugar.
-- A fronteira HTTP já exige o motivo; esta restrição garante que nenhum outro caminho de
-- escrita consiga criar o estado incoerente.
ALTER TABLE "skills" ADD CONSTRAINT "skills_deprecation_reason_check"
  CHECK ("lifecycle" <> 'deprecated' OR "deprecation_reason" IS NOT NULL);
