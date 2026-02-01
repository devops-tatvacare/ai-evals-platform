/**
 * Schemas Repository
 * IndexedDB storage for schema definitions with versioning
 */

import type { SchemaDefinition } from '@/types';
import { generateId } from '@/utils';
import {
  DEFAULT_TRANSCRIPTION_SCHEMA,
  DEFAULT_EVALUATION_SCHEMA,
  DEFAULT_EXTRACTION_SCHEMA,
} from '@/constants';

const DB_NAME = 'voice-rx-schemas';
const DB_VERSION = 1;
const STORE_NAME = 'schemas';

class SchemasRepository {
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

    const defaults = [
      DEFAULT_TRANSCRIPTION_SCHEMA,
      DEFAULT_EVALUATION_SCHEMA,
      DEFAULT_EXTRACTION_SCHEMA,
    ];

    for (const schema of defaults) {
      await this.save({
        ...schema,
        id: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SchemaDefinition);
    }
  }

  async getAll(promptType?: SchemaDefinition['promptType']): Promise<SchemaDefinition[]> {
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
        results.sort((a: SchemaDefinition, b: SchemaDefinition) => b.version - a.version);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getById(id: string): Promise<SchemaDefinition | null> {
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

  async getLatestVersion(promptType: SchemaDefinition['promptType']): Promise<number> {
    const schemas = await this.getAll(promptType);
    if (schemas.length === 0) return 0;
    return Math.max(...schemas.map(s => s.version));
  }

  async save(schema: SchemaDefinition): Promise<SchemaDefinition> {
    await this.init();
    
    // Auto-generate name if creating new version
    if (!schema.id) {
      const latestVersion = await this.getLatestVersion(schema.promptType);
      schema.id = generateId();
      schema.version = latestVersion + 1;
      schema.name = `${this.getPromptTypeLabel(schema.promptType)} Schema v${schema.version}`;
      schema.createdAt = new Date();
    }
    schema.updatedAt = new Date();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(this.serialize(schema));

      request.onsuccess = () => resolve(schema);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(id: string): Promise<void> {
    await this.init();
    
    // Check if this is a default schema
    const schema = await this.getById(id);
    if (schema?.isDefault) {
      throw new Error('Cannot delete default schema');
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
    // TODO: Query listingsRepository for AIEvaluations using this schema
    // Return count and listing IDs for user warning
    return { count: 0, listings: [] };
  }

  private getPromptTypeLabel(promptType: SchemaDefinition['promptType']): string {
    const labels = {
      transcription: 'Transcription',
      evaluation: 'Evaluation',
      extraction: 'Extraction',
    };
    return labels[promptType];
  }

  private serialize(schema: SchemaDefinition): Record<string, unknown> {
    return {
      ...schema,
      createdAt: schema.createdAt.toISOString(),
      updatedAt: schema.updatedAt.toISOString(),
    };
  }

  private deserialize(data: Record<string, unknown>): SchemaDefinition {
    return {
      ...data,
      createdAt: new Date(data.createdAt as string),
      updatedAt: new Date(data.updatedAt as string),
    } as SchemaDefinition;
  }
}

export const schemasRepository = new SchemasRepository();
