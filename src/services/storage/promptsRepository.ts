/**
 * Prompts Repository
 * IndexedDB storage for prompt definitions with versioning and appId scoping
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

const DB_NAME = 'ai-evals-prompts';
const DB_VERSION = 2; // v2: Added appId scoping
const STORE_NAME = 'prompts';

// Extended prompt with appId
interface StoredPrompt extends PromptDefinition {
  appId: AppId;
}

class PromptsRepository {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create or recreate store with new indexes
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('appId', 'appId', { unique: false });
        store.createIndex('promptType', 'promptType', { unique: false });
        store.createIndex('appId_promptType', ['appId', 'promptType'], { unique: false });
        store.createIndex('appId_promptType_version', ['appId', 'promptType', 'version'], { unique: true });
      };
    });

    await this.initPromise;
    
    // Seed defaults for both apps if needed
    await this.seedDefaults('voice-rx');
    await this.seedDefaults('kaira-bot');
  }

  private async seedDefaults(appId: AppId): Promise<void> {
    const existing = await this.getAll(appId);
    if (existing.length > 0) return;

    // Get app-specific defaults
    const defaults = appId === 'kaira-bot' 
      ? this.getKairaBotDefaults()
      : this.getVoiceRxDefaults();

    for (const prompt of defaults) {
      await this.save(appId, {
        ...prompt,
        id: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PromptDefinition);
    }
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
        promptType: 'transcription', // Using transcription type for chat analysis
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
        promptType: 'extraction', // Using extraction for secondary analysis
        prompt: KAIRA_DEFAULT_RISK_DETECTION_PROMPT,
        description: 'Identify potentially harmful content in bot conversations',
        isDefault: false, // Not a default, but a supplementary prompt
      },
    ];
  }

  async getAll(appId: AppId, promptType?: PromptDefinition['promptType']): Promise<PromptDefinition[]> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      
      let request: IDBRequest;
      if (promptType) {
        const index = store.index('appId_promptType');
        request = index.getAll([appId, promptType]);
      } else {
        const index = store.index('appId');
        request = index.getAll(appId);
      }

      request.onsuccess = () => {
        const results = request.result.map(this.deserialize);
        // Sort by version descending
        results.sort((a: PromptDefinition, b: PromptDefinition) => b.version - a.version);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getById(appId: AppId, id: string): Promise<PromptDefinition | null> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }
        const prompt = this.deserialize(request.result);
        // Verify appId
        if ((prompt as StoredPrompt).appId !== appId) {
          console.warn(`Prompt ${id} belongs to different app`);
          resolve(null);
          return;
        }
        resolve(prompt);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getLatestVersion(appId: AppId, promptType: PromptDefinition['promptType']): Promise<number> {
    const prompts = await this.getAll(appId, promptType);
    if (prompts.length === 0) return 0;
    return Math.max(...prompts.map(p => p.version));
  }

  async save(appId: AppId, prompt: PromptDefinition): Promise<PromptDefinition> {
    await this.init();
    
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

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(this.serialize(storedPrompt));

      request.onsuccess = () => resolve(prompt);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(appId: AppId, id: string): Promise<void> {
    await this.init();
    
    // Check if this is a default prompt
    const prompt = await this.getById(appId, id);
    if (!prompt) {
      throw new Error('Prompt not found');
    }
    if (prompt.isDefault) {
      throw new Error('Cannot delete default prompt');
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async checkDependencies(_appId: AppId, _id: string): Promise<{ count: number; listings: string[] }> {
    // TODO: Query listingsRepository for AIEvaluations using this prompt
    return { count: 0, listings: [] };
  }

  /**
   * Ensure defaults exist for an app (call on app switch)
   */
  async ensureDefaults(appId: AppId): Promise<void> {
    await this.init();
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

  private serialize(prompt: StoredPrompt): Record<string, unknown> {
    return {
      ...prompt,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString(),
    };
  }

  private deserialize(data: Record<string, unknown>): PromptDefinition {
    return {
      ...data,
      createdAt: new Date(data.createdAt as string),
      updatedAt: new Date(data.updatedAt as string),
    } as PromptDefinition;
  }
}

export const promptsRepository = new PromptsRepository();
