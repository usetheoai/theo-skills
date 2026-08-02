---
slug: dashboard-ui
date: 2026-08-02
generated_by: roadmap-feature
questions_answered: 4
target_milestone: M29
out_of_scope_overlap: none
status: completed
---

# Feature grill: dashboard-ui

### Q1/4: o que é e por que AGORA

**Pergunta:** O que é esta feature e por que está sendo adicionada agora (o que mudou)?

**Recomendado:** O produto tem 37 rotas HTTP e nenhuma superfície de UI. Deixou de ser
aceitável agora por três fatos medidos em 2026-08-02: (a) o eixo web do gate de live-test ficou
`não-aplicável` por AUSÊNCIA de tela, não por aprovação; (b) a única entrada "Skills" do menu
(`app-sidebar-menus.ts:268`) aponta para `/memory/skills`, que é do theo-memory — quem procura
skills chega no produto errado; (c) operações destrutivas como promover canal só existem por
API, sem confirmação nem visibilidade de quem é afetado.

**Resposta do usuário:** confirmado.

**Nota do entrevistador:** o item (c) é o que mais pesa na priorização — promover canal aponta
TODOS os consumidores do canal para outro conteúdo, e é a operação mais perigosa do produto
justamente por não parecer destrutiva.

### Q2/4: dependências

**Pergunta:** Quais milestones precisam estar `[x]` antes desta feature começar?

**Recomendado:** nenhuma dependência nova. Os que fornecem os dados da tela já estão `[x]`:
M19 (canais e versionamento), M20 (bundles + tokens delegados), M21 (telemetria de adoção),
M22 (vertical Model B — registry alcançável pelos clientes), M23 (categoria e execução).

**Resposta do usuário:** confirmado.

**VERIFICADO, não suposto** — eu havia declarado não saber o que era o M7 e conferi antes de
gravar: `M7 — [ ] Integração Theokit (remote skill provider) + dogfood`. É o MESMO eixo do M28
(a ponte remota para o Theokit), não o da interface.

Portanto os dois milestones abertos ficam FORA das dependências, e a razão é a mesma para ambos:
M7/M28 tratam de um AGENTE carregar skill sem disco; a tela trata de um HUMANO navegar o
registro. Amarrá-los faria a interface esperar por uma decisão de arquitetura entre dois
produtos, que ainda precisa de ADR e do dono.

### Q3/4: Definition of Done

**Pergunta:** Qual é a DoD verificável (3-5 itens)?

**Resposta do usuário:** confirmado o recomendado.

1. A navegação abre PELO MENU, verificada clicando a partir da raiz — entrada em `Capabilities`
   com `drillsInto: 'skills'`, o objeto `skills:` com as telas, E a linha em `resolveActiveMenu`.
   As três. Verificação por CLIQUE, nunca por URL digitada.
2. Jornada de leitura ponta a ponta: listar skills -> abrir detalhe -> ver versões e canais ->
   ver a instrução resolvida. Afirmando CONTEÚDO, não status HTTP.
3. Promover canal exige confirmação que diz O QUE DEIXA DE VALER — `ConfirmDialog` canônico com
   frase digitada, e o texto nomeia quantos consumidores do canal passam a receber outro
   conteúdo.
4. Lógica de projeção e validação testada FORA do React; handlers de mock registrados para a
   jornada entrar no e2e hermético.
5. UM e2e cobre a jornada inteira, não um por tela.

**Nota do entrevistador:** o item 1 custou um milestone inteiro no theo-trust — quatro telas
declaradas, submenu completo, e o menu nunca abriu porque faltava a linha de resolução; três
rodadas de validação passaram por cima porque validavam abrindo a URL, que é o único caminho que
o usuário real NÃO tem.

ESCOPO DELIBERADAMENTE FORA: escrita (publicar/republicar skill pela tela). É escopo maior e pode
virar milestone próprio. Confirmado pelo usuário.

### Q4/4: riscos NOVOS

**Resposta do usuário:** confirmados os dois.

RISCO 1 — a tela mostrar o que o serviço não manda, e o defeito PARECER de interface. Três casos
reais do theo-trust registrados no CLAUDE.md: campo que a jornada exige ausente na resposta (o
painel de detalhe virou código morto em produção); mensagem de erro escrita para terminal
("Run: theo login" para quem está no navegador); o mesmo dado em dois formatos (a coluna ficou
vazia exatamente nas linhas que o operador criou).
Mitigação: ao desenhar cada endpoint, perguntar qual é a PRÓXIMA AÇÃO de quem lê aquela lista.

RISCO 2 — o menu declarado e inalcançável. Já custou um milestone. A DoD item 1 mitiga, mas o
risco persiste porque a falha é SILENCIOSA: as telas funcionam, só não há como chegar nelas
clicando.

NÃO listado, e o porquê: "a tela ficar fora de sincronia com as 37 rotas" não é risco desta
feature — é consequência de a interface nascer num repo diferente do produto, e já vale para
theo-trust, theo-lens e theo-memory. Risco existente do ecossistema, não novo.

### Passo 5 — SOTA delta

PULADO. As referências existentes bastam: a implementação de referência é o theo-trust, que vive
no próprio workspace e não é peer externo. Nenhum clone novo, `_catalog.md` intocado.
