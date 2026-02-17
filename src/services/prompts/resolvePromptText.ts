/**
 * Prompt Resolution Utility
 *
 * Resolves prompt text for a given step type by:
 * 1. Checking activePromptIds in LLM settings store
 * 2. Looking up the prompt in the prompts store
 * 3. Falling back to the built-in default matching sourceType in prompts store
 * 4. Falling back to any built-in default in prompts store
 * 5. Hardcoded constant matching sourceType
 * 6. Ultimate fallback: hardcoded constant prompts
 */

import type { AppId } from '@/types';
import { useLLMSettingsStore } from '@/stores/llmSettingsStore';
import { usePromptsStore } from '@/stores/promptsStore';
import {
  DEFAULT_TRANSCRIPTION_PROMPT,
  DEFAULT_EVALUATION_PROMPT,
  DEFAULT_EXTRACTION_PROMPT,
  API_TRANSCRIPTION_PROMPT,
  API_EVALUATION_PROMPT,
} from '@/constants';

type PromptStepType = 'transcription' | 'evaluation' | 'extraction';
type SourceType = 'upload' | 'api';

const FALLBACK_PROMPTS: Record<PromptStepType, string> = {
  transcription: DEFAULT_TRANSCRIPTION_PROMPT,
  evaluation: DEFAULT_EVALUATION_PROMPT,
  extraction: DEFAULT_EXTRACTION_PROMPT,
};

const API_FALLBACK_PROMPTS: Partial<Record<PromptStepType, string>> = {
  transcription: API_TRANSCRIPTION_PROMPT,
  evaluation: API_EVALUATION_PROMPT,
};

export function resolvePromptText(
  appId: AppId,
  type: PromptStepType,
  sourceType?: SourceType,
): string {
  const { activePromptIds } = useLLMSettingsStore.getState();
  const promptId = activePromptIds[type];

  // 1. Try the explicitly-selected prompt
  if (promptId) {
    const prompt = usePromptsStore.getState().getPrompt(appId, promptId);
    if (prompt) return prompt.prompt;
  }

  const prompts = usePromptsStore.getState().prompts[appId] ?? [];

  // 2. Fallback: find built-in default matching sourceType in prompts store
  if (sourceType) {
    const matched = prompts.find(
      p => p.promptType === type && p.isDefault && p.sourceType === sourceType
    );
    if (matched) return matched.prompt;
  }

  // 3. Fallback: any built-in default for this type
  const builtIn = prompts.find(p => p.promptType === type && p.isDefault);
  if (builtIn) return builtIn.prompt;

  // 4. Hardcoded constant matching sourceType
  if (sourceType === 'api') {
    const apiPrompt = API_FALLBACK_PROMPTS[type];
    if (apiPrompt) return apiPrompt;
  }

  // 5. Ultimate fallback: hardcoded constants
  return FALLBACK_PROMPTS[type];
}
