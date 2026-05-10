/**
 * Phase 3 Step 7 — view-mode authoring suggestion.
 *
 * Two layers of coverage:
 *   1. The `isAuthoringShapedPrompt` heuristic — whole-word match on
 *      the 9 authoring verbs, case-insensitive; does NOT match read-only
 *      verbs ("show", "what", "how", "why").
 *   2. The chat widget's `send()` injects a one-time inline suggestion
 *      ABOVE the user's message when (kind === 'orchestration_builder'
 *      AND viewMode === 'view' AND heuristic matches). Per-message,
 *      not per-session — re-fires next time the user types this shape.
 */
import { describe, expect, it } from 'vitest';

import {
  VIEW_MODE_SUGGESTION_TEXT,
  isAuthoringShapedPrompt,
} from './BuilderContextChip';


describe('isAuthoringShapedPrompt — heuristic', () => {
  it('matches each of the 9 authoring verbs as whole words', () => {
    const verbs = [
      'add', 'remove', 'build', 'connect', 'change',
      'delete', 'update', 'edit', 'create',
    ];
    for (const verb of verbs) {
      expect(
        isAuthoringShapedPrompt(`Please ${verb} the WATI node`),
      ).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(isAuthoringShapedPrompt('ADD a Bolna step')).toBe(true);
    expect(isAuthoringShapedPrompt('Build me a workflow')).toBe(true);
    expect(isAuthoringShapedPrompt('REMOVE the SMS branch')).toBe(true);
  });

  it('does NOT match the 4 documented read-only verbs', () => {
    const readonly = ['show', 'what', 'how', 'why'];
    for (const verb of readonly) {
      expect(
        isAuthoringShapedPrompt(`${verb} does this branch do?`),
        `expected '${verb}' to be read-only-shaped`,
      ).toBe(false);
    }
  });

  it('only matches whole words — substrings should not trip', () => {
    // 'add' inside 'address' must NOT match.
    expect(isAuthoringShapedPrompt('What is the address of this node?')).toBe(false);
    // 'edit' inside 'editor' must NOT match.
    expect(isAuthoringShapedPrompt('Open the editor for the WATI node')).toBe(false);
    // 'create' inside 'creator' must NOT match.
    expect(isAuthoringShapedPrompt('Who is the creator of this workflow?')).toBe(false);
  });

  it('rejects empty / non-string input', () => {
    expect(isAuthoringShapedPrompt('')).toBe(false);
    expect(isAuthoringShapedPrompt('   ')).toBe(false);
    // @ts-expect-error — defensive against runtime mistakes.
    expect(isAuthoringShapedPrompt(null)).toBe(false);
    // @ts-expect-error — defensive.
    expect(isAuthoringShapedPrompt(undefined)).toBe(false);
  });

  it('exposes the canonical suggestion text', () => {
    expect(VIEW_MODE_SUGGESTION_TEXT).toContain('viewing');
    expect(VIEW_MODE_SUGGESTION_TEXT).toContain('Edit');
  });
});
