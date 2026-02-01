/**
 * Prompts Repository
 * IndexedDB storage for prompt definitions with versioning
 */

import type { PromptDefinition } from '@/types';
import { generateId } from '@/utils';
import {
  DEFAULT_TRANSCRIPTION_PROMPT,
  DEFAULT_EVALUATION_PROMPT,
  DEFAULT_EXTRACTION_PROMPT,
} from '@/constants';

const DB_NAME = 'voice-rx-prompts';
const DB_VERSION = 1;
const STORE_NAME = 'prompts';

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
        
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('promptType', 'promptType', { unique: false });
          store.createIndex('promptType_version', ['promptType', 'version'], { unique: true });
        }
      };
    });

    await this.initPromise;
    await this.seedDefaults();
  }

  private async seedDefaults(): Promise<void> {
    const existing = await this.getAll();
    if (existing.length > 0) return;

    const defaults: Array<Omit<PromptDefinition, 'id' | 'createdAt' | 'updatedAt'>> = [
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

    for (const prompt of defaults) {
      await this.save({
        ...prompt,
        id: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PromptDefinition);
    }
  }

  async getAll(promptType?: PromptDefinition['promptType']): Promise<PromptDefinition[]> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      
      let request: IDBRequest;
      if (promptType) {
        const index = store.index('promptType');
        request = index.getAll(promptType);
      } else {
        request = store.getAll();
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

  async getById(id: string): Promise<PromptDefinition | null> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result ? this.deserialize(request.result) : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getLatestVersion(promptType: PromptDefinition['promptType']): Promise<number> {
    const prompts = await this.getAll(promptType);
    if (prompts.length === 0) return 0;
    return Math.max(...prompts.map(p => p.version));
  }

  async save(prompt: PromptDefinition): Promise<PromptDefinition> {
    await this.init();
    
    // Auto-generate name if creating new version
    if (!prompt.id) {
      const latestVersion = await this.getLatestVersion(prompt.promptType);
      prompt.id = generateId();
      prompt.version = latestVersion + 1;
      prompt.name = `${this.getPromptTypeLabel(prompt.promptType)} Prompt v${prompt.version}`;
      prompt.createdAt = new Date();
    }
    prompt.updatedAt = new Date();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(this.serialize(prompt));

      request.onsuccess = () => resolve(prompt);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(id: string): Promise<void> {
    await this.init();
    
    // Check if this is a default prompt
    const prompt = await this.getById(id);
    if (prompt?.isDefault) {
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

  async checkDependencies(_id: string): Promise<{ count: number; listings: string[] }> {
    // TODO: Query listingsRepository for AIEvaluations using this prompt
    // Return count and listing IDs for user warning
    return { count: 0, listings: [] };
  }

  private getPromptTypeLabel(promptType: PromptDefinition['promptType']): string {
    const labels = {
      transcription: 'Transcription',
      evaluation: 'Evaluation',
      extraction: 'Extraction',
    };
    return labels[promptType];
  }

  private serialize(prompt: PromptDefinition): Record<string, unknown> {
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
