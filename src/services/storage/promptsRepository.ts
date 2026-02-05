/**
 * Prompts Repository
 * Stores prompts in entities table using pattern-based storage
 */

import type { PromptDefinition, AppId } from '@/types';
import {
  DEFAULT_TRANSCRIPTION_PROMPT,
  DEFAULT_EVALUATION_PROMPT,
  DEFAULT_EXTRACTION_PROMPT,
  API_TRANSCRIPTION_PROMPT,
  API_EVALUATION_PROMPT,
  KAIRA_DEFAULT_CHAT_ANALYSIS_PROMPT,
  KAIRA_DEFAULT_HEALTH_ACCURACY_PROMPT,
  KAIRA_DEFAULT_EMPATHY_PROMPT,
  KAIRA_DEFAULT_RISK_DETECTION_PROMPT,
} from '@/constants';
import { type Entity, saveEntity, deleteEntity, getEntities } from './db';

class PromptsRepository {
  private seedingPromises: Map<AppId, Promise<void>> = new Map();
  private isSeeding: Map<AppId, boolean> = new Map();

  private async getAllPrompts(appId: AppId): Promise<PromptDefinition[]> {
    const entities = await getEntities('prompt', appId);
    
    return entities.map(e => ({
      id: String(e.id),  // Convert number to string for compatibility
      name: e.data.name as string,
      version: e.version!,
      promptType: e.key as PromptDefinition['promptType'],
      prompt: e.data.prompt as string,
      description: e.data.description as string | undefined,
      isDefault: e.data.isDefault as boolean | undefined,
      sourceType: e.data.sourceType as 'upload' | 'api' | undefined,
      createdAt: new Date(e.data.createdAt as string),
      updatedAt: new Date(e.data.updatedAt as string),
    }));
  }

  private async seedDefaults(appId: AppId): Promise<void> {
    console.log('[PromptsRepository] Seeding defaults for', appId);
    
    // Prevent re-entry
    if (this.isSeeding.get(appId)) {
      console.log('[PromptsRepository] Already seeding, skipping');
      return;
    }
    
    this.isSeeding.set(appId, true);
    
    try {
      const existing = await this.getAllPrompts(appId);
      console.log('[PromptsRepository] Existing prompts:', existing.length);
      if (existing.length > 0) {
        this.isSeeding.set(appId, false);
        return;
      }

      const defaults = appId === 'kaira-bot' 
        ? this.getKairaBotDefaults()
        : this.getVoiceRxDefaults();

      console.log('[PromptsRepository] Seeding', defaults.length, 'default prompts');
      for (const promptDef of defaults) {
        await this.save(appId, {
          ...promptDef,
          id: '',  // Will be auto-generated
          createdAt: new Date(),
          updatedAt: new Date(),
        } as PromptDefinition);
      }
      console.log('[PromptsRepository] Seeding complete');
    } finally {
      this.isSeeding.set(appId, false);
    }
  }

  private getVoiceRxDefaults(): Array<Omit<PromptDefinition, 'id' | 'createdAt' | 'updatedAt'>> {
    return [
      // Default prompts (compatible with both flows)
      {
        name: 'Transcription Prompt v1',
        version: 1,
        promptType: 'transcription',
        prompt: DEFAULT_TRANSCRIPTION_PROMPT,
        description: 'Default transcription prompt with time-aligned segment support',
        isDefault: true,
      },
      {
        name: 'Evaluation Prompt v1',
        version: 1,
        promptType: 'evaluation',
        prompt: DEFAULT_EVALUATION_PROMPT,
        description: 'Default LLM-as-Judge evaluation prompt for segment comparison',
        isDefault: true,
      },
      {
        name: 'Extraction Prompt v1',
        version: 1,
        promptType: 'extraction',
        prompt: DEFAULT_EXTRACTION_PROMPT,
        description: 'Default data extraction prompt',
        isDefault: true,
      },
      // Additional prompts for API flow
      {
        name: 'API Transcription Prompt v1',
        version: 1,
        promptType: 'transcription',
        prompt: API_TRANSCRIPTION_PROMPT,
        description: 'Transcription prompt for API flow (no time segments)',
        isDefault: true,
      },
      {
        name: 'API Evaluation Prompt v1',
        version: 1,
        promptType: 'evaluation',
        prompt: API_EVALUATION_PROMPT,
        description: 'Semantic audit prompt for API structured output evaluation',
        isDefault: true,
      },
    ];
  }

  private getKairaBotDefaults(): Array<Omit<PromptDefinition, 'id' | 'createdAt' | 'updatedAt'>> {
    return [
      {
        name: 'Chat Analysis Prompt v1',
        version: 1,
        promptType: 'transcription',
        prompt: KAIRA_DEFAULT_CHAT_ANALYSIS_PROMPT,
        description: 'Evaluate conversation quality, accuracy, and helpfulness',
        isDefault: true,
      },
      {
        name: 'Health Accuracy Prompt v1',
        version: 1,
        promptType: 'evaluation',
        prompt: KAIRA_DEFAULT_HEALTH_ACCURACY_PROMPT,
        description: 'Verify medical information accuracy in bot responses',
        isDefault: true,
      },
      {
        name: 'Empathy Assessment Prompt v1',
        version: 1,
        promptType: 'extraction',
        prompt: KAIRA_DEFAULT_EMPATHY_PROMPT,
        description: 'Evaluate emotional intelligence in health conversations',
        isDefault: true,
      },
      {
        name: 'Risk Detection Prompt v1',
        version: 1,
        promptType: 'extraction',
        prompt: KAIRA_DEFAULT_RISK_DETECTION_PROMPT,
        description: 'Identify potentially harmful content in bot conversations',
        isDefault: false,
      },
    ];
  }

  async getAll(appId: AppId, promptType?: PromptDefinition['promptType']): Promise<PromptDefinition[]> {
    // Ensure defaults exist (only seeds once per app)
    if (!this.seedingPromises.has(appId)) {
      this.seedingPromises.set(appId, this.seedDefaults(appId));
    }
    await this.seedingPromises.get(appId);
    
    let results = await this.getAllPrompts(appId);
    
    if (promptType) {
      results = results.filter(p => p.promptType === promptType);
    }
    
    // Sort by version descending
    results.sort((a, b) => b.version - a.version);
    return results;
  }

  async getById(appId: AppId, id: string): Promise<PromptDefinition | null> {
    const prompts = await this.getAllPrompts(appId);
    return prompts.find(p => p.id === id) ?? null;
  }

  async getLatestVersion(appId: AppId, promptType: PromptDefinition['promptType']): Promise<number> {
    const prompts = await this.getAll(appId, promptType);
    if (prompts.length === 0) return 0;
    return Math.max(...prompts.map(p => p.version));
  }

  async save(appId: AppId, prompt: PromptDefinition): Promise<PromptDefinition> {
    console.log('[PromptsRepository] Saving prompt:', prompt.name);
    // Auto-generate name if creating new version
    if (!prompt.id) {
      // Use getAllPrompts directly to avoid triggering seed during seed
      const allPrompts = await this.getAllPrompts(appId);
      const typePrompts = allPrompts.filter(p => p.promptType === prompt.promptType);
      const latestVersion = typePrompts.length > 0 ? Math.max(...typePrompts.map(p => p.version)) : 0;
      
      prompt.version = latestVersion + 1;
      prompt.name = `${this.getPromptTypeLabel(prompt.promptType)} Prompt v${prompt.version}`;
      prompt.createdAt = new Date();
    }
    prompt.updatedAt = new Date();

    const entity: Omit<Entity, 'id'> & { id?: number } = {
      id: prompt.id ? parseInt(prompt.id, 10) : undefined,
      appId,
      type: 'prompt',
      key: prompt.promptType,
      version: prompt.version,
      data: {
        name: prompt.name,
        prompt: prompt.prompt,
        description: prompt.description,
        isDefault: prompt.isDefault,
        createdAt: prompt.createdAt.toISOString(),
        updatedAt: prompt.updatedAt.toISOString(),
      },
    };

    const id = await saveEntity(entity);
    prompt.id = String(id);
    console.log('[PromptsRepository] Saved prompt with id:', id);
    
    return prompt;
  }

  async delete(appId: AppId, id: string): Promise<void> {
    const entities = await getEntities('prompt', appId);
    const entity = entities.find(e => String(e.id) === id);
    
    if (!entity) {
      throw new Error('Prompt not found');
    }
    if (entity.data.isDefault) {
      throw new Error('Cannot delete default prompt');
    }

    await deleteEntity(entity.id!);
  }

  async checkDependencies(_appId: AppId, _id: string): Promise<{ count: number; listings: string[] }> {
    return { count: 0, listings: [] };
  }

  async ensureDefaults(appId: AppId): Promise<void> {
    await this.seedDefaults(appId);
  }

  private getPromptTypeLabel(promptType: PromptDefinition['promptType']): string {
    const labels = {
      transcription: 'Transcription',
      evaluation: 'Evaluation',
      extraction: 'Extraction',
    };
    return labels[promptType];
  }
}

export const promptsRepository = new PromptsRepository();
