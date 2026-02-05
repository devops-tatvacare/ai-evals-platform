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
        items: generateArrayItemSchema(field),
      };
    
    default:
      return { ...baseSchema, type: 'string' };
  }
}

function generateArrayItemSchema(field: EvaluatorOutputField): object {
  // If no schema defined, default to string array
  if (!field.arrayItemSchema) {
    return { type: 'string' };
  }
  
  const { itemType, properties } = field.arrayItemSchema;
  
  // Simple types
  if (itemType === 'string') return { type: 'string' };
  if (itemType === 'number') return { type: 'number' };
  if (itemType === 'boolean') return { type: 'boolean' };
  
  // Object type - build properties schema
  if (itemType === 'object' && properties && properties.length > 0) {
    const objectProperties: Record<string, object> = {};
    const required: string[] = [];
    
    properties.forEach(prop => {
      objectProperties[prop.key] = {
        type: prop.type,
        description: prop.description,
      };
      required.push(prop.key);
    });
    
    return {
      type: 'object',
      properties: objectProperties,
      required,
    };
  }
  
  // Fallback to string
  return { type: 'string' };
}
