import type { AppId } from './app.types';
import type { AssetVisibility } from './settings.types';

export type EvaluatorFieldType = 'number' | 'text' | 'boolean' | 'array' | 'enum';
export type EvaluatorDisplayMode = 'header' | 'card' | 'hidden';
export type ArrayItemType = 'string' | 'number' | 'boolean' | 'object';
export type FieldRole = 'metric' | 'reasoning' | 'detail';
export type EvaluatorVisibilityFilter = 'all' | 'private' | 'shared';

export interface EvaluatorThresholds {
  green: number;  // Value >= green is good (green)
  yellow: number; // Value >= yellow but < green is warning (yellow)
  // Value < yellow is bad (red)
}

export interface ArrayItemProperty {
  key: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
}

export interface ArrayItemSchema {
  itemType: ArrayItemType;
  properties?: ArrayItemProperty[]; // Only for itemType === 'object'
}

export interface EvaluatorOutputField {
  key: string;                    // Field name in output (e.g., "score")
  type: EvaluatorFieldType;       // Data type
  description: string;            // For AI to understand field purpose
  displayMode: EvaluatorDisplayMode; // Where to show this field
  isMainMetric?: boolean;         // Only one field can be main metric (shown in header)
  thresholds?: EvaluatorThresholds; // RYG thresholds (only for number type)
  arrayItemSchema?: ArrayItemSchema; // Only for type === 'array'
  enumValues?: string[];            // Allowed values (only for type === 'enum')
  role?: FieldRole;                 // Semantic role: metric, reasoning, or detail
}

export interface EvaluatorDefinition {
  id: string;                     // UUID
  userId?: string;
  tenantId?: string;
  ownerId?: string;
  ownerName?: string;
  name: string;                   // User-defined name
  prompt: string;                 // Prompt template with variables
  modelId: string;                // LLM model to use
  outputSchema: EvaluatorOutputField[]; // Define output structure
  appId: string;                  // 'voice-rx' | 'kaira-bot'
  listingId?: string;             // Which listing owns this (null for kaira-bot app-level)
  visibility?: AssetVisibility;   // Sharing scope
  forkedFrom?: string;            // Source evaluator ID if forked (lineage tracking)
  templateId?: string | null;
  templateBranchKey?: string | null;
  templateUpgradeAvailable?: boolean;
  sharedBy?: string | null;
  sharedAt?: string | null;
  linkedRuleIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** App-generic evaluator context for shared components */
export interface EvaluatorContext {
  appId: AppId;
  entityId?: string;      // listing.id for voice-rx, undefined for kaira-bot
}

/** Variable metadata returned by GET /api/evaluators/variables */
export interface VariableInfo {
  key: string;
  displayName: string;
  description: string;
  category: string;
  valueType: string;
  requiresAudio: boolean;
  requiresEvalOutput: boolean;
  sourceTypes: string[] | null;
  example: string;
}

/** Prompt validation result returned by POST /api/evaluators/validate-prompt */
export interface PromptValidation {
  valid_variables: string[];
  unknown_variables: string[];
  requires_audio: boolean;
  requires_eval_output: boolean;
}
