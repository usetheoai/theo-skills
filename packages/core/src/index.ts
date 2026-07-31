export {
  InvalidSkillIdError,
  isValidSkillId,
  parseSkillId,
} from './domain/skill-id.js';
export {
  type EmbeddingProvider,
  type EmbedOptions,
  EmbedderError,
  EMBEDDING_DIM,
  assertEmbeddingDim,
  createStubEmbedder,
  stubEmbed,
  type StubEmbedderOptions,
  createOpenAIEmbedder,
  type OpenAIEmbedderOptions,
  type OpenAIEmbeddingsClient,
} from './domain/embedders/index.js';
export {
  type RetrieveParams,
  type RetrievedSkill,
  type SkillRetriever,
  type QueryExecutor,
  RetrieverError,
  ParamBuilder,
  createVectorRetriever,
  type VectorRetrieverDeps,
  createKeywordRetriever,
  type KeywordRetrieverDeps,
  createHybridRetriever,
  type HybridRetrieverDeps,
  rrfFuse,
  RRF_K,
  FUSION_POOL,
} from './domain/retrievers/index.js';
export {
  type FrontmatterErrorCode,
  parseFrontmatter,
  type SkillFrontmatter,
  SkillFrontmatterError,
} from './domain/frontmatter.js';
export {
  type PayloadErrorCode,
  type PayloadFile,
  type PayloadValidator,
  PayloadValidationError,
  type ValidatedPayload,
} from './domain/payload-validator.js';
export {
  type SecretFinding,
  type SecretScanner,
} from './domain/secret-scanner.js';
export {
  type SkillValidationDeps,
  type SkillValidationOk,
  type SkillValidationFail,
  type SkillValidationResult,
  validateSkillPayload,
} from './domain/skill-validation.js';
export {
  MAX_COMPRESSION_RATIO,
  MAX_DESCRIPTION_LENGTH,
  MAX_FOLDER_DEPTH,
  MAX_NAME_LENGTH,
  MAX_SINGLE_FILE_BYTES,
  MAX_UNCOMPRESSED_TOTAL_BYTES,
  MAX_ZIP_ENTRIES,
} from './domain/limits.js';
export {
  type Operation,
  OperationSchema,
  type OperationState,
  OperationStateSchema,
  type RetrieveStrategy,
  RetrieveStrategySchema,
  type RetrieveParamsInput,
  RetrieveParamsSchema,
  type RetrieveResult,
  RetrieveResultSchema,
  type Skill,
  SkillSchema,
  type SkillInput,
  SkillInputSchema,
  type WebhookEndpoint,
  WebhookEndpointSchema,
  type WebhookEndpointCreate,
  WebhookEndpointCreateSchema,
  type WebhookEndpointCreated,
  WebhookEndpointCreatedSchema,
  type WebhookEventType,
  WebhookEventTypeSchema,
  type WebhookPayload,
  WebhookPayloadSchema,
} from './contract/index.js';
export { NonRetriableOperationError } from './domain/operation-errors.js';
export {
  type WebhookSender,
  type WebhookSendRequest,
  type WebhookSendResponse,
} from './domain/webhook-sender.js';
export {
  operations,
  type OperationRow,
  skills,
  type SkillRow,
} from './infrastructure/db/schema.js';

// M11 — tipos do isolamento multi-inquilino.
export * from './domain/principal.js';
export * from './domain/scope.js';
export * from './domain/dip/auth-verifier.js';

