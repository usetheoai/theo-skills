/** Public barrel for the skill retrievers domain (port + adapters + RRF). */
export {
  type RetrieveParams,
  type MatchedLeg,
  type RetrievedSkill,
  type SkillRetriever,
  type QueryExecutor,
  RetrieverError,
} from './types.js';
export { ParamBuilder } from './param-builder.js';
export { createVectorRetriever, type VectorRetrieverDeps } from './vector-retriever.js';
export { createKeywordRetriever, type KeywordRetrieverDeps } from './keyword-retriever.js';
export { createHybridRetriever,
  RetrieverTimeoutError, type HybridRetrieverDeps, rrfFuse, RRF_K, FUSION_POOL } from './hybrid-retriever.js';
