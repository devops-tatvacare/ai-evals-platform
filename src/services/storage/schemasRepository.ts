/**
 * Schemas Repository
 * Stores schemas in entities table using pattern-based storage
 */

import type { SchemaDefinition, AppId } from '@/types';
import {
  DEFAULT_TRANSCRIPTION_SCHEMA,
  DEFAULT_EVALUATION_SCHEMA,
  DEFAULT_EXTRACTION_SCHEMA,
} from '@/constants';
import { type Entity, saveEntity, deleteEntity, getEntities } from './db';

class SchemasRepository {
  private seedingPromises: Map<AppId, Promise<void>> = new Map();

  private async getAllSchemas(appId: AppId): Promise<SchemaDefinition[]> {
    const entities = await getEntities('schema', appId);
    
    return entities.map(e => ({
      id: String(e.id),  // Convert number to string for compatibility
      name: e.data.name as string,
      version: e.version!,
      promptType: e.key as SchemaDefinition['promptType'],
      schema: e.data.schema as Record<string, unknown>,  // Schema object
      description: e.data.description as string | undefined,
      isDefault: e.data.isDefault as boolean | undefined,
      createdAt: new Date(e.data.createdAt as string),
      updatedAt: new Date(e.data.updatedAt as string),
    }));
  }

  private async seedDefaults(appId: AppId): Promise<void> {
    const existing = await this.getAllSchemas(appId);
    if (existing.length > 0) return;

    const defaults = [
      DEFAULT_TRANSCRIPTION_SCHEMA,
      DEFAULT_EVALUATION_SCHEMA,
      DEFAULT_EXTRACTION_SCHEMA,
    ];

    for (const schemaDef of defaults) {
      await this.save(appId, {
        ...schemaDef,
        id: '',  // Will be auto-generated
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SchemaDefinition);
    }
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
    // Auto-generate name if creating new version
    if (!schema.id) {
      const latestVersion = await this.getLatestVersion(appId, schema.promptType);
      schema.version = latestVersion + 1;
      schema.name = `${this.getPromptTypeLabel(schema.promptType)} Schema v${schema.version}`;
      schema.createdAt = new Date();
    }
    schema.updatedAt = new Date();

    const entity: Omit<Entity, 'id'> & { id?: number } = {
      id: schema.id ? parseInt(schema.id, 10) : undefined,
      appId,
      type: 'schema',
      key: schema.promptType,
      version: schema.version,
      data: {
        name: schema.name,
        schema: schema.schema,  // Store schema object
        description: schema.description,
        isDefault: schema.isDefault,
        createdAt: schema.createdAt.toISOString(),
        updatedAt: schema.updatedAt.toISOString(),
      },
    };

    const id = await saveEntity(entity);
    schema.id = String(id);
    
    return schema;
  }

  async delete(appId: AppId, id: string): Promise<void> {
    const entities = await getEntities('schema', appId);
    const entity = entities.find(e => String(e.id) === id);
    
    if (!entity) {
      throw new Error('Schema not found');
    }
    if (entity.data.isDefault) {
      throw new Error('Cannot delete default schema');
    }

    await deleteEntity(entity.id!);
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
