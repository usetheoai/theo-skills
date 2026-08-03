---
milestone_id: M7
status: aberto — bloqueado por credencial externa
date: 2026-08-03
---

# M7 continua aberto, e o motivo é externo

O último `/acceptance M7` computou `NOT_VALIDATED`. Não por defeito do trabalho: os 4 pacotes
foram publicados no npm e a maioria dos critérios foi exercitada contra o publicado.

**Único bloqueio:** o **AC4** exige o registry `app-dev` com embedder real, e o acesso pede uma
chave de escopo `skills:read` por inquilino. Verificado: `app-dev.usetheo.dev` responde 200 e
`/health` também — o serviço está no ar e recusa por credencial, não por infraestrutura. A
emissão é `POST /v1/platform/keys` ou `/v1/admin/keys`, ambas exigindo chave **admin** que não
existe em `.env` nem no ambiente.

A chave foi solicitada ao dono do projeto. Enquanto não chega, o AC4 permanece `not_exercised`,
o veredito permanece `NOT_VALIDATED` e o checkbox permanece `[ ]`.

**O que NÃO foi feito, deliberadamente:** tirar o AC4 do Definition of done. Um milestone
honestamente aberto vale mais que um `[x]` que ninguém provou — e editar o DoD para o run passar
é, pelo contrato do `cycle-goal`, violação e não conclusão.

A meta da sessão foi movida para o M30 para não desperdiçar a instância esperando a credencial.
Quando a chave chegar, re-armar: `install_goal_hook.py --milestones M7`.

---

## Correção (2026-08-03, medida) — a chave NÃO é o único bloqueio

Este registro diz que o único bloqueio do M7 é a chave `skills:read`. **Não é.** Quando ela
chegar, o AC4 fecha e o M7 **continua aberto**, porque faltam também:

| critério | tem | precisa |
|---|---|---|
| AC6 — datas distintas | **1** (`2026-08-03`) | **≥3** |
| AC6 — `outcome: fail` | **0** (o único registro é `partial`) | **≥1** |
| AC7 — consultas de uso real | **0** registradas | consultas extraídas do dogfood |

Comandos que produziram os números:

```
grep -h "^date:" .claude/knowledge-base/dogfood/evidence/*.md | sort -u | wc -l   -> 1
grep -l "outcome: fail" .claude/knowledge-base/dogfood/evidence/*.md | wc -l      -> 0
grep -riE "consulta|query|search" .claude/knowledge-base/dogfood/evidence/*.md    -> vazio
```

O AC7 **não** é fechável por decisão: ele exige consultas *"não escritas por quem publicou as
skills"*. Escrevê-las eu mesmo é o defeito que o critério existe para impedir.

Registro isto porque a expectativa "chegou a chave → M7 fecha" levaria a próxima sessão a
re-rodar `/acceptance` e receber `NOT_VALIDATED` sem entender por quê.
