/**
 * Schema Service
 * Unified service for schema CRUD, derivation, generation, and validation
 * Flow-agnostic design for upload, API, and future flows
 */

import type { SchemaDefinition, AppId } from '@/types';
import { schemasRepository } from '@/services/storage';
import { deriveSchemaFromApiResponse } from '@/utils/schemaDerivation';
import { llmAssistApi } from '@/services/api/llmAssistApi';
import type { LLMProvider } from '@/services/api/aiSettingsApi';

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
 * Generate schema via the server-side LLM-assist endpoint.
 *
 * Phase 3 BYOK: the browser never holds an API key. Caller passes the
 * provider+model picked from the admin-configured catalogue; the backend
 * resolves credentials through `resolve_llm_credentials`.
 */
export async function generateSchemaWithAI(args: {
  provider: LLMProvider;
  model: string;
  userIdea: string;
  promptType: SchemaDefinition['promptType'];
}): Promise<Record<string, unknown>> {
  if (!args.userIdea.trim()) {
    throw new Error('User idea cannot be empty');
  }
  if (!args.provider || !args.model) {
    throw new Error('Provider and model are required');
  }

  const { schema } = await llmAssistApi.generateSchema({
    provider: args.provider,
    model: args.model,
    promptType: args.promptType,
    userIdea: args.userIdea,
  });

  if (!schema || schema.type !== 'object' || !schema.properties) {
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

  static async generateWithAI(args: Parameters<typeof generateSchemaWithAI>[0]) {
    return generateSchemaWithAI(args);
  }

  static validate(schema: Record<string, unknown>) {
    return validateSchema(schema);
  }

  static createTransient(schema: Record<string, unknown>, source: Parameters<typeof createTransientSchema>[1]) {
    return createTransientSchema(schema, source);
  }
}

export default SchemaService;
