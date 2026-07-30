# Política de segurança

## Reportar uma vulnerabilidade

**Não abra issue pública para vulnerabilidade.** Use o canal privado:

- **GitHub Security Advisories** — aba *Security* → *Report a vulnerability* neste repositório.
- Ou e-mail para **security@usetheo.dev** com `[theo-skills]` no assunto.

Inclua, no que se aplicar: versão ou commit afetado, passos de reprodução, impacto observado
e qualquer evidência (log, request, payload). **Nunca inclua credenciais reais no relato** —
descreva o formato, não o valor.

Resposta inicial em até **72 horas úteis**. Coordenamos a divulgação com quem reportou; o
crédito é dado salvo pedido em contrário.

## Escopo

Este repositório é um **registry de skills de agentes**. As superfícies com maior consequência:

| Superfície | Por que importa |
|---|---|
| Validação de payload (`packages/core/src/domain/payload-validator.ts`) | O pacote é um zip de terceiro: path traversal, symlink, zip bomb e profundidade são barrados aqui |
| Varredura de segredos no upload | Uma skill publicada com credencial embutida vaza para quem a baixar |
| Conteúdo executável | Skills carregam `scripts/`. Quem consome o registry **executa** esse conteúdo |
| Webhooks | A URL é fornecida pelo usuário — SSRF é risco de projeto, não hipótese |

## Limitações conhecidas nesta fase

Honestidade sobre o estado real, para você não reportar como falha o que ainda não foi construído:

- **Não há autenticação.** Quem alcança a API publica, lê e deleta qualquer skill. Autenticação
  é o milestone **M12**; controle de acesso por workspace é **M11**; papéis são **M13**.
- **Não há isolamento multi-tenant.** Todas as skills vivem num espaço único.
- **Não há limite de taxa.** Rate limiting é **M17**.

Enquanto isso for verdade, **não exponha esta API à internet pública** — rode atrás de uma
fronteira que autentique.

## Versões suportadas

Pré-1.0: apenas a última versão publicada recebe correção de segurança.
