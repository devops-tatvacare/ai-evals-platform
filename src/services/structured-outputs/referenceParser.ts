import { generateId } from '@/utils';
import type { StructuredOutputReference } from '@/types';

export interface ParsedReference {
  content: object;
  isValid: boolean;
  error?: string;
}

/**
 * Parse JSON or text file into structured output reference
 */
export async function parseReferenceFile(file: File): Promise<ParsedReference> {
  try {
    const text = await file.text();
    
    // Try parsing as JSON
    try {
      const json = JSON.parse(text);
      
      // Validate it's an object
      if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        return {
          content: {},
          isValid: false,
          error: 'File must contain a JSON object (not array or primitive)',
        };
      }
      
      return {
        content: json,
        isValid: true,
      };
    } catch {
      // If not valid JSON, treat as plain text
      return {
        content: { text },
        isValid: true,
      };
    }
  } catch (err) {
    return {
      content: {},
      isValid: false,
      error: err instanceof Error ? err.message : 'Failed to read file',
    };
  }
}

/**
 * Create a structured output reference from parsed content
 */
export function createReference(
  content: object,
  fileName: string,
  fileSize: number,
  description?: string
): StructuredOutputReference {
  return {
    id: generateId(),
    createdAt: new Date(),
    uploadedFile: {
      name: fileName,
      size: fileSize,
    },
    content,
    description,
  };
}

/**
 * Validate reference content (basic check)
 */
export function validateReferenceContent(content: unknown): { isValid: boolean; error?: string } {
  if (typeof content !== 'object' || content === null) {
    return {
      isValid: false,
      error: 'Content must be an object',
    };
  }
  
  if (Array.isArray(content)) {
    return {
      isValid: false,
      error: 'Content cannot be an array',
    };
  }
  
  if (Object.keys(content).length === 0) {
    return {
      isValid: false,
      error: 'Content cannot be empty',
    };
  }
  
  return { isValid: true };
}
