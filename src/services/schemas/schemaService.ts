/**
 * Schema Service
 * Unified service for schema CRUD, derivation, generation, and validation
 * Flow-agnostic design for upload, API, and future flows
 */

import type { SchemaDefinition, AppId } from '@/types';
import { schemasRepository } from '@/services/storage';
import { deriveSchemaFromApiResponse } from '@/utils/schemaDerivation';
import { createLLMPipelineWithModel } from '@/services/llm';
import { SCHEMA_GENERATOR_SYSTEM_PROMPT } from '@/constants';

/**
 * Create a new schema and save to storage
 */
export async function createSchema(
  appId: AppId,
  data: {
    name?: string;
    promptType: SchemaDefinition['promptType'];
    schema: Record<string, unknown>;
    description?: string;
    isDefault?: boolean;
  }
): Promise<SchemaDefinition> {
  const newSchema: SchemaDefinition = {
    id: '',
    name: data.name || '',
    version: 0,
    promptType: data.promptType,
    schema: data.schema,
    description: data.description,
    isDefault: data.isDefault || false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return await schemasRepository.save(appId, newSchema);
}

/**
 * Update an existing schema
 */
export async function updateSchema(
  appId: AppId,
  schemaId: string,
  updates: {
    name?: string;
    schema?: Record<string, unknown>;
    description?: string;
  }
): Promise<SchemaDefinition> {
  const existing = await schemasRepository.getById(appId, schemaId);
  if (!existing) {
    throw new Error('Schema not found');
  }

  const updated: SchemaDefinition = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };

  return await schemasRepository.save(appId, updated);
}

/**
 * Delete a schema from storage
 */
export async function deleteSchema(appId: AppId, schemaId: string): Promise<void> {
  await schemasRepository.delete(appId, schemaId);
}

/**
 * Derive schema from structured output (API response or example object)
 */
export function deriveSchemaFromStructuredOutput(
  output: Record<string, unknown>
): Record<string, unknown> | null {
  return deriveSchemaFromApiResponse(output);
}

/**
 * Generate schema using AI
 */
export async function generateSchemaWithAI(
  userIdea: string,
  promptType: SchemaDefinition['promptType'],
  modelName: string
): Promise<Record<string, unknown>> {
  if (!userIdea.trim()) {
    throw new Error('User idea cannot be empty');
  }

  const pipeline = createLLMPipelineWithModel(modelName);

  const prompt = SCHEMA_GENERATOR_SYSTEM_PROMPT
    .replace('{{promptType}}', promptType)
    .replace('{{userIdea}}', userIdea);

  const response = await pipeline.invoke({
    prompt,
    output: { format: 'json' },
    context: {
      source: 'schema-gen',
      sourceId: `${promptType}-ai-gen`,
      metadata: { promptType, userIdea },
    },
  });

  if (!response.output.text) {
    throw new Error('No schema generated');
  }

  // Parse JSON response
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(response.output.text);
  } catch {
    throw new Error('Invalid JSON schema generated');
  }

  return schema;
}

/**
 * Validate a JSON Schema
 */
export function validateSchema(schema: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Basic structural validation
  if (typeof schema !== 'object' || schema === null) {
    errors.push('Schema must be an object');
    return { valid: false, errors };
  }

  if (schema.type !== 'object') {
    errors.push('Root schema type must be "object"');
  }

  if (!schema.properties || typeof schema.properties !== 'object') {
    errors.push('Schema must have "properties" object');
  }

  if (!Array.isArray(schema.required)) {
    errors.push('Schema must have "required" array');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a transient schema object (for "apply this run only" workflows)
 */
export function createTransientSchema(
  schema: Record<string, unknown>,
  source: 'derived' | 'ai-generated' | 'custom'
): SchemaDefinition {
  return {
    id: `transient-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: `Transient Schema (${source})`,
    version: 0,
    promptType: 'transcription', // Will be overridden by caller
    schema,
    description: 'Temporary schema for single-run use',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * SchemaService class (optional class-based interface)
 */
export class SchemaService {
  static async create(appId: AppId, data: Parameters<typeof createSchema>[1]) {
    return createSchema(appId, data);
  }

  static async update(appId: AppId, schemaId: string, updates: Parameters<typeof updateSchema>[2]) {
    return updateSchema(appId, schemaId, updates);
  }

  static async delete(appId: AppId, schemaId: string) {
    return deleteSchema(appId, schemaId);
  }

  static deriveFromStructuredOutput(output: Record<string, unknown>) {
    return deriveSchemaFromStructuredOutput(output);
  }

  static async generateWithAI(userIdea: string, promptType: SchemaDefinition['promptType'], modelName: string) {
    return generateSchemaWithAI(userIdea, promptType, modelName);
  }

  static validate(schema: Record<string, unknown>) {
    return validateSchema(schema);
  }

  static createTransient(schema: Record<string, unknown>, source: Parameters<typeof createTransientSchema>[1]) {
    return createTransientSchema(schema, source);
  }
}

export default SchemaService;
