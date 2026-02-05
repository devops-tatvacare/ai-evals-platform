/**
 * Extract available JSON paths from API response data
 * Returns ALL levels of hierarchy including parent objects
 */
export function extractApiVariablePaths(data: Record<string, unknown>): string[] {
  const paths: string[] = [];
  
  function traverse(obj: unknown, prefix: string = '') {
    if (obj === null || obj === undefined) return;
    
    // Add the current path if we have a prefix (don't add root)
    if (prefix) {
      paths.push(prefix);
    }
    
    if (Array.isArray(obj)) {
      // Array already added above, don't traverse items
      return;
    }
    
    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        
        // Recurse for objects and arrays, primitives get added when their parent is processed
        if (typeof value === 'object' && value !== null) {
          traverse(value, path);
        } else {
          // Add leaf node
          paths.push(path);
        }
      }
    }
  }
  
  traverse(data);
  return paths.sort();
}

/**
 * Get value from nested object using dot notation
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: any, part) => acc?.[part], obj);
}

/**
 * Generate display label from path with context
 * Shows the path hierarchy and converts last part to title case
 */
export function pathToLabel(path: string): string {
  const parts = path.split('.');
  
  if (parts.length === 1) {
    // Top-level field, just capitalize
    return path.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
  }
  
  // Show parent context with arrow
  const parent = parts.slice(0, -1).join('.');
  const lastPart = parts[parts.length - 1];
  const label = lastPart.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
  
  return `${parent} → ${label}`;
}

/**
 * Get the depth level of a path (number of dots)
 */
export function getPathDepth(path: string): number {
  return path.split('.').length - 1;
}

/**
 * Determine if a path represents an object (has children in the list)
 */
export function isObjectPath(path: string, allPaths: string[]): boolean {
  return allPaths.some(p => p.startsWith(path + '.'));
}
