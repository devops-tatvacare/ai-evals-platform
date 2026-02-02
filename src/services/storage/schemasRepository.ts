/**
 * Schemas Repository
 * Uses main Dexie database for schema definitions with versioning and appId scoping
 */

import type { SchemaDefinition, AppId } from '@/types';
import { generateId } from '@/utils';
import {
  DEFAULT_TRANSCRIPTION_SCHEMA,
  DEFAULT_EVALUATION_SCHEMA,
  DEFAULT_EXTRACTION_SCHEMA,
} from '@/constants';
import { db, type StoredSchema } from './db';

class SchemasRepository {
  private seedingPromise: Promise<void> | null = null;

  private async seedDefaults(appId: AppId): Promise<void> {
    const existing = await db.schemas.where('appId').equals(appId).count();
    if (existing > 0) return;

    const defaults = [
      DEFAULT_TRANSCRIPTION_SCHEMA,
      DEFAULT_EVALUATION_SCHEMA,
      DEFAULT_EXTRACTION_SCHEMA,
    ];

    const now = new Date();
    const records: StoredSchema[] = defaults.map(schema => ({
      ...schema,
      id: generateId(),
      appId,
      createdAt: now,
      updatedAt: now,
    } as StoredSchema));

    await db.schemas.bulkAdd(records);
  }

  async getAll(appId: AppId, promptType?: SchemaDefinition['promptType']): Promise<SchemaDefinition[]> {
    // Ensure defaults exist (only seeds once per app)
    if (!this.seedingPromise) {
      this.seedingPromise = this.seedDefaults(appId);
    }
    await this.seedingPromise;
    
    let results: StoredSchema[];
    if (promptType) {
      results = await db.schemas
        .where('[appId+promptType]')
        .equals([appId, promptType])
        .toArray();
    } else {
      results = await db.schemas
        .where('appId')
        .equals(appId)
        .toArray();
    }
    
    // Sort by version descending
    results.sort((a, b) => b.version - a.version);
    return results;
  }

  async getById(appId: AppId, id: string): Promise<SchemaDefinition | null> {
    const schema = await db.schemas.get(id);
    if (!schema) return null;
    
    if (schema.appId !== appId) {
      console.warn(`Schema ${id} belongs to different app`);
      return null;
    }
    return schema;
  }

  async getLatestVersion(appId: AppId, promptType: SchemaDefinition['promptType']): Promise<number> {
    const schemas = await this.getAll(appId, promptType);
    if (schemas.length === 0) return 0;
    return Math.max(...schemas.map(s => s.version));
  }

  async save(appId: AppId, schema: SchemaDefinition): Promise<SchemaDefinition> {
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
    await db.schemas.put(storedSchema);
    
    return schema;
  }

  async delete(appId: AppId, id: string): Promise<void> {
    const schema = await this.getById(appId, id);
    if (!schema) {
      throw new Error('Schema not found');
    }
    if (schema.isDefault) {
      throw new Error('Cannot delete default schema');
    }

    await db.schemas.delete(id);
  }

  async checkDependencies(_appId: AppId, _id: string): Promise<{ count: number; listings: string[] }> {
    return { count: 0, listings: [] };
  }

  async ensureDefaults(appId: AppId): Promise<void> {
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
}

export const schemasRepository = new SchemasRepository();
