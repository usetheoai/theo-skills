# Migração 0015 aplicada no droplet — evidência

**Data:** 2026-08-05 · **Host:** `theo-e2e-runner` (165.227.121.20) · **Operador:** Claude, autorizado por Paulo

## Reconciliação verificada ANTES de migrar

| Eixo | Medido |
|---|---|
| digest da imagem | `sha256:6b8ab83ee318` |
| `State.Running` | `theoskill_app`, `theoskill_mcp`, `theoskill_pgvector_dev` — todos healthy |
| proveniência | `/v1/version` → `{"version":"develop-ffd1e9b","git_sha":"ffd1e9b693b07e7590a3890ba5c38c38e76b1605"}` |

`ffd1e9b` é o merge do PR #152. Os três eixos convergidos — a pré-condição da migração estava satisfeita.

## Detecção antes da migração

```sql
SELECT workspace_id, skill_id, version, count(*), array_agg(revision_id)
  FROM skill_revisions WHERE version IS NOT NULL
 GROUP BY 1,2,3 HAVING count(*) > 1;
```

**Resultado: vazio.** Zero duplicatas em 37 revisões (11 com versão, 26 sem). O ramo de deleção da migração nunca precisou decidir nada.

## Aplicação

A imagem de produção não carrega `drizzle-kit`, então a migração foi aplicada por `psql` — com o registro no `__drizzle_migrations` **na mesma transação**, para não deixar a migração aplicada e não registrada.

O hash de controle foi confirmado como `sha256` do arquivo, testando contra a `0014` já aplicada (`dfb0fea3…` bateu) antes de inserir o da `0015` (`8806cc5f…`).

```
BEGIN · DO · DELETE 0 · CREATE INDEX · INSERT 0 1 · COMMIT
```

## Verificação depois

| Invariante | Resultado |
|---|---|
| índice criado e **parcial** | `... USING btree (workspace_id, skill_id, version) WHERE (version IS NOT NULL)` |
| migrações registradas | 15 → **16** |
| revisões | 37 → 37 (intactas) |
| revisões com versão | 11 → 11 |
| revisões sem versão | 26, seguem ilimitadas |
| canais pendurados | 0 |
| **o índice recusa de fato** | `INSERT` de duplicata → `duplicate key value violates unique constraint` em `(ws_jornadas, vendas, 1.4.0)` |
| app saudável depois | `theoskill_app` healthy; `/v1/skills` → 401 (esperado) |

O último item é o que torna isto evidência e não afirmação: a restrição foi **exercitada**, não apenas criada.

## Achado preexistente, registrado

`sk_dog1` e `sk_dog2` (workspace `default`, atualizadas 2026-07-31) têm `latest_revision_id` apontando para revisão inexistente — **zero revisões cada**. São fixtures de dogfood. **Não foram tocadas por esta migração** (`DELETE 0` prova), e não afetam o índice.

Vale registrar porque é a mesma classe de ponteiro sem foreign key que motivou a regra de deleção "só a não-referenciada": aqui a inconsistência já existia, e ninguém a detectava.
