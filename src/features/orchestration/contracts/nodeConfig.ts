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

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
// Provider-specific extras are still allowed (e.g. WATI mapping carries
// `body` / `header` slot keys that the dispatch node forwards verbatim) —
// `loose` lets unknown keys through unmodified. This is intentional and
// distinct from the per-node `.strict()` policy at the registry level.
const VariableMappingSchema = z.looseObject({
  variable_name: z.string(),
  payload_field: z.string().optional(),
  static_value: z.unknown().optional(),
});

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
export const SourceCohortQueryConfigSchema = z
  .object({
    nodeType: z.literal("source.cohort_query"),
    source_ref: z.string().optional(),
    payload_fields: z.array(z.string()).default([]),
    // Legacy back-compat (mirrors backend CohortQueryConfig).
    source_table: z.string().optional(),
    id_column: z.string().optional(),
    payload_columns: z.array(z.string()).default([]),
    filters: z
      .array(
        z
          .object({
            column: z.string(),
            op: z.string(),
            value: z.unknown(),
          })
          .strict(),
      )
      .default([]),
    lookback_hours: z.number().int().nullable().optional(),
    lookback_column: z.string().nullable().optional(),
    consent_gate_channel: z.string().nullable().optional(),
    next_node_id: z.string().nullable().optional(),
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
const SplitBranchSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    match: z.unknown().optional(),
    predicate: PredicateAstSchema.optional(),
    weight: z.number().nullable().optional(),
  })
  .strict();

type SplitBranchOutput = z.output<typeof SplitBranchSchema>;

interface LogicSplitConfigOutput {
  nodeType: "logic.split";
  mode: "by_field" | "by_rules" | "random";
  field?: string;
  branches: SplitBranchOutput[];
  default_branch_id?: string;
  drop_unmatched: boolean;
}

function normaliseSplitBranches(
  mode: "by_field" | "by_rules" | "random",
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
            : branch.match === undefined
              ? ""
              : String(branch.match),
      };
    }
    if (mode === "by_rules") {
      return {
        ...base,
        predicate:
          branch.predicate ??
          ({ field: "", op: "eq", value: "" } as PredicateAstOutput),
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
    // FE supports `by_rules` even though backend currently only ships
    // `by_field` / `random`; runtime publish would reject `by_rules`. Kept
    // here so drafts authored with predicates do not lose their config.
    mode: z.enum(["by_field", "by_rules", "random"]).default("by_field"),
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
const EventCorrelationSchema = z
  .object({
    field: z.string(),
    payload_field: z.string().optional(),
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
export const CrmSendWatiConfigSchema = z
  .object({
    nodeType: z.literal("crm.send_wati"),
    connection_id: z.string().min(1),
    template_slug: z.string().min(1),
    template_name: z.string().default(""),
    channel_number: z.string().default(""),
    broadcast_name: z.string().default(""),
    phone_field: z.string().default("whatsapp_number"),
    variable_mappings: z.array(VariableMappingSchema).default([]),
    attempt_policy: AttemptPolicySchema.optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const CrmPlaceBolnaCallConfigSchema = z
  .object({
    nodeType: z.literal("crm.place_bolna_call"),
    connection_id: z.string().min(1),
    template_slug: z.string().min(1),
    agent_id: z.string().default(""),
    from_phone: z.string().default(""),
    phone_field: z.string().default("phone"),
    variable_mappings: z.array(VariableMappingSchema).default([]),
    attempt_policy: AttemptPolicySchema.optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const CrmSendSmsConfigSchema = z
  .object({
    nodeType: z.literal("crm.send_sms"),
    connection_id: z.string().min(1),
    template_slug: z.string().min(1),
    phone_field: z.string().default("phone"),
    attempt_policy: AttemptPolicySchema.optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const CrmLsqUpdateStageConfigSchema = z
  .object({
    nodeType: z.literal("crm.lsq_update_stage"),
    connection_id: z.string().min(1),
    target_stage: z.string().min(1),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const CrmLsqLogActivityConfigSchema = z
  .object({
    nodeType: z.literal("crm.lsq_log_activity"),
    connection_id: z.string().min(1),
    activity_event_code: z.number().int(),
    note: z.string(),
    fields: z.array(z.record(z.string(), z.unknown())).default([]),
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
export const SinkCompleteConfigSchema = z
  .object({
    nodeType: z.literal("sink.complete"),
    reason: z.string().nullable().optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const ClinicalScheduleLabConfigSchema = z
  .object({
    nodeType: z.literal("clinical.schedule_lab"),
    test_code: z.string().min(1),
    test_name: z.string(),
    frequency: z
      .enum(["once", "monthly", "quarterly", "biannual", "annual"])
      .default("once"),
    notify_roles: z
      .array(z.enum(["care_manager", "physician", "pharmacist"]))
      .default(["care_manager"]),
    urgency: z.enum(["routine", "urgent", "stat"]).default("routine"),
    attempt_policy: AttemptPolicySchema.optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const ClinicalAssignCareTeamTaskConfigSchema = z
  .object({
    nodeType: z.literal("clinical.assign_care_team_task"),
    role: z
      .enum(["care_manager", "physician", "pharmacist", "nutritionist"])
      .default("care_manager"),
    task_label: z.string(),
    cadence: z.enum(["once", "weekly", "monthly"]).default("once"),
    sla_hours: z.number().int().default(24),
    attempt_policy: AttemptPolicySchema.optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const ClinicalSendProAssessmentConfigSchema = z
  .object({
    nodeType: z.literal("clinical.send_pro_assessment"),
    instrument: z
      .enum(["PHQ9", "DDS", "MMAS", "EQ5D", "PROMIS"])
      .default("PHQ9"),
    delivery_channel: z.enum(["sms", "email", "wa"]).default("wa"),
    attempt_policy: AttemptPolicySchema.optional(),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const ClinicalEmrWriteConfigSchema = z
  .object({
    nodeType: z.literal("clinical.emr_write"),
    note_type: z
      .enum(["progress_note", "observation", "encounter", "care_plan_update"])
      .default("progress_note"),
    template: z.string(),
    structured_fields: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const ClinicalEscalationUptierConfigSchema = z
  .object({
    nodeType: z.literal("clinical.escalation_uptier"),
    target_role: z
      .enum(["physician", "specialist", "ed", "crisis_team"])
      .default("physician"),
    urgency: z
      .enum(["same_day", "48h", "next_review", "next_month"])
      .default("same_day"),
    reason: z.string(),
    attempt_policy: AttemptPolicySchema.optional(),
  })
  .strict();

// ─── Discriminated union over the registry ──────────────────────────────

// TODO: replace with codegen from Pydantic in Phase 16 (openapi-zod-client)
export const NodeConfigSchema = z.discriminatedUnion("nodeType", [
  SourceCohortQueryConfigSchema,
  SourceEventTriggerConfigSchema,
  FilterConsentGateConfigSchema,
  FilterEligibilityConfigSchema,
  LogicConditionalConfigSchema,
  LogicSplitConfigSchema,
  LogicWaitConfigSchema,
  LogicMergeConfigSchema,
  CrmSendWatiConfigSchema,
  CrmPlaceBolnaCallConfigSchema,
  CrmSendSmsConfigSchema,
  CrmLsqUpdateStageConfigSchema,
  CrmLsqLogActivityConfigSchema,
  CoreWebhookOutConfigSchema,
  SinkCompleteConfigSchema,
  ClinicalScheduleLabConfigSchema,
  ClinicalAssignCareTeamTaskConfigSchema,
  ClinicalSendProAssessmentConfigSchema,
  ClinicalEmrWriteConfigSchema,
  ClinicalEscalationUptierConfigSchema,
]);

const NODE_TYPE_TO_SCHEMA: Record<
  string,
  | typeof SourceCohortQueryConfigSchema
  | typeof SourceEventTriggerConfigSchema
  | typeof FilterConsentGateConfigSchema
  | typeof FilterEligibilityConfigSchema
  | typeof LogicConditionalConfigSchema
  | typeof LogicSplitConfigSchema
  | typeof LogicWaitConfigSchema
  | typeof LogicMergeConfigSchema
  | typeof CrmSendWatiConfigSchema
  | typeof CrmPlaceBolnaCallConfigSchema
  | typeof CrmSendSmsConfigSchema
  | typeof CrmLsqUpdateStageConfigSchema
  | typeof CrmLsqLogActivityConfigSchema
  | typeof CoreWebhookOutConfigSchema
  | typeof SinkCompleteConfigSchema
  | typeof ClinicalScheduleLabConfigSchema
  | typeof ClinicalAssignCareTeamTaskConfigSchema
  | typeof ClinicalSendProAssessmentConfigSchema
  | typeof ClinicalEmrWriteConfigSchema
  | typeof ClinicalEscalationUptierConfigSchema
> = {
  "source.cohort_query": SourceCohortQueryConfigSchema,
  "source.event_trigger": SourceEventTriggerConfigSchema,
  "filter.consent_gate": FilterConsentGateConfigSchema,
  "filter.eligibility": FilterEligibilityConfigSchema,
  "logic.conditional": LogicConditionalConfigSchema,
  "logic.split": LogicSplitConfigSchema,
  "logic.wait": LogicWaitConfigSchema,
  "logic.merge": LogicMergeConfigSchema,
  "crm.send_wati": CrmSendWatiConfigSchema,
  "crm.place_bolna_call": CrmPlaceBolnaCallConfigSchema,
  "crm.send_sms": CrmSendSmsConfigSchema,
  "crm.lsq_update_stage": CrmLsqUpdateStageConfigSchema,
  "crm.lsq_log_activity": CrmLsqLogActivityConfigSchema,
  "core.webhook_out": CoreWebhookOutConfigSchema,
  "sink.complete": SinkCompleteConfigSchema,
  "clinical.schedule_lab": ClinicalScheduleLabConfigSchema,
  "clinical.assign_care_team_task": ClinicalAssignCareTeamTaskConfigSchema,
  "clinical.send_pro_assessment": ClinicalSendProAssessmentConfigSchema,
  "clinical.emr_write": ClinicalEmrWriteConfigSchema,
  "clinical.escalation_uptier": ClinicalEscalationUptierConfigSchema,
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
