/**
 * Schema Validator for LLM Invocations
 * LENIENT validation - warns but doesn't fail
 */

export interface SchemaValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class SchemaValidator {
  validate(
    schema: Record<string, unknown>,
    context: string
  ): SchemaValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check required fields
    if (!schema.type) {
      errors.push('Schema missing "type" field');
    }
    
    if (schema.type === 'object' && !schema.properties) {
      errors.push('Object schema missing "properties" field');
    }
    
    // Check for circular references
    try {
      JSON.stringify(schema);
    } catch {
      errors.push('Schema contains circular references');
    }
    
    // Check depth (Gemini has limits)
    const depth = this.getSchemaDepth(schema);
    if (depth > 5) {
      warnings.push(`Schema is ${depth} levels deep (max recommended: 5)`);
    }
    
    // Log results
    if (errors.length > 0 || warnings.length > 0) {
      console.warn(`[SchemaValidator] ${context}:`, {
        errors,
        warnings,
        schema: JSON.stringify(schema).substring(0, 300),
      });
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  private getSchemaDepth(obj: unknown, current = 0): number {
    if (typeof obj !== 'object' || obj === null) return current;
    
    const properties = (obj as Record<string, unknown>).properties || 
                       (obj as Record<string, unknown>).items;
    if (!properties) return current;
    
    const depths = Object.values(properties as Record<string, unknown>).map(v => 
      this.getSchemaDepth(v, current + 1)
    );
    return Math.max(current, ...depths);
  }
}
