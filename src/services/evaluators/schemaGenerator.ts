import type { EvaluatorOutputField } from '@/types';

/**
 * Generate JSON schema from user-defined output fields
 * This schema is passed to LLM for structured output enforcement
 */
export function generateJsonSchema(fields: EvaluatorOutputField[]): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  
  fields.forEach(field => {
    properties[field.key] = generateFieldSchema(field);
    required.push(field.key); // All fields are required
  });
  
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false, // Strict schema
  };
}

function generateFieldSchema(field: EvaluatorOutputField): object {
  const baseSchema: Record<string, unknown> = {
    description: field.description,
  };
  
  switch (field.type) {
    case 'number':
      return { ...baseSchema, type: 'number' };
    
    case 'text':
      return { ...baseSchema, type: 'string' };
    
    case 'boolean':
      return { ...baseSchema, type: 'boolean' };
    
    case 'array':
      return {
        ...baseSchema,
        type: 'array',
        items: { type: 'string' }, // Default to string array
      };
    
    default:
      return { ...baseSchema, type: 'string' };
  }
}
