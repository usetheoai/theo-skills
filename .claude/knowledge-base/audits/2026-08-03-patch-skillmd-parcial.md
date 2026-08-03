---
data: 2026-08-03
tipo: audit
estado: INCOMPLETO — não conclua que está corrigido
---

# `PATCH` com `skillMd`: aceito na fronteira, sem efeito no acervo

## O defeito original (medido)

`POST /v1/skills` passou a aceitar `SKILL.md` avulso no M30; o `PATCH` não. É a mesma assimetria
criação-vs-atualização que já produziu defeito neste código — `version` e `category` iam no job de
criação e não no de atualização, e a segunda publicação nascia sem versão, sem erro algum.

Medido contra o serviço vivo, antes de qualquer mudança:
```
PATCH ?updateMask=skillMd                    -> {"error":"invalid_update_mask"}
PATCH ?updateMask=zippedFilesystem + skillMd -> {"error":"invalid_zip"}
```

## O que foi corrigido

1. `UPDATE_MASK_FIELDS` passou a incluir `skillMd`, e foi **exportado** — o contrato é testável
   como conjunto; assertar sobre a resposta HTTP passa por vacuidade quando a rota morre antes.
2. A rota converte `skillMd` em zip de um arquivo pelo mesmo `zipDeUmArquivo`.
3. `worker.ts:157` honra `skillMd` na máscara, ao lado de `zippedFilesystem`.

Compilado e no ar: `handlers/skills.js` e `worker.js` contêm as guardas.

## O QUE NÃO FUNCIONA — e eu não achei a causa

```
PATCH ?updateMask=skillMd -> 202 op_kolbedrpdson3yevfazryqzs
pgboss: update_skill | completed | (sem output)   ← sem erro
GET .../instructions -> corpo ANTIGO
GET .../revisions    -> 1 revisão (a original)
log: "skill embedded" com o revision_id ANTIGO
```

O job completa sem erro e `addRevision` não cria revisão nova. Descartado no caminho:

- **Dados do job estão completos:** `payload_b64 is not null` e `frontmatter is not null`,
  verificados em `pgboss.job`.
- **Não era worker desatualizado:** havia **três** servidores competindo pela mesma fila, dois com
  código antigo. Encerrei todos e reproduzi com uma instância só, já corrigida — mesmo resultado.
- **As guardas estão no `dist`**, verificadas por grep no compilado.

## Hipóteses TESTADAS e descartadas (2026-08-03, segunda rodada)

| hipótese | como foi descartada |
|---|---|
| `addRevision` deduplica por `contentHash` | **falso** — `skills-store.ts:244` insere incondicionalmente, com `revisionId` novo a cada chamada |
| worker antigo competindo pela fila | **era real, e não bastou.** Sobreviviam `:18740` e `:18750`, de antes da correção, contra o mesmo banco. Encerrados; com **uma única** instância corrigida o defeito persiste |
| job incompleto | **falso** — `pgboss.job` confirma `mask=["skillMd"]`, `payload_b64`, `content_hash` e `frontmatter` todos presentes |
| guarda de estado terminal em `runOperationJob:92` | **falso** — a operação sai de `PENDING`, e `create_time != update_time` prova que `updateState` rodou, logo `action()` executou |
| guardas ausentes no `dist` | **falso** — `grep` no compilado acha a condição nos dois arquivos |

**Onde parei:** `action()` comprovadamente executa e a revisão não aparece. Resta instrumentar o
bloco `if` dentro do handler de update — logar cada subcondição — ou verificar se `data` no
handler é o payload do job ou o envelope do pg-boss (uma mudança de assinatura faria `data.mask`
ser `undefined`, e `undefined.includes` lançaria… ou não, se houver captura silenciosa acima).

**Custo até aqui:** ~2h. O defeito é de baixo impacto (ninguém usa `PATCH` com `skillMd` hoje,
porque acabou de ser adicionado) e **alto risco de leitura errada** — por isso o CHANGELOG diz
PARCIAL.

## Por que isto está registrado como incompleto

A fronteira aceita e o acervo não muda — que é **pior que a recusa original**, porque o cliente
recebe `202` e acredita ter atualizado. Se este documento sumir, alguém lerá o CHANGELOG e
concluirá que o `PATCH` funciona.

**Próximo passo:** instrumentar `addRevision` ou ler seu contrato de deduplicação.
