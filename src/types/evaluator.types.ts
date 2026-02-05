export type EvaluatorFieldType = 'number' | 'text' | 'boolean' | 'array';
export type EvaluatorDisplayMode = 'header' | 'card' | 'hidden';

export interface EvaluatorThresholds {
  green: number;  // Value >= green is good (green)
  yellow: number; // Value >= yellow but < green is warning (yellow)
  // Value < yellow is bad (red)
}

export interface EvaluatorOutputField {
  key: string;                    // Field name in output (e.g., "score")
  type: EvaluatorFieldType;       // Data type
  description: string;            // For AI to understand field purpose
  displayMode: EvaluatorDisplayMode; // Where to show this field
  isMainMetric?: boolean;         // Only one field can be main metric (shown in header)
  thresholds?: EvaluatorThresholds; // RYG thresholds (only for number type)
}

export interface EvaluatorDefinition {
  id: string;                     // UUID
  name: string;                   // User-defined name
  prompt: string;                 // Prompt template with variables
  modelId: string;                // LLM model to use
  outputSchema: EvaluatorOutputField[]; // Define output structure
  appId: string;                  // 'voice-rx' | 'kaira-bot'
  showInHeader?: boolean;         // Whether to display main metric in page header
  createdAt: Date;
  updatedAt: Date;
}

export interface EvaluatorRun {
  id: string;                     // UUID
  evaluatorId: string;            // Reference to EvaluatorDefinition
  listingId: string;              // Which listing was evaluated
  status: 'pending' | 'processing' | 'completed' | 'failed';
  output?: Record<string, unknown>; // Structured output from LLM
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}
