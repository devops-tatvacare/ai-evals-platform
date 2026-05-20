export interface BrainNode {
  id: string;
  label: string;
  type: 'feature' | 'file' | 'method';
  layer: 'frontend' | 'backend' | 'shared';
  feature: string;
  fullPath?: string;
  radius?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  _selected?: boolean;
}

export interface BrainLink {
  source: string | BrainNode;
  target: string | BrainNode;
}

const featureNodes: BrainNode[] = [
  { id: 'feat-voice-rx-eval', label: 'Voice RX Evaluation', type: 'feature', layer: 'shared', feature: 'voice-rx-eval' },
  { id: 'feat-batch-eval', label: 'Batch Evaluation', type: 'feature', layer: 'shared', feature: 'batch-eval' },
  { id: 'feat-adversarial', label: 'Adversarial Testing', type: 'feature', layer: 'shared', feature: 'adversarial' },
  { id: 'feat-custom-evaluators', label: 'Custom Evaluators', type: 'feature', layer: 'shared', feature: 'custom-evaluators' },
  { id: 'feat-template-vars', label: 'Template Variables', type: 'feature', layer: 'frontend', feature: 'template-vars' },
  { id: 'feat-llm-pipeline', label: 'LLM Pipeline', type: 'feature', layer: 'shared', feature: 'llm-pipeline' },
  { id: 'feat-settings-config', label: 'Settings & Config', type: 'feature', layer: 'shared', feature: 'settings-config' },
];

// Voice RX Evaluation
const vrxFiles: BrainNode[] = [
  { id: 'file-voice-rx-runner', label: 'voice_rx_runner.py', type: 'file', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/voice_rx_runner.py' },
  { id: 'file-evaluation-overlay', label: 'EvaluationOverlay.tsx', type: 'file', layer: 'frontend', feature: 'voice-rx-eval', fullPath: 'src/features/evals/components/EvaluationOverlay.tsx' },
  { id: 'file-use-ai-evaluation', label: 'useAIEvaluation.ts', type: 'file', layer: 'frontend', feature: 'voice-rx-eval', fullPath: 'src/features/evals/hooks/useAIEvaluation.ts' },
  { id: 'file-response-parser', label: 'response_parser.py', type: 'file', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/response_parser.py' },
  { id: 'file-prompt-resolver', label: 'prompt_resolver.py', type: 'file', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/prompt_resolver.py' },
];

const vrxMethods: BrainNode[] = [
  { id: 'meth-run-voice-rx', label: 'run_voice_rx_evaluation', type: 'method', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/voice_rx_runner.py' },
  { id: 'meth-save-api-log', label: '_save_api_log', type: 'method', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/voice_rx_runner.py' },
  { id: 'meth-update-progress', label: '_update_progress', type: 'method', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/voice_rx_runner.py' },
  { id: 'meth-evaluation-overlay', label: 'EvaluationOverlay', type: 'method', layer: 'frontend', feature: 'voice-rx-eval', fullPath: 'src/features/evals/components/EvaluationOverlay.tsx' },
  { id: 'meth-use-ai-eval', label: 'useAIEvaluation', type: 'method', layer: 'frontend', feature: 'voice-rx-eval', fullPath: 'src/features/evals/hooks/useAIEvaluation.ts' },
  { id: 'meth-parse-transcript', label: 'parse_transcript_response', type: 'method', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/response_parser.py' },
  { id: 'meth-parse-critique', label: 'parse_critique_response', type: 'method', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/response_parser.py' },
  { id: 'meth-parse-api-critique', label: 'parse_api_critique_response', type: 'method', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/response_parser.py' },
  { id: 'meth-resolve-prompt', label: 'resolve_prompt', type: 'method', layer: 'backend', feature: 'voice-rx-eval', fullPath: 'backend/app/services/evaluators/prompt_resolver.py' },
];

// Batch Evaluation
const batchFiles: BrainNode[] = [
  { id: 'file-batch-runner', label: 'batch_runner.py', type: 'file', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/batch_runner.py' },
  { id: 'file-data-loader', label: 'data_loader.py', type: 'file', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/data_loader.py' },
  { id: 'file-intent-evaluator', label: 'intent_evaluator.py', type: 'file', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/intent_evaluator.py' },
  { id: 'file-correctness-evaluator', label: 'correctness_evaluator.py', type: 'file', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/correctness_evaluator.py' },
  { id: 'file-efficiency-evaluator', label: 'efficiency_evaluator.py', type: 'file', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/efficiency_evaluator.py' },
  { id: 'file-new-batch-overlay', label: 'NewBatchEvalOverlay.tsx', type: 'file', layer: 'frontend', feature: 'batch-eval', fullPath: 'src/features/evalRuns/components/NewBatchEvalOverlay.tsx' },
];

const batchMethods: BrainNode[] = [
  { id: 'meth-run-batch', label: 'run_batch_evaluation', type: 'method', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/batch_runner.py' },
  { id: 'meth-data-loader', label: 'DataLoader', type: 'method', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/data_loader.py' },
  { id: 'meth-get-thread', label: 'get_thread', type: 'method', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/data_loader.py' },
  { id: 'meth-get-all-threads', label: 'get_all_thread_ids', type: 'method', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/data_loader.py' },
  { id: 'meth-intent-eval', label: 'IntentEvaluator', type: 'method', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/intent_evaluator.py' },
  { id: 'meth-evaluate-thread', label: 'evaluate_thread', type: 'method', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/intent_evaluator.py' },
  { id: 'meth-correctness-eval', label: 'CorrectnessEvaluator', type: 'method', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/correctness_evaluator.py' },
  { id: 'meth-efficiency-eval', label: 'EfficiencyEvaluator', type: 'method', layer: 'backend', feature: 'batch-eval', fullPath: 'backend/app/services/evaluators/efficiency_evaluator.py' },
  { id: 'meth-new-batch-overlay', label: 'NewBatchEvalOverlay', type: 'method', layer: 'frontend', feature: 'batch-eval', fullPath: 'src/features/evalRuns/components/NewBatchEvalOverlay.tsx' },
];

// Adversarial Testing
const advFiles: BrainNode[] = [
  { id: 'file-adversarial-runner', label: 'adversarial_runner.py', type: 'file', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/adversarial_runner.py' },
  { id: 'file-adversarial-evaluator', label: 'adversarial_evaluator.py', type: 'file', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/adversarial_evaluator.py' },
  { id: 'file-kaira-client', label: 'kaira_client.py', type: 'file', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/kaira_client.py' },
  { id: 'file-conversation-agent', label: 'conversation_agent.py', type: 'file', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/conversation_agent.py' },
  { id: 'file-new-adversarial-overlay', label: 'NewAdversarialOverlay.tsx', type: 'file', layer: 'frontend', feature: 'adversarial', fullPath: 'src/features/evalRuns/components/NewAdversarialOverlay.tsx' },
];

const advMethods: BrainNode[] = [
  { id: 'meth-run-adversarial', label: 'run_adversarial_evaluation', type: 'method', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/adversarial_runner.py' },
  { id: 'meth-adversarial-eval', label: 'AdversarialEvaluator', type: 'method', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/adversarial_evaluator.py' },
  { id: 'meth-generate-test-cases', label: 'generate_test_cases', type: 'method', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/adversarial_evaluator.py' },
  { id: 'meth-evaluate-transcript', label: 'evaluate_transcript', type: 'method', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/adversarial_evaluator.py' },
  { id: 'meth-kaira-client', label: 'KairaClient', type: 'method', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/kaira_client.py' },
  { id: 'meth-conversation-agent', label: 'ConversationAgent', type: 'method', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/conversation_agent.py' },
  { id: 'meth-run-conversation', label: 'run_conversation', type: 'method', layer: 'backend', feature: 'adversarial', fullPath: 'backend/app/services/evaluators/conversation_agent.py' },
  { id: 'meth-new-adversarial-overlay', label: 'NewAdversarialOverlay', type: 'method', layer: 'frontend', feature: 'adversarial', fullPath: 'src/features/evalRuns/components/NewAdversarialOverlay.tsx' },
];

// Custom Evaluators
const customFiles: BrainNode[] = [
  { id: 'file-custom-eval-runner', label: 'custom_evaluator_runner.py', type: 'file', layer: 'backend', feature: 'custom-evaluators', fullPath: 'backend/app/services/evaluators/custom_evaluator_runner.py' },
  { id: 'file-use-evaluator-runner', label: 'useEvaluatorRunner.ts', type: 'file', layer: 'frontend', feature: 'custom-evaluators', fullPath: 'src/features/evals/hooks/useEvaluatorRunner.ts' },
  { id: 'file-schema-generator', label: 'schema_generator.py', type: 'file', layer: 'backend', feature: 'custom-evaluators', fullPath: 'backend/app/services/evaluators/schema_generator.py' },
];

const customMethods: BrainNode[] = [
  { id: 'meth-run-custom-eval', label: 'run_custom_evaluator', type: 'method', layer: 'backend', feature: 'custom-evaluators', fullPath: 'backend/app/services/evaluators/custom_evaluator_runner.py' },
  { id: 'meth-extract-scores', label: '_extract_scores', type: 'method', layer: 'backend', feature: 'custom-evaluators', fullPath: 'backend/app/services/evaluators/custom_evaluator_runner.py' },
  { id: 'meth-use-evaluator-runner', label: 'useEvaluatorRunner', type: 'method', layer: 'frontend', feature: 'custom-evaluators', fullPath: 'src/features/evals/hooks/useEvaluatorRunner.ts' },
  { id: 'meth-gen-json-schema', label: 'generate_json_schema', type: 'method', layer: 'backend', feature: 'custom-evaluators', fullPath: 'backend/app/services/evaluators/schema_generator.py' },
];

// Template Variables
const templateFiles: BrainNode[] = [
  { id: 'file-variable-registry', label: 'variable_registry.py', type: 'file', layer: 'backend', feature: 'template-vars', fullPath: 'backend/app/services/evaluators/variable_registry.py' },
  { id: 'file-variable-resolver', label: 'variableResolver.ts', type: 'file', layer: 'frontend', feature: 'template-vars', fullPath: 'src/services/templates/variableResolver.ts' },
];

const templateMethods: BrainNode[] = [
  { id: 'meth-get-available-vars', label: 'getAvailableDataKeys', type: 'method', layer: 'frontend', feature: 'template-vars', fullPath: 'src/services/templates/variableResolver.ts' },
  { id: 'meth-extract-variables', label: 'extractVariables', type: 'method', layer: 'frontend', feature: 'template-vars', fullPath: 'src/services/templates/variableResolver.ts' },
  { id: 'meth-validate-prompt-vars', label: 'validate_prompt', type: 'method', layer: 'backend', feature: 'template-vars', fullPath: 'backend/app/services/evaluators/variable_registry.py' },
  { id: 'meth-resolve-variable', label: 'resolveVariable', type: 'method', layer: 'frontend', feature: 'template-vars', fullPath: 'src/services/templates/variableResolver.ts' },
  { id: 'meth-resolve-prompt-tmpl', label: 'resolvePrompt', type: 'method', layer: 'frontend', feature: 'template-vars', fullPath: 'src/services/templates/variableResolver.ts' },
  { id: 'meth-resolve-all-vars', label: 'resolveAllVariables', type: 'method', layer: 'frontend', feature: 'template-vars', fullPath: 'src/services/templates/variableResolver.ts' },
];

// LLM Pipeline — Phase 1/2/3 BYOK: backend resolver + admin AI Settings UI
const llmFiles: BrainNode[] = [
  { id: 'file-llm-base', label: 'llm_base.py', type: 'file', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/evaluators/llm_base.py' },
  { id: 'file-llm-resolver', label: 'resolver.py', type: 'file', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/llm_credentials/resolver.py' },
  { id: 'file-llm-model-discovery', label: 'llm_model_discovery.py', type: 'file', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/llm_model_discovery.py' },
  { id: 'file-llm-assist-service', label: 'llm_assist_service.py', type: 'file', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/llm_assist_service.py' },
  { id: 'file-llm-assist-routes', label: 'routes/llm_assist.py', type: 'file', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/routes/llm_assist.py' },
  { id: 'file-ai-settings-api', label: 'aiSettingsApi.ts', type: 'file', layer: 'frontend', feature: 'llm-pipeline', fullPath: 'src/services/api/aiSettingsApi.ts' },
  { id: 'file-ai-settings-queries', label: 'aiSettingsQueries.ts', type: 'file', layer: 'frontend', feature: 'llm-pipeline', fullPath: 'src/services/api/aiSettingsQueries.ts' },
  { id: 'file-llm-assist-api', label: 'llmAssistApi.ts', type: 'file', layer: 'frontend', feature: 'llm-pipeline', fullPath: 'src/services/api/llmAssistApi.ts' },
];

const llmMethods: BrainNode[] = [
  { id: 'meth-base-llm-provider', label: 'BaseLLMProvider', type: 'method', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/evaluators/llm_base.py' },
  { id: 'meth-gemini-provider', label: 'GeminiProvider', type: 'method', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/evaluators/llm_base.py' },
  { id: 'meth-openai-provider', label: 'OpenAIProvider', type: 'method', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/evaluators/llm_base.py' },
  { id: 'meth-logging-wrapper', label: 'LoggingLLMWrapper', type: 'method', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/evaluators/llm_base.py' },
  { id: 'meth-create-llm-provider', label: 'create_llm_provider', type: 'method', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/evaluators/llm_base.py' },
  { id: 'meth-resolve-creds', label: 'resolve_llm_credentials', type: 'method', layer: 'backend', feature: 'llm-pipeline', fullPath: 'backend/app/services/llm_credentials/resolver.py' },
  { id: 'meth-use-provider-configs', label: 'useProviderConfigs', type: 'method', layer: 'frontend', feature: 'llm-pipeline', fullPath: 'src/services/api/aiSettingsQueries.ts' },
];

// Settings & Config — admin AI Settings page + tenant_llm_credentials table
const settingsFiles: BrainNode[] = [
  { id: 'file-tenant-llm-credentials', label: 'tenant_llm_credential.py (ORM)', type: 'file', layer: 'backend', feature: 'settings-config', fullPath: 'backend/app/models/tenant_llm_credential.py' },
  { id: 'file-admin-ai-settings-routes', label: 'routes/admin_ai_settings.py', type: 'file', layer: 'backend', feature: 'settings-config', fullPath: 'backend/app/routes/admin_ai_settings.py' },
  { id: 'file-admin-ai-settings-page', label: 'AdminAISettingsPage.tsx', type: 'file', layer: 'frontend', feature: 'settings-config', fullPath: 'src/features/admin/aiSettings/AdminAISettingsPage.tsx' },
  { id: 'file-job-worker', label: 'job_worker.py', type: 'file', layer: 'backend', feature: 'settings-config', fullPath: 'backend/app/services/job_worker.py' },
];

const settingsMethods: BrainNode[] = [
  { id: 'meth-resolve-llm-credentials', label: 'resolve_llm_credentials', type: 'method', layer: 'backend', feature: 'settings-config', fullPath: 'backend/app/services/llm_credentials/resolver.py' },
  { id: 'meth-encrypt-secret', label: 'encrypt_secret / decrypt_secret', type: 'method', layer: 'backend', feature: 'settings-config', fullPath: 'backend/app/services/llm_credentials/crypto.py' },
  { id: 'meth-llm-config-section', label: 'LLMConfigSection', type: 'method', layer: 'frontend', feature: 'settings-config', fullPath: 'src/components/ui/LLMConfigSection.tsx' },
  { id: 'meth-worker-loop', label: 'worker_loop', type: 'method', layer: 'backend', feature: 'settings-config', fullPath: 'backend/app/services/job_worker.py' },
  { id: 'meth-process-job', label: 'process_job', type: 'method', layer: 'backend', feature: 'settings-config', fullPath: 'backend/app/services/job_worker.py' },
  { id: 'meth-register-job-handler', label: 'register_job_handler', type: 'method', layer: 'backend', feature: 'settings-config', fullPath: 'backend/app/services/job_worker.py' },
];

// Combined nodes
export const brainMapNodes: BrainNode[] = [
  ...featureNodes,
  ...vrxFiles, ...vrxMethods,
  ...batchFiles, ...batchMethods,
  ...advFiles, ...advMethods,
  ...customFiles, ...customMethods,
  ...templateFiles, ...templateMethods,
  ...llmFiles, ...llmMethods,
  ...settingsFiles, ...settingsMethods,
];

// Build links: feature -> files, files -> methods
function buildLinks(): BrainLink[] {
  const links: BrainLink[] = [];

  function connectFeature(featureId: string, files: BrainNode[], methods: BrainNode[]) {
    files.forEach(f => links.push({ source: featureId, target: f.id }));
    methods.forEach(m => {
      const parentFile = files.find(f => f.fullPath === m.fullPath);
      if (parentFile) links.push({ source: parentFile.id, target: m.id });
    });
  }

  connectFeature('feat-voice-rx-eval', vrxFiles, vrxMethods);
  connectFeature('feat-batch-eval', batchFiles, batchMethods);
  connectFeature('feat-adversarial', advFiles, advMethods);
  connectFeature('feat-custom-evaluators', customFiles, customMethods);
  connectFeature('feat-template-vars', templateFiles, templateMethods);
  connectFeature('feat-llm-pipeline', llmFiles, llmMethods);
  connectFeature('feat-settings-config', settingsFiles, settingsMethods);

  return links;
}

export const brainMapLinks: BrainLink[] = buildLinks();

// Color mappings
export const layerColors: Record<string, { file: string; method: string }> = {
  frontend: { file: '#3b82f6', method: '#93c5fd' },
  backend: { file: '#10b981', method: '#6ee7b7' },
  shared: { file: '#8b5cf6', method: '#c4b5fd' },
};

export const featureColor = '#6366f1';

export function getNodeColor(node: BrainNode): string {
  if (node.type === 'feature') return featureColor;
  const lc = layerColors[node.layer] || layerColors.shared;
  return node.type === 'file' ? lc.file : lc.method;
}

export function getNodeStroke(node: BrainNode): string {
  if (node.type === 'feature') return '#4338ca';
  const lc = layerColors[node.layer] || layerColors.shared;
  return node.type === 'file' ? lc.file : lc.method;
}

export function getNodeRadius(node: BrainNode): number {
  if (node.type === 'feature') return 24;
  if (node.type === 'file') return 14;
  return 8;
}

export const features = [
  { id: 'all', label: 'All Features' },
  { id: 'voice-rx-eval', label: 'Voice RX Eval' },
  { id: 'batch-eval', label: 'Batch Eval' },
  { id: 'adversarial', label: 'Adversarial' },
  { id: 'custom-evaluators', label: 'Custom Evaluators' },
  { id: 'template-vars', label: 'Template Vars' },
  { id: 'llm-pipeline', label: 'LLM Pipeline' },
  { id: 'settings-config', label: 'Settings & Config' },
];

export const layers = [
  { id: 'all', label: 'All' },
  { id: 'frontend', label: 'Frontend' },
  { id: 'backend', label: 'Backend' },
  { id: 'shared', label: 'Shared' },
];
