/**
 * Phase 2 — Zod 4 mirror of the backend `CanvasPatch` Pydantic contract.
 *
 * Authoritative source is `backend/app/services/orchestration_authoring/
 * canvas_patch.py`. This module is a frontend best-effort guard that runs at
 * the SSE-receive boundary inside `canvasPatchApplier.apply()`. Drift between
 * the two sides surfaces as a Zod parse failure (which the applier converts
 * into a chat-thread system message rather than a thrown exception).
 *
 * TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client).
 * The shape mirrors `CanvasPatchOp` + `CanvasPatch` exactly; on every backend
 * change to the Pydantic model both sides must move in the same commit.
 */
import { z } from 'zod';

export const CANVAS_PATCH_CONTRACT_ID = 'orchestration.canvas_patch.v1';

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
const PositionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
const AddNodePayloadSchema = z
  .object({
    node_type: z.string().min(1),
    position: PositionSchema.optional(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
const UpdateNodeConfigPayloadSchema = z
  .object({
    config_patch: z.record(z.string(), z.unknown()),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
const ConnectPayloadSchema = z
  .object({
    source_node_id: z.string().min(1),
    output_id: z.string().min(1),
    target_node_id: z.string().min(1),
    edge_id: z.string().min(1),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
const RemoveNodePayloadSchema = z.object({}).strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const CanvasPatchOpSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add_node'),
      node_id: z.string().min(1),
      payload: AddNodePayloadSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('update_node_config'),
      node_id: z.string().min(1),
      payload: UpdateNodeConfigPayloadSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('connect'),
      node_id: z.string().min(1),
      payload: ConnectPayloadSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('remove_node'),
      node_id: z.string().min(1),
      payload: RemoveNodePayloadSchema.default({}),
    })
    .strict(),
]);

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const CanvasPatchSchema = z
  .object({
    workflow_id: z.string().min(1),
    version_id: z.string().nullable().default(null),
    base_data_hash: z.string().min(1),
    ops: z.array(CanvasPatchOpSchema).default([]),
    rationale: z.string().default(''),
  })
  .strict();

export type CanvasPatchOp = z.infer<typeof CanvasPatchOpSchema>;
export type CanvasPatch = z.infer<typeof CanvasPatchSchema>;

export type CanvasPatchAddNodeOp = Extract<CanvasPatchOp, { op: 'add_node' }>;
export type CanvasPatchUpdateNodeConfigOp = Extract<
  CanvasPatchOp,
  { op: 'update_node_config' }
>;
export type CanvasPatchConnectOp = Extract<CanvasPatchOp, { op: 'connect' }>;
export type CanvasPatchRemoveNodeOp = Extract<CanvasPatchOp, { op: 'remove_node' }>;

export type CanvasPatchParseResult =
  | { ok: true; data: CanvasPatch }
  | { ok: false; error: z.ZodError };

/** Best-effort parse — never throws. Caller branches on `.ok`. */
export function parseCanvasPatch(raw: unknown): CanvasPatchParseResult {
  const result = CanvasPatchSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: result.error };
}
