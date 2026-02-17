export interface PromptDefinition {
  id: string;
  name: string;                    // Auto-generated: "Evaluation Prompt v3"
  version: number;                 // Auto-increment per promptType
  createdAt: Date;
  updatedAt: Date;
  promptType: 'transcription' | 'evaluation' | 'extraction';
  prompt: string;                  // The actual prompt text
  description?: string;
  isDefault?: boolean;             // Mark built-in prompts
  sourceType?: 'upload' | 'api' | null;  // Flow type (upload or api)
}

export interface PromptReference {
  id: string;
  name: string;
  version: number;
}
