/**
 * Schema Derivation Utility
 * Derives JSON Schema from example objects for structured output generation
 */

/**
 * Infer JSON Schema type from a JavaScript value
 */
function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  
  const type = typeof value;
  if (type === 'boolean') return 'boolean';
  if (type === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (type === 'string') return 'string';
  if (type === 'object') return 'object';
  
  return 'string'; // Default fallback
}

/**
 * Derive JSON Schema from an array of examples
 */
function deriveArraySchema(array: unknown[]): Record<string, unknown> {
  if (array.length === 0) {
    return {
      type: 'array',
      items: { type: 'string' }, // Default to string items
    };
  }
  
  // Sample first item to infer item schema
  const firstItem = array[0];
  const itemType = inferType(firstItem);
  
  if (itemType === 'object') {
    return {
      type: 'array',
      items: deriveObjectSchema(firstItem as Record<string, unknown>),
    };
  }
  
  return {
    type: 'array',
    items: { type: itemType },
  };
}

/**
 * Derive JSON Schema from an object
 */
function deriveObjectSchema(obj: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    
    const type = inferType(value);
    
    if (type === 'array') {
      properties[key] = deriveArraySchema(value as unknown[]);
    } else if (type === 'object' && value !== null) {
      properties[key] = deriveObjectSchema(value as Record<string, unknown>);
    } else {
      properties[key] = {
        type,
        ...(type === 'null' ? {} : {}), // Could add additional constraints here
      };
    }
    
    // Mark non-null fields as required
    if (value !== null && value !== undefined) {
      required.push(key);
    }
  }
  
  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Derive a JSON Schema from a JavaScript object
 * Best-effort schema generation for structured output
 * 
 * @param json - Example object to derive schema from
 * @returns JSON Schema object
 * 
 * @example
 * const example = { name: 'John', age: 30, tags: ['dev', 'react'] };
 * const schema = deriveSchemaFromJson(example);
 * // Returns:
 * // {
 * //   type: 'object',
 * //   properties: {
 * //     name: { type: 'string' },
 * //     age: { type: 'integer' },
 * //     tags: { type: 'array', items: { type: 'string' } }
 * //   },
 * //   required: ['name', 'age', 'tags']
 * // }
 */
export function deriveSchemaFromJson(json: Record<string, unknown>): Record<string, unknown> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Input must be a non-null object');
  }
  
  return deriveObjectSchema(json);
}

/**
 * Derive a schema from structured output in API response
 * Extracts the structured data portion and generates schema
 * 
 * @param apiResponse - API response object containing structured data
 * @returns JSON Schema object or null if no structured data found
 */
export function deriveSchemaFromApiResponse(apiResponse: Record<string, unknown>): Record<string, unknown> | null {
  // Try common paths for structured data in API responses
  const candidates = [
    apiResponse.rx,           // Direct rx field
    apiResponse.data,         // Common data field
    apiResponse.result,       // Common result field
    apiResponse.structuredData, // Explicit structured data field
    apiResponse,              // Fallback to entire response
  ];
  
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      try {
        return deriveSchemaFromJson(candidate as Record<string, unknown>);
      } catch {
        // Try next candidate
        continue;
      }
    }
  }
  
  return null;
}

/**
 * Enhance a derived schema with descriptions and better names
 * (Optional enhancement for better prompt quality)
 * 
 * @param schema - Base schema to enhance
 * @param descriptions - Map of field paths to descriptions
 * @returns Enhanced schema
 */
export function enhanceSchema(
  schema: Record<string, unknown>,
  descriptions?: Map<string, string>
): Record<string, unknown> {
  if (!descriptions || descriptions.size === 0) {
    return schema;
  }
  
  // Deep clone to avoid mutation
  const enhanced = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  
  // Add descriptions to properties
  if (enhanced.properties && typeof enhanced.properties === 'object') {
    const props = enhanced.properties as Record<string, Record<string, unknown>>;
    for (const [key, desc] of descriptions.entries()) {
      if (props[key]) {
        props[key].description = desc;
      }
    }
  }
  
  return enhanced;
}
