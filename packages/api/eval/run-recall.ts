import { createId } from '@paralleldrive/cuid2';
import { stubEmbed } from '@usetheo/skills';
import { type Pool } from 'pg';

import { type DispatchingRetriever } from '../src/server/providers/retriever-selection.js';

export interface EvalSkill {
  skill_id: string;
  name: string;
  description: string;
  body: string;
}
export interface EvalCase {
  query: string;
  expected: string;
}
export interface EvalDataset {
  skills: EvalSkill[];
  cases: EvalCase[];
}

export interface EvalReport {
  readonly n: number;
  readonly recallAt5: number;
  readonly p95Ms: number;
  readonly latenciesMs: number[];
  readonly misses: string[];
}

/** Index every eval skill (search_text + current-revision stub embedding). */
export async function seedDataset(pool: Pool, dataset: EvalDataset): Promise<void> {
  for (const s of dataset.skills) {
    const revisionId = `rev_${createId()}`;
    const searchText = `${s.name} ${s.description} ${s.body}`;
    await pool.query(
      `INSERT INTO skills (skill_id, name, description, latest_revision_id, search_text) VALUES ($1,$2,$3,$4,$5)`,
      [s.skill_id, s.name, s.description, revisionId, searchText],
    );
    await pool.query(
      `INSERT INTO skill_revisions (revision_id, skill_id, payload, content_hash, frontmatter, skill_md)
       VALUES ($1,$2,'\\x00','h','{}'::jsonb,$3)`,
      [revisionId, s.skill_id, s.body],
    );
    const v = stubEmbed(searchText);
    await pool.query(
      `INSERT INTO embeddings (id, revision_id, skill_id, provider, model, dimensions, vector)
       VALUES ($1,$2,$3,'stub','stub',1536,$4::vector)`,
      [`emb_${createId()}`, revisionId, s.skill_id, `[${v.join(',')}]`],
    );
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/**
 * Run the eval: for each case, retrieve hybrid topK=5 and check the expected
 * skill is in the top-5. Returns Recall@5 + retrieve latency distribution (p95).
 * Reproducible: deterministic stub embedder + versioned dataset.
 */
export async function runRecallEval(
  retriever: DispatchingRetriever,
  dataset: EvalDataset,
  strategy: 'vector' | 'keyword' | 'hybrid' = 'hybrid',
): Promise<EvalReport> {
  let hits = 0;
  const latencies: number[] = [];
  const misses: string[] = [];
  for (const c of dataset.cases) {
    const start = performance.now();
    const results = await retriever.retrieve({ query: c.query, topK: 5, strategy });
    latencies.push(performance.now() - start);
    const top5 = results.slice(0, 5).map((r) => r.skill_id);
    if (top5.includes(c.expected)) {
      hits += 1;
    } else {
      misses.push(`${c.query} → expected ${c.expected}, got [${top5.join(', ')}]`);
    }
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    n: dataset.cases.length,
    recallAt5: hits / dataset.cases.length,
    p95Ms: percentile(sorted, 95),
    latenciesMs: latencies,
    misses,
  };
}
