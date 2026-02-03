/**
 * Action Parser Types
 * Shared types for the action parsing system
 */

/**
 * Represents a parsed action button
 */
export interface ActionButton {
  id: string;
  label: string;
  variant: 'primary' | 'secondary' | 'tertiary';
  type?: 'submit' | 'cancel' | 'info';
}

/**
 * Result of parsing content for actions
 */
export interface ParseResult {
  actions: ActionButton[];
  cleanContent: string;
  parsedBy: string | null;
}

/**
 * Interface that all action parsers must implement
 */
export interface ActionParserStrategy {
  /** Unique name for this parser */
  name: string;
  
  /** Priority (lower = tried first) */
  priority: number;
  
  /** Check if this parser can handle the content */
  canParse(content: string): boolean;
  
  /** Extract actions from content */
  parse(content: string): ActionButton[];
  
  /** Remove action syntax from content */
  strip(content: string): string;
}
