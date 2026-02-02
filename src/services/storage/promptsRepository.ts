/**
 * Prompts Repository
 * Uses main Dexie database for prompt definitions with versioning and appId scoping
 */

import type { PromptDefinition, AppId } from '@/types';
import { generateId } from '@/utils';
import {
  DEFAULT_TRANSCRIPTION_PROMPT,
  DEFAULT_EVALUATION_PROMPT,
  DEFAULT_EXTRACTION_PROMPT,
  KAIRA_DEFAULT_CHAT_ANALYSIS_PROMPT,
  KAIRA_DEFAULT_HEALTH_ACCURACY_PROMPT,
  KAIRA_DEFAULT_EMPATHY_PROMPT,
  KAIRA_DEFAULT_RISK_DETECTION_PROMPT,
} from '@/constants';
import { db, type StoredPrompt } from './db';

class PromptsRepository {
  private seedingPromises: Map<AppId, Promise<void>> = new Map();

  private async seedDefaults(appId: AppId): Promise<void> {
    const existing = await db.prompts.where('appId').equals(appId).count();
    if (existing > 0) return;

    const defaults = appId === 'kaira-bot' 
      ? this.getKairaBotDefaults()
      : this.getVoiceRxDefaults();

    const now = new Date();
    const records: StoredPrompt[] = defaults.map(prompt => ({
      ...prompt,
      id: generateId(),
      appId,
      createdAt: now,
      updatedAt: now,
    } as StoredPrompt));

    await db.prompts.bulkAdd(records);
  }

  private getVoiceRxDefaults(): Array<Omit<PromptDefinition, 'id' | 'createdAt' | 'updatedAt'>> {
    return [
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
        description: 'Default LLM-as-Judge evaluation prompt',
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
    
    let results: StoredPrompt[];
    if (promptType) {
      results = await db.prompts
        .where('[appId+promptType]')
        .equals([appId, promptType])
        .toArray();
    } else {
      results = await db.prompts
        .where('appId')
        .equals(appId)
        .toArray();
    }
    
    // Sort by version descending
    results.sort((a, b) => b.version - a.version);
    return results;
  }

  async getById(appId: AppId, id: string): Promise<PromptDefinition | null> {
    const prompt = await db.prompts.get(id);
    if (!prompt) return null;
    
    if (prompt.appId !== appId) {
      console.warn(`Prompt ${id} belongs to different app`);
      return null;
    }
    return prompt;
  }

  async getLatestVersion(appId: AppId, promptType: PromptDefinition['promptType']): Promise<number> {
    const prompts = await this.getAll(appId, promptType);
    if (prompts.length === 0) return 0;
    return Math.max(...prompts.map(p => p.version));
  }

  async save(appId: AppId, prompt: PromptDefinition): Promise<PromptDefinition> {
    // Auto-generate name if creating new version
    if (!prompt.id) {
      const latestVersion = await this.getLatestVersion(appId, prompt.promptType);
      prompt.id = generateId();
      prompt.version = latestVersion + 1;
      prompt.name = `${this.getPromptTypeLabel(prompt.promptType)} Prompt v${prompt.version}`;
      prompt.createdAt = new Date();
    }
    prompt.updatedAt = new Date();

    const storedPrompt: StoredPrompt = { ...prompt, appId };
    await db.prompts.put(storedPrompt);
    
    return prompt;
  }

  async delete(appId: AppId, id: string): Promise<void> {
    const prompt = await this.getById(appId, id);
    if (!prompt) {
      throw new Error('Prompt not found');
    }
    if (prompt.isDefault) {
      throw new Error('Cannot delete default prompt');
    }

    await db.prompts.delete(id);
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
