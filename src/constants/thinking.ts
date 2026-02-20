/** Thinking level options for Gemini models.
 *
 * Shared by EvaluationOverlay (voice-rx) and LLMConfigStep (kaira evals).
 * The backend's `_build_thinking_config()` maps these to model-family-specific
 * params: thinking_budget (2.5) or thinking_level (3+).
 */
export const THINKING_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'No thinking — fastest, cheapest' },
  { value: 'low', label: 'Low', description: 'Light reasoning — good default' },
  { value: 'medium', label: 'Medium', description: 'Balanced reasoning' },
  { value: 'high', label: 'High', description: 'Deep reasoning — slowest, most thorough' },
];

/** Return a model-family hint string for the thinking selector description. */
export function getThinkingFamilyHint(modelName: string): string {
  if (modelName.includes('2.5')) return ' (budget-based)';
  if (modelName.includes('3')) return ' (level-based)';
  return '';
}
