/**
 * Phase 3 — authoring-shape heuristic + suggestion text.
 *
 * Lives in a sibling file (not on `BuilderContextChip.tsx`) so the
 * react-refresh lint rule can keep the chip module exports limited to
 * the component itself.
 *
 * The chat widget consults this during `send()` when the user is in
 * `view` mode on the builder. A whole-word match on any of the listed
 * verbs (case-insensitive) triggers a one-time inline suggestion in
 * the chat thread; the user's message still goes through and the LLM
 * refuses via the supervisor prompt — this is an early-feedback
 * affordance, not a gate.
 *
 * Heuristic is intentionally crude: false positives are cheap (the
 * LLM refuses anyway), false negatives just mean no early feedback.
 * Do not import a NLP library; do not call an LLM to classify intent.
 */
const AUTHORING_VERBS: readonly string[] = [
  'add',
  'remove',
  'build',
  'connect',
  'change',
  'delete',
  'update',
  'edit',
  'create',
];

const AUTHORING_VERB_REGEX = new RegExp(
  `\\b(?:${AUTHORING_VERBS.join('|')})\\b`,
  'i',
);

export function isAuthoringShapedPrompt(text: string): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return AUTHORING_VERB_REGEX.test(text);
}

export const VIEW_MODE_SUGGESTION_TEXT =
  "You're viewing — click Edit on the canvas to let me make changes.";
