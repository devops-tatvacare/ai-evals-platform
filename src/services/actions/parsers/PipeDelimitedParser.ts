import type { ActionButton, ActionParserStrategy } from '../types';

/**
 * Parser for pipe-delimited button format with bold markers
 * Example: "** Confirm Log | Edit Meal"
 * Priority: 1 (tried first with XML)
 */
export class PipeDelimitedParser implements ActionParserStrategy {
  name = 'PipeDelimitedParser';
  priority = 1;
  
  private readonly PATTERN = /\*\*\s*\n?\s*\*\*\s+([^*\n]+)/g;
  
  canParse(content: string): boolean {
    // Check for the pattern: ** (optional newline) ** button text
    return /\*\*\s*\n?\s*\*\*\s+.+/.test(content);
  }
  
  parse(content: string): ActionButton[] {
    const actions: ActionButton[] = [];
    const match = content.match(this.PATTERN);
    
    if (!match) return actions;
    
    // Extract the button text after the ** markers
    const buttonText = match[0].replace(/\*\*\s*\n?\s*\*\*\s+/, '').trim();
    
    // Split by pipe and create button for each
    const labels = buttonText.split('|').map(s => s.trim()).filter(Boolean);
    
    labels.forEach((label, index) => {
      const id = this.labelToId(label);
      // First button is primary, rest are secondary
      const variant = index === 0 ? 'primary' : 'secondary';
      actions.push({ id, label, variant });
    });
    
    return actions;
  }
  
  strip(content: string): string {
    return content
      .replace(this.PATTERN, '')
      .replace(/\n{3,}/g, '\n\n') // Clean up extra newlines
      .trim();
  }
  
  /**
   * Convert label to snake_case ID
   */
  private labelToId(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}
