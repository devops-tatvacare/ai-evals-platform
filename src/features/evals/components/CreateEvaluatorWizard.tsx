import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  Alert,
  Button,
  Input,
  LLMConfigSection,
  VariablePickerPopover,
  VisibilityToggle,
} from '@/components/ui';
import { cn } from '@/utils';
import { useAppConfig } from '@/hooks';
import { useAuthStore, useLLMSettingsStore } from '@/stores';
import { useEvalTemplatesStore } from '@/stores/evalTemplatesStore';
import { submitAndPollJob } from '@/services/api/jobPolling';
import { rulesRepository } from '@/services/api';
import { notificationService } from '@/services/notifications';
import { WizardOverlay, type WizardStep } from '@/features/evalRuns/components/WizardOverlay';
import { detectProvider } from '@/components/ui/ModelBadge/providers';
import { RubricBuilder } from '@/features/insideSales/components/RubricBuilder';
import { BuildModeToggle, type EvaluatorBuildMode } from './BuildModeToggle';
import { SourceModeToggle } from './SourceModeToggle';
import { TemplatePicker } from './TemplatePicker';
import { RulePicker } from './RulePicker';
import { SchemaTable } from './SchemaTable';
import { evaluatorShowsInHeader, setEvaluatorHeaderVisibility } from '@/features/evals/utils/evaluatorMetadata';
import type { SourceMode } from './SourceModeToggle';
import type { EvalTemplate } from '@/types';
import type {
  EvaluatorContext,
  EvaluatorDefinition,
  EvaluatorOutputField,
  Listing,
  RuleCatalogEntry,
  VariableInfo,
} from '@/types';

interface DraftResult {
  outputFields?: EvaluatorOutputField[];
  matchedRuleIds?: string[];
  warnings?: string[];
}

interface CreateEvaluatorWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (evaluator: EvaluatorDefinition) => Promise<void> | void;
  context: EvaluatorContext;
  editEvaluator?: EvaluatorDefinition;
  listing?: Listing;
}

function normalizeDraftFields(fields: EvaluatorOutputField[]): EvaluatorOutputField[] {
  return fields.map((field) => {
    const role = field.role ?? (field.isMainMetric ? 'metric' : 'detail');
    return {
      ...field,
      role,
      displayMode: field.isMainMetric ? 'header' : role === 'reasoning' ? 'hidden' : 'card',
    };
  });
}

function inferBuildMode(
  evaluator: EvaluatorDefinition | undefined,
  allowRubric: boolean,
): EvaluatorBuildMode {
  if (!allowRubric) {
    return 'prompt';
  }
  if (!evaluator) {
    return 'rubric';
  }

  const hasOverallScore = evaluator.outputSchema.some(
    (field) => field.key === 'overall_score' && field.isMainMetric,
  );
  const hasReasoningField = evaluator.outputSchema.some(
    (field) => (field.role ?? 'detail') === 'reasoning',
  );

  return hasOverallScore && hasReasoningField ? 'rubric' : 'prompt';
}

function mapStaticVariables(
  variables: Array<{
    key: string;
    displayName: string;
    description: string;
    category: string;
  }>,
): VariableInfo[] {
  return variables.map((variable) => ({
    ...variable,
    valueType: 'string',
    requiresAudio: false,
    requiresEvalOutput: false,
    sourceTypes: null,
    example: '',
  }));
}

export function CreateEvaluatorWizard({
  isOpen,
  onClose,
  onSave,
  context,
  editEvaluator,
  listing,
}: CreateEvaluatorWizardProps) {
  const appConfig = useAppConfig(context.appId);
  const llmProvider = useLLMSettingsStore((s) => s.provider);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [fields, setFields] = useState<EvaluatorOutputField[]>([]);
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private');
  const [showInHeader, setShowInHeader] = useState(false);
  const [provider, setProvider] = useState(llmProvider);
  const [modelId, setModelId] = useState('');
  const [linkedRuleIds, setLinkedRuleIds] = useState<string[]>([]);
  const [buildMode, setBuildMode] = useState<EvaluatorBuildMode>('prompt');
  const [rules, setRules] = useState<RuleCatalogEntry[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);

  // Template state
  const [sourceMode, setSourceMode] = useState<SourceMode>(
    editEvaluator?.templateId ? 'template' : 'custom'
  );
  const [selectedTemplate, setSelectedTemplate] = useState<EvalTemplate | null>(null);
  const [promptSnapshot, setPromptSnapshot] = useState<string>('');
  const [schemaSnapshot, setSchemaSnapshot] = useState<string>('');
  const [isTemplateDirty, setIsTemplateDirty] = useState(false);

  // Template store
  const evalTemplates = useEvalTemplatesStore((s) => s.templates[context.appId] ?? []);
  const loadTemplates = useEvalTemplatesStore((s) => s.loadTemplates);
  const createNewVersion = useEvalTemplatesStore((s) => s.createNewVersion);
  const forkTemplate = useEvalTemplatesStore((s) => s.forkTemplate);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setCurrentStep(0);
    setName(editEvaluator?.name ?? '');
    setPrompt(editEvaluator?.prompt ?? '');
    setFields(normalizeDraftFields(editEvaluator?.outputSchema ?? []));
    setVisibility(editEvaluator?.visibility ?? appConfig.evaluator.defaultVisibility);
    setShowInHeader(editEvaluator ? evaluatorShowsInHeader(editEvaluator) : false);
    const initialModel = editEvaluator?.modelId ?? appConfig.evaluator.defaultModel;
    setModelId(initialModel);
    const detected = initialModel ? detectProvider(initialModel) : null;
    setProvider(detected && detected !== 'unknown' ? detected : llmProvider);
    setLinkedRuleIds(editEvaluator?.linkedRuleIds ?? []);
    setBuildMode(inferBuildMode(editEvaluator, appConfig.features.hasRubricMode));
    setSourceMode(editEvaluator?.templateId ? 'template' : 'custom');
    setSelectedTemplate(null);
    setPromptSnapshot('');
    setSchemaSnapshot('');
    setIsTemplateDirty(false);
  }, [
    appConfig.evaluator.defaultModel,
    appConfig.evaluator.defaultVisibility,
    appConfig.features.hasRubricMode,
    editEvaluator,
    isOpen,
    llmProvider,
  ]);

  useEffect(() => {
    if (!isOpen) {
      setRulesLoaded(false);
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !appConfig.features.hasRules || rulesLoaded) {
      return;
    }

    let cancelled = false;
    rulesRepository.get(context.appId)
      .then((response) => {
        if (!cancelled) {
          setRules(response.rules);
          setRulesLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRulesLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appConfig.features.hasRules, context.appId, isOpen, rulesLoaded]);

  // Load templates when wizard opens
  useEffect(() => {
    if (isOpen) {
      loadTemplates(context.appId);
    }
  }, [context.appId, isOpen, loadTemplates]);

  // Template selection handler
  const handleTemplateSelect = (template: EvalTemplate | null) => {
    setSelectedTemplate(template);
    if (template && template.schemaFormat === 'output_fields' && Array.isArray(template.schemaData)) {
      setPrompt(template.prompt);
      setPromptSnapshot(template.prompt);
      setFields(normalizeDraftFields(template.schemaData as EvaluatorOutputField[]));
      setSchemaSnapshot(JSON.stringify(template.schemaData));
      setIsTemplateDirty(false);
    }
  };

  // Dirty detection for template mode
  useEffect(() => {
    if (sourceMode !== 'template' || !selectedTemplate) return;
    const promptDirty = prompt !== promptSnapshot;
    const schemaDirty = JSON.stringify(fields) !== schemaSnapshot;
    setIsTemplateDirty(promptDirty || schemaDirty);
  }, [prompt, fields, promptSnapshot, schemaSnapshot, sourceMode, selectedTemplate]);

  // Save edits as a new template version
  const handleSaveAsNewVersion = async () => {
    if (!selectedTemplate) return;
    try {
      const newVersion = await createNewVersion(context.appId, selectedTemplate.id, {
        prompt,
        schemaData: fields,
        schemaFormat: 'output_fields',
      });
      setSelectedTemplate(newVersion);
      setPromptSnapshot(newVersion.prompt);
      setSchemaSnapshot(JSON.stringify(newVersion.schemaData));
      setIsTemplateDirty(false);
      notificationService.success(`Saved as v${newVersion.version}`);
    } catch {
      notificationService.error('Failed to save new template version');
    }
  };

  // Fork a template from another user
  const handleForkTemplate = async () => {
    if (!selectedTemplate) return;
    try {
      const forked = await forkTemplate(context.appId, selectedTemplate.id);
      setSelectedTemplate(forked);
      setPromptSnapshot(forked.prompt);
      setSchemaSnapshot(JSON.stringify(forked.schemaData));
      setIsTemplateDirty(false);
      notificationService.success(`Forked as "${forked.name}" v${forked.version}`);
    } catch {
      notificationService.error('Failed to fork template');
    }
  };

  const steps = useMemo<WizardStep[]>(() => {
    const base: WizardStep[] = [
      { key: 'setup', label: 'Setup' },
      { key: 'prompt', label: 'Prompt' },
      { key: 'schema', label: 'Schema' },
    ];
    if (appConfig.features.hasRules) {
      base.push({ key: 'rules', label: 'Rules' });
    }
    return base;
  }, [appConfig.features.hasRules]);
  const staticVariables = useMemo(
    () => mapStaticVariables(appConfig.evaluator.variables),
    [appConfig.evaluator.variables],
  );

  const canGoNext = useMemo(() => {
    if (steps[currentStep]?.key === 'setup') {
      return name.trim().length > 0;
    }
    if (steps[currentStep]?.key === 'prompt') {
      if (buildMode === 'rubric') return true;
      if (sourceMode === 'template' && selectedTemplate) return true;
      return prompt.trim().length > 0;
    }
    if (steps[currentStep]?.key === 'schema') {
      if (sourceMode === 'template' && selectedTemplate) return true;
      return fields.length > 0;
    }
    return true;
  }, [buildMode, currentStep, fields.length, name, prompt, steps]);

  const handleGenerateDraft = async () => {
    if (!prompt.trim()) {
      notificationService.warning('Enter a prompt before generating a draft.');
      return;
    }
    setIsDrafting(true);
    try {
      const job = await submitAndPollJob('generate-evaluator-draft', {
        prompt,
        app_id: context.appId,
      });

      if (job.status !== 'completed' || !job.result) {
        throw new Error(job.errorMessage || 'Draft generation failed');
      }

      const result = job.result as DraftResult;
      if (result.outputFields?.length) {
        setFields(normalizeDraftFields(result.outputFields));
      }
      if (result.matchedRuleIds?.length) {
        setLinkedRuleIds(result.matchedRuleIds);
      }
      if (result.warnings?.length) {
        notificationService.warning(result.warnings.join(' '), 'Draft warnings');
      } else {
        notificationService.success('Evaluator draft generated');
      }
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : 'Failed to generate evaluator draft',
      );
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const normalizedFields = normalizeDraftFields(fields);
      const isTemplateMode = sourceMode === 'template' && selectedTemplate;
      await onSave({
        id: editEvaluator?.id ?? '',
        appId: context.appId,
        listingId: editEvaluator?.listingId ?? context.entityId,
        name,
        prompt: isTemplateMode ? '' : prompt,
        modelId,
        outputSchema: isTemplateMode
          ? []
          : setEvaluatorHeaderVisibility(normalizedFields, showInHeader),
        visibility,
        linkedRuleIds,
        templateId: isTemplateMode ? selectedTemplate.id : null,
        templateBranchKey: isTemplateMode ? selectedTemplate.branchKey : null,
        forkedFrom: editEvaluator?.forkedFrom,
        createdAt: editEvaluator?.createdAt ?? new Date(),
        updatedAt: new Date(),
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  const activeStep = steps[currentStep]?.key;

  return (
    <WizardOverlay
      title={editEvaluator ? 'Edit Evaluator' : 'Create Evaluator'}
      steps={steps}
      currentStep={currentStep}
      onClose={onClose}
      onBack={() => setCurrentStep((step) => Math.max(step - 1, 0))}
      onNext={() => setCurrentStep((step) => Math.min(step + 1, steps.length - 1))}
      canGoNext={canGoNext}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      submitLabel={editEvaluator ? 'Save Evaluator' : 'Create Evaluator'}
      isDirty
    >
      {activeStep === 'setup' ? (
        <div className="space-y-6">
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Evaluator Basics</h3>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Set ownership and authoring mode before defining the evaluator contract.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Safety Escalation Check"
              />
            </div>
          </section>

          <fieldset className="flex flex-col items-start gap-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Visibility</legend>
            <VisibilityToggle value={visibility} onChange={setVisibility} />
          </fieldset>

          {appConfig.features.hasRubricMode ? (
            <fieldset className="flex flex-col items-start gap-2">
              <legend className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Build Mode</legend>
              <BuildModeToggle
                value={buildMode}
                onChange={setBuildMode}
                allowRubric={appConfig.features.hasRubricMode}
              />
            </fieldset>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Header Metric</legend>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={showInHeader}
                onChange={(e) => setShowInHeader(e.target.checked)}
                className="peer sr-only"
              />
              <span className={cn(
                'relative h-5 w-9 shrink-0 rounded-full transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:shadow after:transition-transform',
                'bg-[var(--border-default)] peer-checked:bg-[var(--interactive-primary)] peer-checked:after:translate-x-3.5',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--interactive-primary)]/50',
              )} />
              <span className="text-xs text-[var(--text-secondary)]">
                Show the main evaluator metric in the page header after runs complete.
              </span>
            </label>
          </fieldset>
        </div>
      ) : null}

      {activeStep === 'prompt' ? (
        <div className="space-y-4">
          <LLMConfigSection
            provider={provider}
            onProviderChange={(p) => {
              setProvider(p);
              setModelId('');
            }}
            model={modelId}
            onModelChange={setModelId}
          />

          {buildMode === 'rubric' ? (
            <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)]/40 p-4 text-sm text-[var(--text-secondary)]">
              Rubric mode generates and maintains the prompt from the rubric definition.
            </div>
          ) : (
            <>
              <SourceModeToggle value={sourceMode} onChange={setSourceMode} />

              {sourceMode === 'template' && (
                <div className="space-y-3">
                  <TemplatePicker
                    templates={evalTemplates}
                    selectedId={selectedTemplate?.id ?? null}
                    onChange={handleTemplateSelect}
                    currentUserId={currentUserId}
                  />

                  {selectedTemplate && !isTemplateDirty && (
                    <Alert variant="info">
                      This prompt comes from the template. Edit below to create a new version.
                    </Alert>
                  )}

                  {selectedTemplate && isTemplateDirty && (
                    <Alert variant="warning">
                      <div className="flex items-center justify-between gap-3">
                        <span>You have unsaved changes to this template.</span>
                        {selectedTemplate.userId === currentUserId ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleSaveAsNewVersion}
                          >
                            {`Save as v${selectedTemplate.version + 1}`}
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleForkTemplate}
                          >
                            Fork & Save
                          </Button>
                        )}
                      </div>
                    </Alert>
                  )}

                  {selectedTemplate && selectedTemplate.userId !== currentUserId && !isTemplateDirty && (
                    <Alert variant="info">
                      This template belongs to another user. Editing will fork it into your own copy.
                    </Alert>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Prompt</label>
                  <VariablePickerPopover
                    listing={listing}
                    appId={context.appId}
                    staticVariables={staticVariables}
                    onInsert={(variable) => setPrompt((value) => `${value}${variable}`)}
                  />
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="h-72 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 font-mono text-xs text-[var(--text-primary)]"
                  placeholder="Write the evaluator prompt here..."
                />
              </div>

              {sourceMode === 'custom' && (
                <Button variant="secondary" onClick={handleGenerateDraft} isLoading={isDrafting} icon={Sparkles}>
                  Generate Draft
                </Button>
              )}
            </>
          )}
        </div>
      ) : null}

      {activeStep === 'schema' ? (
        buildMode === 'rubric' ? (
          <RubricBuilder
            outputFields={fields}
            onFieldsChange={setFields}
            onPromptGenerated={setPrompt}
          />
        ) : (
          <div className="space-y-4">
            {sourceMode === 'template' && selectedTemplate && (
              <>
                {!isTemplateDirty && (
                  <Alert variant="info">
                    {`Schema from template "${selectedTemplate.name}" v${selectedTemplate.version}. Edit any field to create a new version.`}
                  </Alert>
                )}
                {isTemplateDirty && (
                  <Alert variant="warning">
                    <div className="flex items-center justify-between gap-3">
                      <span>Schema has been modified from the template.</span>
                      {selectedTemplate.userId === currentUserId ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleSaveAsNewVersion}
                        >
                          {`Save as v${selectedTemplate.version + 1}`}
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleForkTemplate}
                        >
                          Fork & Save
                        </Button>
                      )}
                    </div>
                  </Alert>
                )}
              </>
            )}
            <SchemaTable fields={fields} onChange={setFields} />
          </div>
        )
      ) : null}

      {activeStep === 'rules' ? (
        <RulePicker
          rules={rules}
          selectedRuleIds={linkedRuleIds}
          onChange={setLinkedRuleIds}
        />
      ) : null}
    </WizardOverlay>
  );
}
