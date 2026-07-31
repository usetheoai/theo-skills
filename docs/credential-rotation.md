# Rotação de credencial

Três tipos de credencial circulam no theo-skills, e eles rotacionam de formas diferentes.
Tratar todos igual é o que produz janela de indisponibilidade — ou, pior, uma credencial
antiga que continua valendo porque ninguém sabia que existia.

## 1. Chave de API interna (`theoskill_live_*`)

Usada por membros do workspace. Emitida por um `admin` em `POST /v1/admin/keys`.

**Rotação sem queda — a ordem importa:**

1. **Emita a nova** antes de revogar a antiga. As duas coexistem: o verificador aceita
   qualquer chave válida e não revogada, então não há janela cega.
2. **Distribua** e confirme que o consumidor já usa a nova (o `key_id` aparece na resposta de
   emissão; correlacione com o log de acesso).
3. **Só então revogue** a antiga: `DELETE /v1/admin/keys/{keyId}`.

Revogar antes de distribuir inverte a ordem e produz exatamente a queda que a coexistência
existe para evitar.

**O valor cru aparece uma única vez**, na emissão. Não há endpoint que o recupere — se
perdeu, emita outra. Isso é deliberado: um endpoint de leitura transformaria um vazamento de
banco no vazamento de todas as credenciais.

## 2. Token de distribuição (`theoskill_dist_*`)

Emitido pelo publisher para os **clientes dele**. Tem **prazo obrigatório** — diferente da
chave interna, onde a expiração é opcional.

A obrigatoriedade não é zelo: uma credencial de terceiro sem prazo é a que ninguém lembra de
revogar, e ela sobrevive à relação comercial que a justificava.

**Rotação:**

1. Emita um token novo para o mesmo bundle, com o TTL desejado.
2. Entregue ao cliente pelo canal combinado.
3. Revogue o anterior — efeito é imediato na requisição seguinte.

**Não é preciso rotacionar token ao corrigir uma skill.** O bundle referencia por *canal*;
promover uma revisão nova propaga a todos os destinatários sem tocar em credencial alguma. Se
alguém está reemitindo tokens a cada correção, o bundle foi montado com revisão fixa — corrija
o bundle, não o processo.

## 3. Token de bootstrap (`theoskill_boot_*`)

A credencial de primeiro acesso, fornecida por variável de ambiente. **Uso único**: consumida
na primeira resolução bem-sucedida.

- Um palpite errado **não** a consome — senão qualquer um faria DoS no primeiro acesso do
  operador.
- Sem a variável, ou com ela vazia, **nada** é aceito. Vazio nega tudo; não aceita tudo.
- Depois de usada, remova a variável do ambiente. Ela não volta a valer, mas deixá-la lá dá a
  impressão de que existe uma porta que já não existe.

## Credencial exposta em texto claro

Se um token apareceu em log, ticket, chat ou histórico de conversa: **considere-o
comprometido, independentemente de ter sido usado**. Revogar é barato; auditar quem viu não é.

1. Revogue imediatamente (`DELETE /v1/admin/keys/{keyId}` ou revogação do token de
   distribuição).
2. Emita a substituta.
3. Verifique o log de acesso da credencial exposta em busca de uso não reconhecido.

O secret scan do CI (`.gitleaks.toml`) reconhece os três formatos com piso de entropia, então
uma credencial real commitada reprova o build. Isso protege o repositório — **não** protege
canais fora dele.
