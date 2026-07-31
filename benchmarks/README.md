# Benchmarks

Números **medidos**, com o comando que os reproduz. Nenhum valor aqui é estimado — se um
número não pôde ser medido, ele não está neste diretório.

## Retrieve sob filtro de tenant

Mede Recall@5 e p95 da busca híbrida com o filtro de workspace ativo e o índice populado por
vários tenants — a condição que o risco #1 do M11 descreveu.

```bash
docker run -d --name skpg -e POSTGRES_USER=theoskill -e POSTGRES_PASSWORD=theoskill \
  -e POSTGRES_DB=theoskill -p 15999:5432 ankane/pgvector:v0.5.1

export THEOSKILL_PG_URI=postgres://theoskill:theoskill@127.0.0.1:15999/theoskill
pnpm -C packages/core db:migrate
pnpm -C packages/api eval:tenant 20     # 20 tenants no índice
```

### Medição de 2026-07-31

| tenants | linhas no índice | hybrid recall@5 | hybrid p95 | keyword recall@5 | vector recall@5 |
|---:|---:|---:|---:|---:|---:|
| 5 | 65 | 1.000 | 5.0 ms | 1.000 | 0.308 |
| 20 | 260 | 1.000 | 3.4 ms | 1.000 | 0.308 |
| 60 | 780 | 1.000 | 5.2 ms | 1.000 | 0.308 |

**Gate do M4:** recall@5 ≥ 0.85, p95 < 200 ms. O híbrido passa sob filtro, sem tendência de
crescimento no p95 entre 65 e 780 linhas.

### O que estes números NÃO provam

780 linhas é corpus de brinquedo. Isto **não** sustenta uma afirmação de SLO de produção — a
leitura honesta é negativa e limitada: *não há evidência de degradação por filtro de tenant na
faixa observada*. Basta para não bloquear o M11; não basta para prometer publicamente.

O `vector` em 0.308 é o embedder **stub** (hash determinístico, não semântico) — limite já
documentado no M4, não regressão. Em produção o embedder real restaura o recall vetorial.

Análise completa: ADR 0006 (`knowledge-base/adrs/`, no workspace umbrella).

## SLO de retrieve

Alvo: **p95 < 200 ms** (`RETRIEVE_SLO_P95_MS` em `packages/api/src/server/observability/metrics.ts`).

Verificável em runtime via `checkRetrieveSlo(registry)`, que devolve a violação com o número
medido — ou `null`. O alarme exige um mínimo de amostras: alarmar sobre três requisições
produz ruído que treina o time a ignorar o alarme.
