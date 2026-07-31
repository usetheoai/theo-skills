# Runbook — theo-skills

O que fazer quando algo quebra. Cada seção começa pelo **sintoma**, porque é isso que você
tem em mãos às três da manhã.

## O serviço responde `200` em `/v1/health` mas erra em tudo

**Causa quase certa:** o banco está sem schema.

Aconteceu no primeiro deploy real (2026-07-30). `/v1/health` é **deliberadamente** estático —
ele responde "o processo está vivo", não "o banco está de pé", para que uma queda de 30 s do
Postgres não mate o container.

```bash
docker exec <container> node -e "…"        # ou, de um checkout:
THEOSKILL_PG_URI=… pnpm -C packages/core db:migrate
```

Desde a correção a imagem aplica as próprias migrations no boot, com advisory lock. Se o
sintoma voltar, verifique se o boot registrou `schema aplicado`.

## `429` em massa vindo de um cliente só

O rate limit é **por principal**, e a quota de distribuição é **por token**. Um cliente
descuidado não derruba os outros — se isso está acontecendo, a chave do bucket está errada.

```bash
# Confirme que os orçamentos são distintos:
curl -i -H "authorization: Bearer <token-A>" .../v1/distribution/bundle
curl -i -H "authorization: Bearer <token-B>" .../v1/distribution/bundle   # deve passar
```

O `Retry-After` é obrigatório na resposta. Sem ele o cliente retenta imediatamente e o limite
vira amplificador de carga — se estiver ausente, é bug, não configuração.

## Um cliente diz que "sumiu" uma skill do bundle

Bundles referenciam skills **por canal**, não por revisão. Verifique para onde o canal aponta:

```sql
SELECT channel, revision_id, previous_revision_id
FROM skill_channels WHERE workspace_id = $1 AND skill_id = $2;
```

Se alguém promoveu errado, a reversão é uma operação, não uma investigação — o alvo anterior
está gravado na mesma linha.

## `404` em tudo para um cliente de distribuição

Por desenho, os quatro casos são **indistinguíveis**: token inexistente, revogado, expirado,
ou de outro publisher. Distinguir permitiria descobrir bundles alheios por tentativa.

```sql
SELECT token_id, revoked_at, expires_at FROM distribution_tokens
WHERE token_hash = encode(sha256($1::bytea), 'hex');
```

O token cru **não é recuperável** — só o hash é guardado. Se o cliente perdeu o valor, emita
outro e revogue o antigo.

## Workspace ficou sem `owner`

**Não deveria ser possível** — há invariante transacional com `SELECT … FOR UPDATE`. Se
aconteceu, houve escrita direta no banco, fora da API.

```sql
UPDATE workspace_users SET role = 'owner'
WHERE workspace_id = $1 AND user_id = $2;
```

Registre como incidente: o caminho que permitiu isso precisa ser fechado.

## O painel `/status` mostra a versão errada

`GET /v1/version` lê a proveniência do ambiente, não da imagem. O reconciliador do dev host
converge em três eixos — imagem, `State.Running` e **proveniência**. Se o `.env` congelar, o
endpoint mente permanentemente, porque a imagem já bate e nada dispara a correção.

```bash
journalctl --user -u theoskill-reconcile -n 30
```

## Rotação de credencial

Ver `docs/credential-rotation.md`.
