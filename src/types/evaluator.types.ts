export type EvaluatorFieldType = 'number' | 'text' | 'boolean' | 'array';
export type EvaluatorDisplayMode = 'header' | 'card' | 'hidden';
export type ArrayItemType = 'string' | 'number' | 'boolean' | 'object';

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
}

export interface EvaluatorDefinition {
  id: string;                     // UUID
  name: string;                   // User-defined name
  prompt: string;                 // Prompt template with variables
  modelId: string;                // LLM model to use
  outputSchema: EvaluatorOutputField[]; // Define output structure
  appId: string;                  // 'voice-rx' | 'kaira-bot'
  listingId?: string;             // Which listing owns this (null for kaira-bot app-level)
  isGlobal: boolean;              // If true, visible in Registry for forking
  forkedFrom?: string;            // Source evaluator ID if forked (lineage tracking)
  showInHeader?: boolean;         // Whether to display main metric in page header
  createdAt: Date;
  updatedAt: Date;
}

/** App-generic evaluator context for shared components */
export interface EvaluatorContext {
  appId: string;
  entityId?: string;      // listing.id for voice-rx, undefined for kaira-bot
}
