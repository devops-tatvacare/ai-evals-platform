/**
 * Schemas Repository
 * IndexedDB storage for schema definitions with versioning and appId scoping
 */

import type { SchemaDefinition, AppId } from '@/types';
import { generateId } from '@/utils';
import {
  DEFAULT_TRANSCRIPTION_SCHEMA,
  DEFAULT_EVALUATION_SCHEMA,
  DEFAULT_EXTRACTION_SCHEMA,
} from '@/constants';

const DB_NAME = 'ai-evals-schemas';
const DB_VERSION = 3; // v3: Added appId scoping
const STORE_NAME = 'schemas';

// Extended schema with appId
interface StoredSchema extends SchemaDefinition {
  appId: AppId;
}

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
    
    // Seed defaults for voice-rx if needed
    await this.seedDefaults('voice-rx');
  }

  private async seedDefaults(appId: AppId): Promise<void> {
    const existing = await this.getAll(appId);
    if (existing.length > 0) return;

    const defaults = [
      DEFAULT_TRANSCRIPTION_SCHEMA,
      DEFAULT_EVALUATION_SCHEMA,
      DEFAULT_EXTRACTION_SCHEMA,
    ];

    for (const schema of defaults) {
      await this.save(appId, {
        ...schema,
        id: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SchemaDefinition);
    }
  }

  async getAll(appId: AppId, promptType?: SchemaDefinition['promptType']): Promise<SchemaDefinition[]> {
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
        results.sort((a: SchemaDefinition, b: SchemaDefinition) => b.version - a.version);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getById(appId: AppId, id: string): Promise<SchemaDefinition | null> {
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
        const schema = this.deserialize(request.result);
        // Verify appId
        if ((schema as StoredSchema).appId !== appId) {
          console.warn(`Schema ${id} belongs to different app`);
          resolve(null);
          return;
        }
        resolve(schema);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getLatestVersion(appId: AppId, promptType: SchemaDefinition['promptType']): Promise<number> {
    const schemas = await this.getAll(appId, promptType);
    if (schemas.length === 0) return 0;
    return Math.max(...schemas.map(s => s.version));
  }

  async save(appId: AppId, schema: SchemaDefinition): Promise<SchemaDefinition> {
    await this.init();
    
    // Auto-generate name if creating new version
    if (!schema.id) {
      const latestVersion = await this.getLatestVersion(appId, schema.promptType);
      schema.id = generateId();
      schema.version = latestVersion + 1;
      schema.name = `${this.getPromptTypeLabel(schema.promptType)} Schema v${schema.version}`;
      schema.createdAt = new Date();
    }
    schema.updatedAt = new Date();

    const storedSchema: StoredSchema = { ...schema, appId };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(this.serialize(storedSchema));

      request.onsuccess = () => resolve(schema);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(appId: AppId, id: string): Promise<void> {
    await this.init();
    
    // Check if this is a default schema
    const schema = await this.getById(appId, id);
    if (!schema) {
      throw new Error('Schema not found');
    }
    if (schema.isDefault) {
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

  async checkDependencies(_appId: AppId, _id: string): Promise<{ count: number; listings: string[] }> {
    // TODO: Query listingsRepository for AIEvaluations using this schema
    return { count: 0, listings: [] };
  }

  /**
   * Ensure defaults exist for an app (call on app switch)
   */
  async ensureDefaults(appId: AppId): Promise<void> {
    await this.init();
    await this.seedDefaults(appId);
  }

  private getPromptTypeLabel(promptType: SchemaDefinition['promptType']): string {
    const labels = {
      transcription: 'Transcription',
      evaluation: 'Evaluation',
      extraction: 'Extraction',
    };
    return labels[promptType];
  }

  private serialize(schema: StoredSchema): Record<string, unknown> {
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
