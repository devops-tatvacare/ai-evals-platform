/**
 * Action Parser
 * Main orchestrator for parsing action buttons from API responses
 * 
 * This service uses a strategy pattern to support multiple action formats.
 * When the API changes its format, simply add a new parser - no changes
 * to existing code required.
 * 
 * Usage:
 *   const result = actionParser.parse(messageContent);
 *   // result.actions => ActionButton[]
 *   // result.cleanContent => content with actions stripped
 *   // result.parsedBy => which parser was used (for debugging)
 */

import { XmlChipParser, MarkdownButtonParser, PipeDelimitedParser } from './parsers';
import type { ActionParserStrategy, ParseResult } from './types';

class ActionParser {
  private parsers: ActionParserStrategy[] = [];
  
  constructor() {
    this.registerDefaultParsers();
  }
  
  /**
   * Register default parsers
   */
  private registerDefaultParsers() {
    this.register(new XmlChipParser());
    this.register(new MarkdownButtonParser());
    this.register(new PipeDelimitedParser());
  }
  
  /**
   * Register a new parser
   * Parsers are tried in priority order (lower priority = tried first)
   */
  register(parser: ActionParserStrategy) {
    this.parsers.push(parser);
    // Sort by priority
    this.parsers.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Parse content for actions
   * Returns first parser that can handle the content
   */
  parse(content: string): ParseResult {
    if (!content) {
      return {
        actions: [],
        cleanContent: content,
        parsedBy: null,
      };
    }
    
    // Try each parser in priority order
    for (const parser of this.parsers) {
      if (parser.canParse(content)) {
        return {
          actions: parser.parse(content),
          cleanContent: parser.strip(content),
          parsedBy: parser.name,
        };
      }
    }
    
    // No parser matched - return content as-is
    return {
      actions: [],
      cleanContent: content,
      parsedBy: null,
    };
  }
  
  /**
   * Strip all recognized action formats from content
   * Useful when you want to remove actions but don't need to parse them
   */
  strip(content: string): string {
    if (!content) return content;
    
    let cleaned = content;
    for (const parser of this.parsers) {
      if (parser.canParse(cleaned)) {
        cleaned = parser.strip(cleaned);
      }
    }
    return cleaned;
  }
  
  /**
   * Check if content has any parseable actions
   */
  hasActions(content: string): boolean {
    if (!content) return false;
    return this.parsers.some(parser => parser.canParse(content));
  }
}

// Singleton instance
export const actionParser = new ActionParser();

// Export types for use in components
export type { ActionButton, ParseResult } from './types';
