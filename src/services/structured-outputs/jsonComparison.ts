/**
 * JSON comparison utilities for structured outputs
 */

export interface JsonDiff {
  path: string;
  type: 'added' | 'removed' | 'changed' | 'unchanged';
  referenceValue?: unknown;
  llmValue?: unknown;
}

export interface ComparisonMetrics {
  totalFields: number;
  matchingFields: number;
  addedFields: number;
  removedFields: number;
  changedFields: number;
  matchPercentage: number;
}

/**
 * Deep comparison of two JSON objects
 */
export function compareJson(
  reference: object,
  llmOutput: object,
  path: string = ''
): JsonDiff[] {
  const diffs: JsonDiff[] = [];
  
  const refKeys = new Set(Object.keys(reference));
  const llmKeys = new Set(Object.keys(llmOutput));
  const allKeys = new Set([...refKeys, ...llmKeys]);
  
  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const refValue = (reference as Record<string, unknown>)[key];
    const llmValue = (llmOutput as Record<string, unknown>)[key];
    
    // Removed from LLM output
    if (refKeys.has(key) && !llmKeys.has(key)) {
      diffs.push({
        path: currentPath,
        type: 'removed',
        referenceValue: refValue,
      });
      continue;
    }
    
    // Added in LLM output
    if (!refKeys.has(key) && llmKeys.has(key)) {
      diffs.push({
        path: currentPath,
        type: 'added',
        llmValue,
      });
      continue;
    }
    
    // Both have the key
    const refIsObject = isPlainObject(refValue);
    const llmIsObject = isPlainObject(llmValue);
    
    // Both are objects - recurse
    if (refIsObject && llmIsObject) {
      diffs.push(...compareJson(refValue as object, llmValue as object, currentPath));
      continue;
    }
    
    // Compare values
    if (deepEqual(refValue, llmValue)) {
      diffs.push({
        path: currentPath,
        type: 'unchanged',
        referenceValue: refValue,
        llmValue,
      });
    } else {
      diffs.push({
        path: currentPath,
        type: 'changed',
        referenceValue: refValue,
        llmValue,
      });
    }
  }
  
  return diffs;
}

/**
 * Calculate comparison metrics from diffs
 */
export function calculateMetrics(diffs: JsonDiff[]): ComparisonMetrics {
  const matchingFields = diffs.filter((d) => d.type === 'unchanged').length;
  const addedFields = diffs.filter((d) => d.type === 'added').length;
  const removedFields = diffs.filter((d) => d.type === 'removed').length;
  const changedFields = diffs.filter((d) => d.type === 'changed').length;
  const totalFields = diffs.length;
  
  const matchPercentage = totalFields > 0 ? Math.round((matchingFields / totalFields) * 100) : 0;
  
  return {
    totalFields,
    matchingFields,
    addedFields,
    removedFields,
    changedFields,
    matchPercentage,
  };
}

/**
 * Format value for display
 */
export function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return `{${Object.keys(value).length} fields}`;
  return String(value);
}

/**
 * Check if value is a plain object
 */
function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep equality check
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  
  if (typeof a !== typeof b) return false;
  
  if (typeof a !== 'object' || a === null || b === null) {
    return a === b;
  }
  
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  
  if (Array.isArray(a) || Array.isArray(b)) {
    return false;
  }
  
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  
  if (aKeys.length !== bKeys.length) return false;
  
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}
