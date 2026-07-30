import { type Hono } from 'hono';

import { type AppEnv } from '../principal-context.js';

/**
 * `GET /v1/version` — proveniência do build. SEM autenticação.
 *
 * POR QUE É ISENTO DE CREDENCIAL: o endpoint existe para o chamador distinguir um serviço
 * FORA DO AR de um saudável. Atrás de credencial, "o serviço caiu" e "minha chave está
 * errada" produzem a mesma resposta, e quem agrega não consegue separar os dois casos.
 *
 * O que ele expõe — nome do pacote, versão, commit, hora do build — é a informação que uma
 * imagem publicada já carrega nos próprios labels OCI.
 *
 * Consumido pelo painel `/status` do theo-cloud (`internal/serviceversions/probe.go`), que lê
 * `version` e `built_at`.
 */
export function registerVersionRoutes(app: Hono<AppEnv>): void {
  app.get('/v1/version', (c) =>
    c.json({
      name: '@usetheo/skills-api',
      // OS FALLBACKS SÃO CONTRATO, não enfeite defensivo. Quem agrega versões entre serviços
      // precisa distinguir "respondeu mas não sabe o que é" de "respondeu com versão real".
      // Devolver string vazia — ou omitir o campo — colapsa os dois casos, e quem lê a saída
      // conclui que a requisição falhou quando na verdade ela funcionou.
      version: process.env['THEOSKILL_VERSION'] ?? 'dev',
      git_sha: process.env['THEOSKILL_GIT_SHA'] ?? 'unknown',
      built_at: process.env['THEOSKILL_BUILD_TIME'] ?? 'unknown',
      // `name` e `node` são sempre conhecidos — por isso não têm fallback.
      node: process.version,
    }),
  );
}
