/**
 * Phase 14 / Phase D — typed Zod 4 contract for orchestration node configs.
 *
 * Why this exists: pre-Phase-14, `WorkflowDefinitionNode.config` was
 * `Record<string, unknown>`, normalisers (`normalizeSplitConfigForMode`,
 * `normalizePredicateValueForOperator`) ran only at event-time (dropdown
 * change), and stale shapes survived hydrate → save → run. This module is
 * the single parse boundary: every node config crossing into the store
 * goes through `parseNodeConfig`, which runs the type discriminator + the
 * .transform()s that subsume the old event-time normalisers.
 *
 * Authoritative contract is **backend Pydantic**. These schemas are a
 * frontend best-effort guard. Drift surfaces at publish time as a
 * structured 422 (see `errorDecoder.ts`).
 *
 * TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client).
 * Every schema below carries a TODO marker so the migration is mechanical.
 *
 * Strictness policy (Phase D, log+continue mode):
 *   - schemas use `.strict()` so unknown keys surface as `_parseIssues`.
 *   - draft-authoring parses ignore omitted required fields so a brand-new
 *     blank node (or a saved draft still being filled in) does not light up
 *     the banner immediately.
 *   - parse failures DO NOT block writes — the store annotates the node
 *     with `_parseIssues` and writes anyway. Banner surfaces issues; user
 *     can repair before publish. Backend remains the publish-time
 *     authority on what is valid.
 */
import { z } from "zod";

import {
  normalizePredicateValueForOperator,
  type PredicateOperatorValueKind,
} from "@/features/orchestration/components/editors/operatorContracts";
import type { PredicateOp } from "@/features/orchestration/types";

// ─── Shared sub-schemas ─────────────────────────────────────────────────

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
const AttemptPolicySchema = z
  .object({
    max_attempts: z.number().int().min(1).default(1),
    backoff_kind: z
      .enum(["immediate", "fixed_delay", "exponential"])
      .default("immediate"),
    delay_minutes: z.number().min(0).default(0),
    retry_on: z.array(z.string()).default([]),
    on_exhausted_output_id: z.string().default("exhausted"),
  })
  .strict();

/** Mirrors backend `predicate_contract.parse_predicate`. Recursive — uses
 *  the lazy-evaluator so AND/OR/NOT can reference itself. The leaf schema's
 *  `.transform()` runs `normalizePredicateValueForOperator` so any stale
 *  value shape carried over from a previous operator gets canonicalised at
 *  parse-time (the old event-time call in `PredicateBuilder.tsx` is gone).
 */
// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
const LeafPredicateSchema = z
  .object({
    field: z.string(),
    op: z.enum([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "in",
      "not_in",
      "contains",
      "exists",
      "missing",
    ]),
    value: z.unknown().optional(),
  })
  .strict()
  .transform((leaf) => {
    const op = leaf.op as PredicateOp;
    const normalized = normalizePredicateValueForOperator(leaf.value, op);
    if (normalized === undefined) {
      const rest = { ...leaf };
      delete rest.value;
      return rest;
    }
    return { ...leaf, value: normalized };
  });

type LeafPredicateInput = z.input<typeof LeafPredicateSchema>;
type LeafPredicateOutput = z.output<typeof LeafPredicateSchema>;

interface AndPredicateInput {
  and: PredicateAstInput[];
}
interface AndPredicateOutput {
  and: PredicateAstOutput[];
}
interface OrPredicateInput {
  or: PredicateAstInput[];
}
interface OrPredicateOutput {
  or: PredicateAstOutput[];
}
interface NotPredicateInput {
  not: PredicateAstInput;
}
interface NotPredicateOutput {
  not: PredicateAstOutput;
}

type PredicateAstInput =
  | LeafPredicateInput
  | AndPredicateInput
  | OrPredicateInput
  | NotPredicateInput;

type PredicateAstOutput =
  | LeafPredicateOutput
  | AndPredicateOutput
  | OrPredicateOutput
  | NotPredicateOutput;

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
const PredicateAstSchema: z.ZodType<PredicateAstOutput, PredicateAstInput> =
  z.lazy(() =>
    z.union([
      z.object({ and: z.array(PredicateAstSchema).min(1) }).strict(),
      z.object({ or: z.array(PredicateAstSchema).min(1) }).strict(),
      z.object({ not: PredicateAstSchema }).strict(),
      LeafPredicateSchema,
    ]),
  ) as z.ZodType<PredicateAstOutput, PredicateAstInput>;

// ─── Per-node schemas ───────────────────────────────────────────────────
// All carry `nodeType` as a literal discriminator so the registry-level
// `NodeConfigSchema` is `z.discriminatedUnion('nodeType', [...])`.

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
// Filter operators mirror backend `_cohort_query_compiler._SUPPORTED_OPS`.
// Backend validation rejects any other op as a fabricated value.
// Kept exported because cohort-definition edit forms reuse the same enum.
export const COHORT_FILTER_OPS = [
  "eq",
  "neq",
  "gte",
  "gt",
  "lte",
  "lt",
  "in",
  "not_in",
  "contains",
] as const;

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const SourceSavedCohortConfigSchema = z
  .object({
    nodeType: z.literal("source.saved_cohort"),
    cohort_definition_version_id: z.uuid(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const SourceDatasetConfigSchema = z
  .object({
    nodeType: z.literal("source.dataset"),
    dataset_version_id: z.uuid(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const SourceEventTriggerConfigSchema = z
  .object({
    nodeType: z.literal("source.event_trigger"),
    next_node_id: z.string().nullable().optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const FilterConsentGateConfigSchema = z
  .object({
    nodeType: z.literal("filter.consent_gate"),
    channel: z.enum(["wa", "voice", "sms", "email"]),
    consent_policy: z
      .enum(["permissive", "explicit_optin"])
      .default("permissive"),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const FilterEligibilityConfigSchema = z
  .object({
    nodeType: z.literal("filter.eligibility"),
    predicate: PredicateAstSchema,
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const LogicConditionalConfigSchema = z
  .object({
    nodeType: z.literal("logic.conditional"),
    predicate: PredicateAstSchema,
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
// Mirrors backend `logic_split._Branch` exactly. `predicate` and the
// `by_rules` mode were FE-only inventions — they had no backend handler
// and silently broke at publish. Removed to match the canonical contract.
const SplitBranchSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    match: z.string().nullable().optional(),
    weight: z.number().nullable().optional(),
  })
  .strict();

type SplitBranchOutput = z.output<typeof SplitBranchSchema>;

interface LogicSplitConfigOutput {
  nodeType: "logic.split";
  mode: "by_field" | "random";
  field?: string;
  branches: SplitBranchOutput[];
  default_branch_id?: string;
  drop_unmatched: boolean;
}

function normaliseSplitBranches(
  mode: "by_field" | "random",
  branches: SplitBranchOutput[],
): SplitBranchOutput[] {
  return branches.map((branch) => {
    const base: SplitBranchOutput = { id: branch.id, label: branch.label };
    if (mode === "by_field") {
      return {
        ...base,
        match:
          typeof branch.match === "string"
            ? branch.match
            : branch.match === undefined || branch.match === null
              ? ""
              : String(branch.match),
      };
    }
    return {
      ...base,
      weight: typeof branch.weight === "number" ? branch.weight : 1,
    };
  });
}

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const LogicSplitConfigSchema = z
  .object({
    nodeType: z.literal("logic.split"),
    mode: z.enum(["by_field", "random"]).default("by_field"),
    field: z.string().optional(),
    branches: z.array(SplitBranchSchema).default([]),
    default_branch_id: z.string().optional(),
    drop_unmatched: z.boolean().default(false),
  })
  .strict()
  .transform((cfg): LogicSplitConfigOutput => {
    // Mirrors `splitBranchUtils.normalizeSplitConfigForMode`. Pruning
    // branch fields that don't apply to the active mode keeps the on-wire
    // config minimal — and the editors no longer need to call the
    // normaliser on every dropdown change.
    const mode = cfg.mode;
    const normalisedBranches = normaliseSplitBranches(mode, cfg.branches);
    const stillHasDefault = normalisedBranches.some(
      (b) => b.id === cfg.default_branch_id,
    );
    const next: LogicSplitConfigOutput = {
      nodeType: cfg.nodeType,
      mode,
      branches: normalisedBranches,
      default_branch_id: stillHasDefault ? cfg.default_branch_id : undefined,
      drop_unmatched: cfg.drop_unmatched,
    };
    if (mode === "by_field") {
      next.field = cfg.field ?? "";
    }
    return next;
  });

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
// Mirrors backend `logic_wait._EventCorrelation`. The legacy FE shape
// (`field` / `payload_field`) had no backend equivalent and silently broke
// at publish — narrowed to the canonical `recipient_id_field`.
const EventCorrelationSchema = z
  .object({
    recipient_id_field: z.string(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const LogicWaitConfigSchema = z
  .object({
    nodeType: z.literal("logic.wait"),
    mode: z
      .enum(["duration", "until_datetime", "event", "event_or_timeout"])
      .default("duration"),
    duration_hours: z.number().nullable().optional(),
    until_datetime: z.string().nullable().optional(),
    event_name: z.string().nullable().optional(),
    correlation: EventCorrelationSchema.nullable().optional(),
    event_match: PredicateAstSchema.nullable().optional(),
    timeout_hours: z.number().nullable().optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const LogicMergeConfigSchema = z
  .object({
    nodeType: z.literal("logic.merge"),
    merge_policy: z
      .enum(["dedupe", "last_wins", "merge_lists"])
      .default("dedupe"),
    payload_policy: z
      .enum(["last_wins", "first_wins", "union", "preserve"])
      .default("last_wins"),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const CoreWebhookOutConfigSchema = z
  .object({
    nodeType: z.literal("core.webhook_out"),
    connection_id: z.string().nullable().optional(),
    url: z.string().min(1),
    method: z.enum(["POST", "PUT"]).default("POST"),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.unknown().default({}),
    timeout_seconds: z.number().default(10),
    attempt_policy: AttemptPolicySchema.optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const MessagingSendWhatsappTemplateConfigSchema = z
  .object({
    nodeType: z.literal("messaging.send_whatsapp_template"),
    connection_id: z.uuid(),
    template_slug: z.string().min(1),
    variable_mappings: z.record(z.string(), z.string()).default({}),
    webhook_ttl_seconds: z.number().int().min(60).default(259200),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const VoicePlaceCallConfigSchema = z
  .object({
    nodeType: z.literal("voice.place_call"),
    connection_id: z.uuid(),
    agent_id: z.string().min(1),
    variable_mappings: z.record(z.string(), z.string()).default({}),
    from_phone: z.string().nullable().optional(),
    webhook_ttl_seconds: z.number().int().min(60).default(259200),
    mode: z.enum(["auto", "single", "batch"]).default("auto"),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const SinkCompleteConfigSchema = z
  .object({
    nodeType: z.literal("sink.complete"),
    reason: z.string().nullable().optional(),
  })
  .strict();

// ─── Discriminated union over the registry ──────────────────────────────

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const NodeConfigSchema = z.discriminatedUnion("nodeType", [
  SourceSavedCohortConfigSchema,
  SourceDatasetConfigSchema,
  SourceEventTriggerConfigSchema,
  FilterConsentGateConfigSchema,
  FilterEligibilityConfigSchema,
  LogicConditionalConfigSchema,
  LogicSplitConfigSchema,
  LogicWaitConfigSchema,
  LogicMergeConfigSchema,
  CoreWebhookOutConfigSchema,
  MessagingSendWhatsappTemplateConfigSchema,
  VoicePlaceCallConfigSchema,
  SinkCompleteConfigSchema,
]);

const NODE_TYPE_TO_SCHEMA: Record<
  string,
  | typeof SourceSavedCohortConfigSchema
  | typeof SourceDatasetConfigSchema
  | typeof SourceEventTriggerConfigSchema
  | typeof FilterConsentGateConfigSchema
  | typeof FilterEligibilityConfigSchema
  | typeof LogicConditionalConfigSchema
  | typeof LogicSplitConfigSchema
  | typeof LogicWaitConfigSchema
  | typeof LogicMergeConfigSchema
  | typeof CoreWebhookOutConfigSchema
  | typeof MessagingSendWhatsappTemplateConfigSchema
  | typeof VoicePlaceCallConfigSchema
  | typeof SinkCompleteConfigSchema
> = {
  "source.saved_cohort": SourceSavedCohortConfigSchema,
  "source.dataset": SourceDatasetConfigSchema,
  "source.event_trigger": SourceEventTriggerConfigSchema,
  "filter.consent_gate": FilterConsentGateConfigSchema,
  "filter.eligibility": FilterEligibilityConfigSchema,
  "logic.conditional": LogicConditionalConfigSchema,
  "logic.split": LogicSplitConfigSchema,
  "logic.wait": LogicWaitConfigSchema,
  "logic.merge": LogicMergeConfigSchema,
  "core.webhook_out": CoreWebhookOutConfigSchema,
  "messaging.send_whatsapp_template": MessagingSendWhatsappTemplateConfigSchema,
  "voice.place_call": VoicePlaceCallConfigSchema,
  "sink.complete": SinkCompleteConfigSchema,
};

/** Set of every node type the FE has a schema for. Useful for auditing
 *  hydrate-time issues vs unknown-node-type issues separately. */
export const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set(
  Object.keys(NODE_TYPE_TO_SCHEMA),
);

/** A single parse issue discovered while hydrating or mutating a node config.
 *  Mirrors the FE error decoder's `FieldErrorItem` shape so the canvas
 *  banner and the publish error panel can share the same renderer. */
export interface NodeConfigParseIssue {
  /** Dotted path inside the config (e.g. `branches.0.label`). Empty string
   *  for whole-config / discriminator failures. */
  field: string;
  message: string;
  /** Zod 4 issue code. Surfaces unknown-keys vs required-missing
   *  separately when downstream UIs want to filter. */
  code: string;
}

export type ParseNodeConfigResult =
  | {
      ok: true;
      /** Output of the schema (post-`.transform`). Returned to callers that
       *  want to write the canonicalised value back to the store. */
      data: Record<string, unknown>;
      issues: [];
    }
  | {
      ok: false;
      /** Original raw config, unchanged. Log+continue mode means the store
       *  writes this through and surfaces the issues in the banner. */
      data: Record<string, unknown>;
      issues: NodeConfigParseIssue[];
    };

export interface ParseNodeConfigOptions {
  mode?: "strict" | "draft";
}

const UNKNOWN_NODE_TYPE_CODE = "unknown_node_type";

interface MappedZodIssue {
  path: ReadonlyArray<PropertyKey>;
  message: string;
  code: string;
  keys?: ReadonlyArray<string>;
  input?: unknown;
}

function zodIssuesToParseIssues(
  issues: ReadonlyArray<MappedZodIssue>,
): NodeConfigParseIssue[] {
  return issues.map((iss) => {
    // `unrecognized_keys` (strict-mode failure) carries the offending key
    // names on `keys`, not `path` — surface them so the banner / publish
    // panel can name the field instead of pointing at the whole config.
    if (iss.code === "unrecognized_keys" && iss.keys && iss.keys.length > 0) {
      return {
        field: iss.keys.join(", "),
        message: iss.message,
        code: iss.code,
      };
    }
    return {
      field: iss.path.length ? iss.path.map(String).join(".") : "",
      message: iss.message,
      code: iss.code,
    };
  });
}

function isDraftOmittedRequiredIssue(issue: MappedZodIssue): boolean {
  return (
    issue.code === "invalid_type" &&
    issue.input === undefined &&
    issue.path.length > 0
  );
}

/** Parse one node config against the registered schema. Always returns —
 *  callers in log+continue mode write the raw value back even when
 *  `ok === false`. Strict-mode adoption (fail-closed) is a future toggle.
 *
 *  Inputs may use the on-wire shape (no `nodeType` discriminator on the
 *  config) — this helper inserts the discriminator from the caller-supplied
 *  `nodeType` argument so existing storage shapes keep working.
 *
 *  `mode: 'draft'` is the store-facing authoring path. It suppresses
 *  parse issues that are only "required field omitted" so incomplete draft
 *  nodes do not appear structurally invalid while the operator is still
 *  filling them out. Unknown keys and wrong provided types still surface. */
export function parseNodeConfig(
  nodeType: string,
  rawConfig: unknown,
  options?: ParseNodeConfigOptions,
): ParseNodeConfigResult {
  const schema = NODE_TYPE_TO_SCHEMA[nodeType];
  const config =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>)
      : {};
  if (!schema) {
    // Unknown node type — keep the config as-is and surface the issue.
    // Hydrate of an old / experimental node should not blank its config.
    return {
      ok: false,
      data: config,
      issues: [
        {
          field: "",
          message: `unknown node type: ${nodeType}`,
          code: UNKNOWN_NODE_TYPE_CODE,
        },
      ],
    };
  }
  const candidate = { nodeType, ...config };
  const result = schema.safeParse(candidate);
  if (result.success) {
    // Strip the discriminator before writing back — on-wire shape never
    // carried `nodeType` and we want the parsed/transformed config to
    // round-trip exactly.
    const rest = { ...(result.data as Record<string, unknown>) };
    delete rest.nodeType;
    return { ok: true, data: rest, issues: [] };
  }
  const issues =
    options?.mode === "draft"
      ? result.error.issues.filter(
          (issue) => !isDraftOmittedRequiredIssue(issue),
        )
      : result.error.issues;
  if (options?.mode === "draft" && issues.length === 0) {
    return { ok: true, data: config, issues: [] };
  }
  return {
    ok: false,
    data: config,
    issues: zodIssuesToParseIssues(issues),
  };
}

/** Re-export so callsites that already call the inline normaliser can be
 *  collapsed onto the parse boundary instead. Kept exported for unit tests
 *  that exercise the operator-value contract directly. */
export type { PredicateOperatorValueKind };

/** Hard parse-issue classification — used by the FE save gate (Section 5)
 *  and the canvas patch applier (Section 6).
 *
 *  After ``parseNodeConfig({mode: 'draft'})``, every surviving issue is
 *  structurally hard. The draft filter (``isDraftOmittedRequiredIssue``)
 *  has already removed missing-required-field cases; what's left includes
 *  unrecognized keys, wrong-typed provided values, invalid enums,
 *  malformed predicates, and unknown node types — all hard per the plan.
 *
 *  This helper exists so call sites read schematically rather than as
 *  ``!result.ok``. It also gives a single hook if Phase 16 codegen ever
 *  needs to attach finer-grained severity.
 */
export function isHardParseIssue(_issue: NodeConfigParseIssue): boolean {
  return true;
}
