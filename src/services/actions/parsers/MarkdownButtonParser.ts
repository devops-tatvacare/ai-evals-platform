/**
 * Markdown Button Parser
 * Parses [Button Text] patterns from API responses
 * Format: [Confirm Log] [Edit Meal]
 */

import type { ActionParserStrategy, ActionButton } from '../types';

export class MarkdownButtonParser implements ActionParserStrategy {
  name = 'markdown-button';
  priority = 2; // Lower priority (try after XML)
  
  // Match [Text] where Text starts with uppercase letter
  private BUTTON_REGEX = /\[([A-Z][^\]]+)\]/g;
  
  canParse(content: string): boolean {
    this.BUTTON_REGEX.lastIndex = 0;
    return this.BUTTON_REGEX.test(content);
  }
  
  parse(content: string): ActionButton[] {
    const actions: ActionButton[] = [];
    let match;
    
    this.BUTTON_REGEX.lastIndex = 0;
    while ((match = this.BUTTON_REGEX.exec(content)) !== null) {
      const label = match[1].trim();
      const id = this.labelToId(label);
      
      // First button is primary, rest are secondary
      const variant = actions.length === 0 ? 'primary' : 'secondary';
      
      actions.push({ id, label, variant });
    }
    
    return actions;
  }
  
  strip(content: string): string {
    return content
      .replace(this.BUTTON_REGEX, '')
      .replace(/\n{3,}/g, '\n\n') // Clean up extra newlines
      .trim();
  }
  
  /**
   * Convert label to snake_case ID
   */
  private labelToId(label: string): string {
    return label
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }
}
