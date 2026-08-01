import { z } from 'zod';

import { parseSkillId } from '../domain/skill-id.js';

/**
 * Operation lifecycle states (M2). In-progress states reflect the job type
 * (CREATING/UPDATING/DELETING); terminal states are ACTIVE (succeeded) / FAILED.
 */
export const OperationStateSchema = z.enum([
  'CREATING',
  'UPDATING',
  'DELETING',
  'ACTIVE',
  'FAILED',
]);
export type OperationState = z.infer<typeof OperationStateSchema>;

/** Webhook event types emitted on operation completion. */
export const WebhookEventTypeSchema = z.enum([
  'skill.created',
  'skill.updated',
  'skill.deleted',
]);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

/** Webhook payload delivered to subscribed endpoints. */
export const WebhookPayloadSchema = z.object({
  event_id: z.string(),
  event_type: WebhookEventTypeSchema,
  data: z.object({
    skill_id: z.string(),
    operation_id: z.string(),
    state: z.enum(['ACTIVE', 'FAILED']),
    occurred_at: z.string(),
  }),
});
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

/** Input for POST /v1/webhookEndpoints. `event_types` empty/absent = all events. */
export const WebhookEndpointCreateSchema = z.object({
  url: z.string().url('url must be a valid absolute URL'),
  event_types: z.array(WebhookEventTypeSchema).optional(),
});
export type WebhookEndpointCreate = z.infer<typeof WebhookEndpointCreateSchema>;

/** Public webhook-endpoint representation (secret is NEVER included here). */
export const WebhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  active: z.boolean(),
  event_types: z.array(WebhookEventTypeSchema).nullable(),
  create_time: z.string(),
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

/** Create response — the only time `secret` is ever returned. */
export const WebhookEndpointCreatedSchema = WebhookEndpointSchema.extend({
  secret: z.string(),
});
export type WebhookEndpointCreated = z.infer<typeof WebhookEndpointCreatedSchema>;

/** Input payload for POST /v1/skills. Minimal in M0 (Theokit-aligned fields). */
export const SkillInputSchema = z
  .object({
    skill_id: z.string(),
    name: z.string().min(1, 'name is required').max(255),
    description: z.string().max(4096).default(''),
  })
  .superRefine((val, ctx) => {
    try {
      parseSkillId(val.skill_id);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skill_id'],
        message: err instanceof Error ? err.message : 'invalid skill_id',
      });
    }
  });
export type SkillInput = z.infer<typeof SkillInputSchema>;

/** Public skill representation (GET /v1/skills/{id}). */
export const SkillSchema = z.object({
  skill_id: z.string(),
  name: z.string(),
  description: z.string(),
  state: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

/** Public operation representation (GET /v1/operations/{id}). */
export const OperationSchema = z.object({
  operation_id: z.string(),
  skill_id: z.string(),
  type: z.string(),
  state: OperationStateSchema,
  error: z.string().nullable(),
});
export type Operation = z.infer<typeof OperationSchema>;

/** Retrieval strategy (M4). `hybrid` fuses lexical + vector via RRF. */
export const RetrieveStrategySchema = z.enum(['vector', 'keyword', 'hybrid']);
export type RetrieveStrategy = z.infer<typeof RetrieveStrategySchema>;

/** Query params for GET /v1/skills:retrieve (M4). */
export const RetrieveParamsSchema = z.object({
  query: z.string().min(1, 'query is required').max(8192),
  top_k: z.coerce.number().int().min(1).max(50).default(5),
  strategy: RetrieveStrategySchema.default('hybrid'),
  category: z.string().min(1).max(64).optional(),
});
export type RetrieveParamsInput = z.infer<typeof RetrieveParamsSchema>;

/** A scored retrieve result. Score semantics are STRATEGY-DEPENDENT (cosine for
 * vector ~0.7-1.0, ts_rank for keyword, RRF fraction ~1/60 for hybrid) — clients
 * order by it; they MUST NOT compare scores across strategies. */
export const RetrieveResultSchema = z.object({
  skill_id: z.string(),
  score: z.number(),
  name: z.string(),
  description: z.string(),
});
export type RetrieveResult = z.infer<typeof RetrieveResultSchema>;

/** Papéis de workspace (M13). */
export const MemberRoleSchema = z.enum(['owner', 'admin', 'member']);
/** Corpo de `PATCH /v1/members/{userId}`. */
export const MemberChangeRoleSchema = z.object({ role: MemberRoleSchema });
/** Corpo de `PUT /v1/members`. */
export const MemberAddSchema = z.object({ user_id: z.string().min(1), role: MemberRoleSchema });
