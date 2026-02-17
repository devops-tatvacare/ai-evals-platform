/**
 * Prompt Resolution Utility
 *
 * Resolves prompt text for a given step type by:
 * 1. Checking activePromptIds in LLM settings store
 * 2. Looking up the prompt in the prompts store
 * 3. Falling back to the built-in default prompt in the prompts store
 * 4. Ultimate fallback: hardcoded constant prompts
 */

import type { AppId } from '@/types';
import { useLLMSettingsStore } from '@/stores/llmSettingsStore';
import { usePromptsStore } from '@/stores/promptsStore';
import {
  DEFAULT_TRANSCRIPTION_PROMPT,
  DEFAULT_EVALUATION_PROMPT,
  DEFAULT_EXTRACTION_PROMPT,
} from '@/constants';

type PromptStepType = 'transcription' | 'evaluation' | 'extraction';

const FALLBACK_PROMPTS: Record<PromptStepType, string> = {
  transcription: DEFAULT_TRANSCRIPTION_PROMPT,
  evaluation: DEFAULT_EVALUATION_PROMPT,
  extraction: DEFAULT_EXTRACTION_PROMPT,
};

export function resolvePromptText(
  appId: AppId,
  type: PromptStepType,
): string {
  const { activePromptIds } = useLLMSettingsStore.getState();
  const promptId = activePromptIds[type];

  // 1. Try the explicitly-selected prompt
  if (promptId) {
    const prompt = usePromptsStore.getState().getPrompt(appId, promptId);
    if (prompt) return prompt.prompt;
  }

  // 2. Fallback: find built-in default in prompts store
  const prompts = usePromptsStore.getState().prompts[appId] ?? [];
  const builtIn = prompts.find(p => p.promptType === type && p.isDefault);
  if (builtIn) return builtIn.prompt;

  // 3. Ultimate fallback: hardcoded constants
  return FALLBACK_PROMPTS[type];
}
