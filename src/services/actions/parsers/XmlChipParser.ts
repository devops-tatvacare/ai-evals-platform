/**
 * XML Chip Parser
 * Parses <chip> tags from API responses
 * Format: <chip id="..." label="..." type="..." variant="..." />
 */

import type { ActionParserStrategy, ActionButton } from '../types';

export class XmlChipParser implements ActionParserStrategy {
  name = 'xml-chip';
  priority = 1; // Higher priority (try first)
  
  private CHIP_REGEX = /<chip\s+id="([^"]+)"\s+label="([^"]*)"\s+type="([^"]+)"\s+variant="([^"]+)"\s*\/>/g;
  
  canParse(content: string): boolean {
    // Reset regex state
    this.CHIP_REGEX.lastIndex = 0;
    return this.CHIP_REGEX.test(content);
  }
  
  parse(content: string): ActionButton[] {
    const actions: ActionButton[] = [];
    let match;
    
    this.CHIP_REGEX.lastIndex = 0;
    while ((match = this.CHIP_REGEX.exec(content)) !== null) {
      const id = match[1];
      const label = match[2] || this.getDefaultLabel(id);
      const variant = this.mapVariant(match[4]);
      
      actions.push({ id, label, variant });
    }
    
    return actions;
  }
  
  strip(content: string): string {
    return content
      .replace(this.CHIP_REGEX, '')
      .replace(/\n{3,}/g, '\n\n') // Clean up extra newlines
      .trim();
  }
  
  /**
   * Map API variant to our button variant
   */
  private mapVariant(apiVariant: string): 'primary' | 'secondary' | 'tertiary' {
    switch (apiVariant) {
      case 'kaira':
        return 'primary';
      case 'kaira-outline':
        return 'secondary';
      default:
        return 'tertiary';
    }
  }
  
  /**
   * Provide default labels when API sends empty label=""
   */
  private getDefaultLabel(id: string): string {
    const defaults: Record<string, string> = {
      'confirm_log': '✅ Yes, log this meal',
      'edit_meal': '✏️ No, edit this meal',
      'confirm': '✅ Confirm',
      'cancel': '❌ Cancel',
      'yes': '✅ Yes',
      'no': '❌ No',
    };
    return defaults[id] || id;
  }
}
