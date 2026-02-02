/**
 * Schemas Repository
 * Stores schemas as JSON array in appSettings for simplicity
 */

import type { SchemaDefinition, AppId } from '@/types';
import { generateId } from '@/utils';
import {
  DEFAULT_TRANSCRIPTION_SCHEMA,
  DEFAULT_EVALUATION_SCHEMA,
  DEFAULT_EXTRACTION_SCHEMA,
} from '@/constants';
import { getAppSetting, setAppSetting } from './db';

const SCHEMAS_KEY = 'schemas';

class SchemasRepository {
  private seedingPromises: Map<AppId, Promise<void>> = new Map();

  private async getAllSchemas(appId: AppId): Promise<SchemaDefinition[]> {
    const schemas = await getAppSetting<SchemaDefinition[]>(appId, SCHEMAS_KEY);
    return schemas ?? [];
  }

  private async saveAllSchemas(appId: AppId, schemas: SchemaDefinition[]): Promise<void> {
    await setAppSetting(appId, SCHEMAS_KEY, schemas);
  }

  private async seedDefaults(appId: AppId): Promise<void> {
    const existing = await this.getAllSchemas(appId);
    if (existing.length > 0) return;

    const defaults = [
      DEFAULT_TRANSCRIPTION_SCHEMA,
      DEFAULT_EVALUATION_SCHEMA,
      DEFAULT_EXTRACTION_SCHEMA,
    ];

    const now = new Date();
    const records: SchemaDefinition[] = defaults.map(schema => ({
      ...schema,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    }));

    await this.saveAllSchemas(appId, records);
  }

  async getAll(appId: AppId, promptType?: SchemaDefinition['promptType']): Promise<SchemaDefinition[]> {
    // Ensure defaults exist (only seeds once per app)
    if (!this.seedingPromises.has(appId)) {
      this.seedingPromises.set(appId, this.seedDefaults(appId));
    }
    await this.seedingPromises.get(appId);
    
    let results = await this.getAllSchemas(appId);
    
    if (promptType) {
      results = results.filter(s => s.promptType === promptType);
    }
    
    // Sort by version descending
    results.sort((a, b) => b.version - a.version);
    return results;
  }

  async getById(appId: AppId, id: string): Promise<SchemaDefinition | null> {
    const schemas = await this.getAllSchemas(appId);
    return schemas.find(s => s.id === id) ?? null;
  }

  async getLatestVersion(appId: AppId, promptType: SchemaDefinition['promptType']): Promise<number> {
    const schemas = await this.getAll(appId, promptType);
    if (schemas.length === 0) return 0;
    return Math.max(...schemas.map(s => s.version));
  }

  async save(appId: AppId, schema: SchemaDefinition): Promise<SchemaDefinition> {
    const schemas = await this.getAllSchemas(appId);
    
    // Auto-generate name if creating new version
    if (!schema.id) {
      const latestVersion = await this.getLatestVersion(appId, schema.promptType);
      schema.id = generateId();
      schema.version = latestVersion + 1;
      schema.name = `${this.getPromptTypeLabel(schema.promptType)} Schema v${schema.version}`;
      schema.createdAt = new Date();
    }
    schema.updatedAt = new Date();

    // Update existing or add new
    const existingIndex = schemas.findIndex(s => s.id === schema.id);
    if (existingIndex >= 0) {
      schemas[existingIndex] = schema;
    } else {
      schemas.push(schema);
    }
    
    await this.saveAllSchemas(appId, schemas);
    return schema;
  }

  async delete(appId: AppId, id: string): Promise<void> {
    const schemas = await this.getAllSchemas(appId);
    const schema = schemas.find(s => s.id === id);
    
    if (!schema) {
      throw new Error('Schema not found');
    }
    if (schema.isDefault) {
      throw new Error('Cannot delete default schema');
    }

    const filtered = schemas.filter(s => s.id !== id);
    await this.saveAllSchemas(appId, filtered);
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
