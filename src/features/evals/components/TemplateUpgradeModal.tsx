import { useEffect, useState } from 'react';
import type { EvaluatorDefinition, EvaluatorOutputField, EvalTemplate, EvalTemplateOutputField } from '@/types';
import type { AppId } from '@/types/app.types';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { PromptDiff } from './PromptDiff';
import { SchemaDiff } from './SchemaDiff';
import { useEvalTemplatesStore } from '@/stores/evalTemplatesStore';

interface TemplateUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  evaluator: EvaluatorDefinition;
  appId: AppId;
  onUpgrade: (evaluatorId: string, newTemplateId: string, newBranchKey: string) => void;
}

function toOutputFields(schemaData: EvalTemplate['schemaData']): EvaluatorOutputField[] {
  if (Array.isArray(schemaData)) {
    return schemaData as EvalTemplateOutputField[];
  }
  return [];
}

export function TemplateUpgradeModal({
  isOpen,
  onClose,
  evaluator,
  appId,
  onUpgrade,
}: TemplateUpgradeModalProps) {
  const getBranchVersions = useEvalTemplatesStore((s) => s.getBranchVersions);
  const [versions, setVersions] = useState<EvalTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !evaluator.templateBranchKey) return;
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const v = await getBranchVersions(appId, evaluator.templateBranchKey!);
        if (!cancelled) {
          setVersions([...v].sort((a, b) => b.version - a.version));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();

    return () => { cancelled = true; };
  }, [isOpen, evaluator.templateBranchKey, appId, getBranchVersions]);

  const current = versions.find((v) => v.id === evaluator.templateId) ?? null;
  const latest = versions[0] ?? null;

  const currentVersion = current?.version ?? null;
  const latestVersion = latest?.version ?? null;
  const isUpToDate = current && latest && current.id === latest.id;

  const oldPrompt = current?.prompt ?? evaluator.prompt;
  const newPrompt = latest?.prompt ?? evaluator.prompt;
  const oldFields = current ? toOutputFields(current.schemaData) : evaluator.outputSchema;
  const newFields = latest ? toOutputFields(latest.schemaData) : evaluator.outputSchema;

  const tabs = [
    {
      id: 'prompt',
      label: 'Prompt Diff',
      content: (
        <PromptDiff
          oldText={oldPrompt}
          newText={newPrompt}
          oldLabel={currentVersion ? `Current (v${currentVersion})` : 'Current'}
          newLabel={latestVersion ? `Latest (v${latestVersion})` : 'Latest'}
        />
      ),
    },
    {
      id: 'schema',
      label: 'Schema Diff',
      content: <SchemaDiff oldFields={oldFields} newFields={newFields} />,
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Template Upgrade Available"
      className="max-w-4xl"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-[13px] text-[var(--text-muted)]">
          Loading version history…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-[var(--text-secondary)]">
            A new version of the template{' '}
            <span className="font-medium text-[var(--text-primary)]">{current?.name ?? 'this template'}</span>
            {' '}is available.{' '}
            {currentVersion && latestVersion && (
              <>
                You are on <span className="font-medium">v{currentVersion}</span>;
                the latest is <span className="font-medium">v{latestVersion}</span>.
              </>
            )}
          </p>

          <Tabs tabs={tabs} defaultTab="prompt" />

          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
            <p className="text-[12px] text-[var(--text-muted)]">
              Your existing eval run results will not be affected by upgrading.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                onClick={onClose}
              >
                Stay on v{currentVersion ?? '?'}
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={!latest || !!isUpToDate}
                onClick={() => {
                  if (latest) {
                    onUpgrade(evaluator.id, latest.id, latest.branchKey);
                    onClose();
                  }
                }}
              >
                Upgrade to v{latestVersion ?? '?'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
