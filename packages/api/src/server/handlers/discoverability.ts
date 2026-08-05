import { diagnoseDiscoverability, type NeighbourCandidate } from '@usetheo/skills';
import { type Hono } from 'hono';

import { requireScope } from '../auth/middleware.js';
import { type AppEnv } from '../principal-context.js';

/**
 * M34 — `POST /v1/skills:discoverability`: a skill é achada pela intenção que deveria encontrá-la?
 *
 * Rota PRÓPRIA, e não um campo a mais no `:validate` do M30, por duas razões que não são de
 * organização:
 *
 *  1. As perguntas são diferentes. `:validate` responde "é válida?" — sintaxe e frontmatter.
 *     Esta responde "é achável?" — e uma skill válida e inachável é, para quem procura,
 *     indistinguível de uma que não existe.
 *  2. Esta precisa do **acervo** (compara a candidata com as neighbours); aquela não toca o banco.
 *     Fundir faria toda validação de sintaxe pagar o custo de uma busca vetorial.
 *
 * **Nada aqui executa a skill.** Não invoca script, não abre sandbox, não carrega runtime — a
 * fronteira "execução é responsabilidade do Theokit" permanece intacta, e é verificável: as
 * únicas dependências são a busca (leitura) e o diagnóstico (função pura).
 *
 * Exige apenas `skills:read`: diagnosticar não escreve nada, e pedir escopo de escrita obrigaria
 * quem só quer conferir um rascunho a carregar a credencial que publica.
 */
export interface DiscoverabilityRoutesDeps {
  /**
   * Busca as skills mais próximas de um texto, no acervo do workspace.
   *
   * Porta declarada no CONSUMIDOR (DIP): este handler não conhece pgvector nem RRF — só precisa
   * saber quem se parece com a candidata, e quanto.
   */
  readonly vizinhasDe: (
    workspaceId: string,
    texto: string,
    topK: number,
  ) => Promise<readonly NeighbourCandidate[]>;
  /** Qual embedder produziu os vetores — vai no relatório. Ver § risco #1 do milestone. */
  readonly embedderName: () => string;
}

/** Quantas neighbours consultar. Cinco é o bastante para achar a rival mais próxima sem custo. */
const TOP_K_VIZINHAS = 5;

export function registerDiscoverabilityRoutes(app: Hono<AppEnv>, deps: DiscoverabilityRoutesDeps): void {
  app.post('/v1/skills:discoverability', requireScope('skills:read'), async (c) => {
    const principal = c.get('principal') as { workspaceId?: string } | undefined;
    if (principal?.workspaceId === undefined) return c.json({ error: 'forbidden' }, 403);

    const body = (await c.req.json().catch(() => null)) as
      | { name?: unknown; description?: unknown; has_embedding?: unknown; skill_id?: unknown }
      | null;

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    if (name === '' || description === '') {
      return c.json(
        { error: 'invalid_request', details: 'name and description are required' },
        400,
      );
    }

    // Um rascunho AINDA NÃO publicado não tem vetor por definição — e isso não é defeito dele.
    // Quem consulta declara; **omitir** o campo significa "ainda não publiquei", que é o caso da
    // tela de autoria.
    //
    // Este comentário já estava aqui e o código NÃO o honrava: fazia `has_embedding === true`,
    // que colapsa ausente e `false` no mesmo valor. Um rascunho era acusado de não ter vetor, com
    // o conselho "republique" — impossível para algo nunca publicado — e essa causa, disparando
    // sempre, encobria as que o autor podia corrigir (theo-skills#144).
    //
    // A distinção que o protocolo já carregava:
    //   campo AUSENTE  → rascunho: não há revisão, logo `no_embedding` não se aplica
    //   `false`        → published e sem vetor: achado real, a ingestão falhou ou não rodou
    //   `true`         → published e com vetor
    const revision =
      body?.has_embedding === undefined
        ? ({ published: false } as const)
        : ({ published: true, hasVector: body.has_embedding === true } as const);
    const skillId = typeof body?.skill_id === 'string' ? body.skill_id : '';

    const encontradas = await deps.vizinhasDe(principal.workspaceId, `${name} ${description}`, TOP_K_VIZINHAS);
    // A PRÓPRIA skill não é vizinha de si mesma: numa re-análise ela apareceria com similarity
    // ~1.0 e o diagnóstico acusaria colisão consigo, que é conselho impossível de seguir.
    const neighbours = skillId === '' ? encontradas : encontradas.filter((v) => v.skillId !== skillId);

    const diagnostico = diagnoseDiscoverability({ name, description, revision, neighbours });

    return c.json(
      {
        ...diagnostico,
        // O embedder viaja no resultado porque o número mede o embedder tanto quanto a skill —
        // risco #1 declarado no milestone. Comparar resultados de embedders diferentes é
        // comparar coisas distintas, e sem este campo ninguém percebe que fez isso.
        embedder: deps.embedderName(),
      },
      200,
    );
  });
}
