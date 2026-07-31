/**
 * Validadores de payload — barril do subpath `@usetheo/skills/validators`.
 *
 * Vivem no `core` e não no `api` porque a CLI precisa deles no caminho de PRODUÇÃO
 * (`theoskill validate` e `publish` validam antes de enviar). Enquanto moravam no servidor,
 * publicar a CLI no npm arrastaria pg-boss, drizzle e hono para dentro de um cliente de
 * linha de comando — dependências de servidor num pacote que nunca sobe um servidor.
 *
 * A porta (`PayloadValidator`, `SecretScanner`) sempre foi do domínio; só as implementações
 * estavam do lado errado da fronteira.
 */
export { createYauzlPayloadValidator } from './payload-validator.js';
export { createSecretlintScanner } from './secret-scanner.js';

// `zip-guards` é detalhe interno do validador, exportado para os testes que o exercitam
// diretamente — as guardas de zip-bomb merecem teste próprio, não só pela borda.
export * from './zip-guards.js';
