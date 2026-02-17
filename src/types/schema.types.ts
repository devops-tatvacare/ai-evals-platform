export interface SchemaDefinition {
  id: string;
  name: string;                    // Auto-generated: "Evaluation Schema v3"
  version: number;                 // Auto-increment per promptType
  createdAt: Date;
  updatedAt: Date;
  promptType: 'transcription' | 'evaluation' | 'extraction';
  schema: Record<string, unknown>; // JSON Schema object
  description?: string;
  isDefault?: boolean;             // Mark built-in schemas
  sourceType?: 'upload' | 'api' | null; // Flow type (upload or api)
}

export interface SchemaReference {
  id: string;
  name: string;
  version: number;
}
