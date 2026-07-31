import { type Skill, type WorkspaceClient } from './client.js';
import { classifyError } from './error-classifier.js';

/**
 * O formato que o Theokit consome — `CreateSkillSpec` do `@theokit/sdk` (M7 DoD #2).
 *
 * VERIFICADO CONTRA O SDK REAL (4.36.0), e o contrato é diferente do que o ROADMAP
 * descrevia. O roadmap dizia `Skill { name, description, source, version, category? }`; o
 * SDK aceita `{ name, description, instructions, category?, dependencies?, references? }` —
 * **sem `source`, sem `version`, e com `instructions` OBRIGATÓRIO**.
 *
 * A diferença não é cosmética. `Skill.create` ACEITA um objeto sem `instructions` e devolve
 * uma skill com `source: 'inline://<name>'` — ou seja, uma skill **sem corpo**, que o agente
 * carrega e não tem o que executar. Falha silenciosa: compila, aceita, e não funciona.
 *
 * Só apareceu ao instalar o SDK e construir uma skill de verdade. Enquanto o formato era
 * conferido contra a descrição do roadmap, tudo parecia certo.
 */
export interface TheokitSkill {
  readonly name: string;
  readonly description: string;
  /** O corpo da skill — o que o agente de fato executa. Sem isto, a skill é casca. */
  readonly instructions: string;
  readonly category?: string;
  readonly dependencies?: readonly string[];
}

export interface RemoteSkillsManagerOptions {
  readonly client: WorkspaceClient;
  /** Skills locais usadas quando o registry não responde (M7 DoD #1). */
  readonly localFallback?: readonly TheokitSkill[];
  /** TTL do cache em ms. */
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
  readonly onDegraded?: (motivo: string) => void;
  /**
   * Carrega o CORPO de cada skill devolvida pela busca (M24).
   *
   * Desligado por padrão: a busca é barata e devolve resumo, e carregar N corpos para
   * mostrar uma lista encheria a janela de contexto com o que o agente não vai ler. Ligue
   * quando o consumidor de fato injeta as instruções — que é o caso do provider Theokit.
   */
  readonly loadInstructions?: boolean;
}

export interface RemoteSkillsManager {
  /** Resolve skills por intenção. Nunca lança — degrada para o fallback local. */
  resolve(query: string, topK?: number): Promise<TheokitSkill[]>;
  /** `true` quando a última resolução veio do fallback, não do registry. */
  isDegraded(): boolean;
}

/**
 * Converte para o `CreateSkillSpec` do Theokit.
 *
 * `instructions` recebe o corpo quando o registry o fornece. Quando NÃO fornece, o texto de
 * fallback DIZ isso em vez de ficar vazio: uma string vazia produziria uma skill que o agente
 * carrega e da qual não extrai comportamento algum — e ele não teria como saber por quê.
 */
const toTheokit = (s: Skill): TheokitSkill => ({
  name: s.name,
  description: s.description,
  instructions:
    s.instructions !== undefined && s.instructions !== ''
      ? s.instructions
      : `(corpo indisponível no registry para "${s.name}" — a busca devolve resumo; ` +
        `obtenha a revisão para as instruções completas)`,
  ...(s.origin !== undefined ? { category: s.origin } : {}),
});

/**
 * Provider remoto de skills para o Theokit (M7 DoD #1 e #2).
 *
 * **Consumidor real do SDK** — é o que fecha o wiring triad do M16: um SDK sem consumidor é
 * uma biblioteca que compila e ninguém exerce, e o M16 declara explicitamente que "o SDK não
 * é entregue sem um consumidor real".
 *
 * NUNCA LANÇA. Um agente no meio de uma tarefa não deve morrer porque o registry piscou —
 * ele degrada para as skills locais e sinaliza a degradação. Essa é a diferença entre
 * indisponibilidade do registry e indisponibilidade do agente, e confundi-las transformaria
 * um incidente nosso num incidente de todos os clientes ao mesmo tempo.
 */
export function createRemoteSkillsManager(opts: RemoteSkillsManagerOptions): RemoteSkillsManager {
  const now = opts.now ?? (() => Date.now());
  const ttl = opts.cacheTtlMs ?? 60_000;
  const cache = new Map<string, { at: number; skills: TheokitSkill[] }>();
  let degraded = false;

  return {
    async resolve(query, topK = 5) {
      const chave = `${query}::${String(topK)}`;
      const hit = cache.get(chave);
      if (hit !== undefined && now() - hit.at < ttl) {
        degraded = false;
        return hit.skills;
      }

      try {
        const encontradas = await opts.client.retrieve(query, topK);
        // Carga sob demanda: o corpo mora no servidor, e só é buscado para as skills que
        // de fato vão ao prompt. Uma falha em UMA não pode derrubar as outras — o agente
        // fica com o resumo dela e segue, que é melhor que não receber nenhuma.
        const skills = opts.loadInstructions === true
          ? await Promise.all(
              encontradas.map(async (s) => {
                try {
                  const corpo = await opts.client.instructions(s.skill_id);
                  return corpo === null ? toTheokit(s) : toTheokit({ ...s, instructions: corpo.instructions });
                } catch {
                  return toTheokit(s);
                }
              }),
            )
          : encontradas.map((s) => toTheokit(s));
        cache.set(chave, { at: now(), skills });
        degraded = false;
        return skills;
      } catch (err) {
        degraded = true;
        opts.onDegraded?.(classifyError(err).message);

        // Cache VENCIDO é melhor que fallback: são as skills reais do tenant, apenas
        // desatualizadas. Descartá-lo por rigor de TTL entregaria um conjunto mais pobre
        // exatamente no momento em que o registry não pode complementá-lo.
        if (hit !== undefined) return hit.skills;
        return [...(opts.localFallback ?? [])];
      }
    },

    isDegraded() {
      return degraded;
    },
  };
}
