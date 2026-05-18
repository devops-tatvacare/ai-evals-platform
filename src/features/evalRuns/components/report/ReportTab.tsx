import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Ban, Clock, Download, FileBarChart, Loader2, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { Button, EmptyState, LegacyLlmConfigCompat, Select, Tooltip, type SelectOption } from '@/components/ui';
import { SettingsSlideOver } from '@/features/settings/components/SettingsSlideOver';
import { ManageBlueprintsSlideOver } from './ManageBlueprintsSlideOver';
import { formatPdfExportError } from './pdfExportError';
import { pollJobUntilComplete, submitAndPollJob, type JobProgress } from '@/services/api/jobPolling';
import { jobsApi } from '@/services/api/jobsApi';
import { reportsApi } from '@/services/api/reportsApi';
import { notificationService } from '@/services/notifications';
import { useProviderConfigs } from '@/services/api/aiSettingsQueries';
import {
  invalidateReportConfigs,
  invalidateReportRuns,
  useReportConfigs,
  useReportRunArtifact,
  useReportRuns,
} from '@/features/reports/queries/reportsQueries';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import type { AppId, ReportConfigSummary, ReportRunSummary } from '@/types';
import { usePermission } from '@/utils/permissions';
import { useChatWidgetStore } from '@/features/chat-widget/useChatWidget';

interface ReportMetadataLike {
  llmProvider?: string | null;
  llmModel?: string | null;
}

interface ReportPayloadLike {
  metadata?: ReportMetadataLike | null;
}

interface Props<TReport> {
  appId: AppId;
  runId: string;
  /** Eval run display name — accepted for API compatibility; the page header already
   *  shows it, so the hero no longer renders it (dedup pass 2026-05-19). */
  runName?: string | null;
  /** Optional list of section titles the configured blueprint will emit, used
   *  by the hero to preview the report shape from contract. */
  sectionsPreview?: SectionPreview[];
  supportsPdf?: boolean;
  renderReport: (report: TReport, actions: ReactNode) => ReactNode;
}

type Status = 'loading' | 'idle' | 'generating' | 'ready' | 'error';

interface ReportVariantTheme {
  accent: string;
  accentMuted: string;
}

const REPORT_VARIANT_THEMES: Record<string, ReportVariantTheme> = {
  'kaira-run-v1': { accent: 'var(--color-accent-teal)', accentMuted: 'var(--surface-success)' },
  'inside-sales-run-v1': { accent: 'var(--color-accent-purple)', accentMuted: 'var(--surface-brand-subtle)' },
  'voice-rx-run-v1': { accent: 'var(--color-error)', accentMuted: 'var(--surface-error)' },
};

function getReportMetadata<TReport extends ReportPayloadLike>(report: TReport | null): ReportMetadataLike | null {
  return report?.metadata ?? null;
}

function formatRunLabel(run: ReportRunSummary): string {
  const timestamp = run.completedAt ?? run.createdAt;
  return new Date(timestamp).toLocaleString();
}

function getDocumentVariant(config: ReportConfigSummary | null): string | null {
  const exportConfig = config?.exportConfig;
  if (!exportConfig || typeof exportConfig !== 'object') return null;

  const variant = (exportConfig as Record<string, unknown>).documentVariant;
  return typeof variant === 'string' ? variant : null;
}

function getVariantTheme(config: ReportConfigSummary | null): ReportVariantTheme {
  const variant = getDocumentVariant(config);
  return variant ? REPORT_VARIANT_THEMES[variant] ?? {
    accent: 'var(--color-brand-accent)',
    accentMuted: 'rgba(255,255,255,0.16)',
  } : {
    accent: 'var(--color-brand-accent)',
    accentMuted: 'rgba(255,255,255,0.16)',
  };
}

interface SectionPreview {
  id: string;
  title: string;
}

function ReportZeroState({
  config,
  sectionsPreview,
  canGenerate,
  actionLabel,
  onGenerate,
  progressContent,
  errorMessage,
}: {
  config: ReportConfigSummary | null;
  sectionsPreview?: SectionPreview[];
  canGenerate: boolean;
  actionLabel: string;
  onGenerate: () => void;
  progressContent?: ReactNode;
  errorMessage?: string | null;
}) {
  const theme = getVariantTheme(config);
  const heroStyle: CSSProperties = {
    background: `linear-gradient(135deg, ${theme.accent} 0%, color-mix(in srgb, ${theme.accent} 55%, var(--color-neutral-900)) 100%)`,
  };
  const chipStyle: CSSProperties = {
    backgroundColor: theme.accentMuted,
    color: theme.accent,
  };

  // Page header already names the run; this hero shows blueprint identity + section
  // chips so the page reads as one calm scroll instead of three repeats.
  const blueprintLabel = config?.name?.trim() || 'Run report';
  const sections = sectionsPreview ?? [];

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
      <div className="px-7 py-7 text-white md:px-9 md:py-8" style={heroStyle}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
          <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">{blueprintLabel}</span>
        </div>
        {errorMessage ? (
          <p className="mt-4 max-w-3xl text-sm leading-6 text-white/82 md:text-[15px]">{errorMessage}</p>
        ) : null}
        <div className="mt-6">
          {progressContent ? (
            progressContent
          ) : canGenerate ? (
            <Button size="md" onClick={onGenerate}>
              <Sparkles className="h-4 w-4" />
              {actionLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-6 py-4">
          {sections.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={chipStyle}
            >
              {s.title}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function ReportTab<TReport extends ReportPayloadLike>({
  appId,
  runId,
  sectionsPreview,
  supportsPdf = true,
  renderReport,
}: Props<TReport>) {
  // Server data lives in TQ; selection + mutation flow stay local.
  const queryClient = useQueryClient();
  const configsQuery = useReportConfigs(appId, 'single_run');
  const configs = useMemo(() => configsQuery.data ?? [], [configsQuery.data]);

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedReportRunId, setSelectedReportRunId] = useState<string | null>(null);

  // Default selectedReportId once configs land (or change) — pick the default,
  // else the first row, else nothing.
  useEffect(() => {
    if (!configs.length) {
      setSelectedReportId(null);
      return;
    }
    setSelectedReportId((current) => {
      if (current && configs.some((c) => c.reportId === current)) return current;
      return configs.find((c) => c.isDefault)?.reportId ?? configs[0]?.reportId ?? null;
    });
  }, [configs]);

  const runsQuery = useReportRuns({
    appId,
    scope: 'single_run',
    sourceEvalRunId: runId,
    reportId: selectedReportId,
    limit: 20,
  });
  const reportRuns = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);

  // Default selectedReportRunId when reportRuns change — prefer the most recent
  // completed run, fall back to whatever's first in the list.
  useEffect(() => {
    setSelectedReportRunId((current) => {
      if (current && reportRuns.some((r) => r.id === current)) return current;
      return (
        reportRuns.find((r) => r.status === 'completed')?.id ?? reportRuns[0]?.id ?? null
      );
    });
  }, [reportRuns]);

  const artifactQuery = useReportRunArtifact(selectedReportRunId);
  const report = (artifactQuery.data ?? null) as TReport | null;

  // Mutation-driven state — TQ doesn't model the job-poll lifecycle, so the
  // generate/export flow keeps its own status + error + progress trio.
  const [mutationStatus, setMutationStatus] = useState<'idle' | 'generating' | 'error'>('idle');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showGenerateOverlay, setShowGenerateOverlay] = useState(false);
  const [overlayReportId, setOverlayReportId] = useState<string | null>(null);
  const [showManageBlueprints, setShowManageBlueprints] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [jobPhase, setJobPhase] = useState<'queued' | 'running' | null>(null);
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);
  const [cancellingGeneration, setCancellingGeneration] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  const [reportProvider, setReportProvider] = useState<LLMProvider | ''>('');
  const [reportModel, setReportModel] = useState('');

  const canGenerate = usePermission('report:generate');
  const canExport = usePermission('evaluation:export');

  // Server-resolved BYOK: a run is ready to submit once the user has picked
  // a provider+model from the admin-configured catalogue.
  const { data: providerConfigs = [] } = useProviderConfigs();
  const credentialsReady = useMemo(
    () =>
      Boolean(reportProvider) &&
      providerConfigs.some(
        (c) =>
          c.provider === reportProvider &&
          c.isEnabled &&
          c.validationStatus === 'ok',
      ),
    [providerConfigs, reportProvider],
  );

  const selectedConfig = useMemo(
    () => configs.find((config) => config.reportId === selectedReportId) ?? null,
    [configs, selectedReportId],
  );
  const reportConfigOptions = useMemo<SelectOption[]>(
    () => configs.map((config) => ({
      value: config.reportId,
      label: config.isDefault ? `${config.name} (Default)` : config.name,
    })),
    [configs],
  );
  const overlayConfig = useMemo(
    () => configs.find((config) => config.reportId === overlayReportId) ?? null,
    [configs, overlayReportId],
  );
  const overlayConfigSectionCount = useMemo(() => {
    const sections = (overlayConfig?.presentationConfig as { sections?: unknown[] } | undefined)?.sections;
    return Array.isArray(sections) ? sections.length : 0;
  }, [overlayConfig]);
  const openGenerateOverlay = useCallback(() => {
    setOverlayReportId(selectedReportId);
    setShowGenerateOverlay(true);
  }, [selectedReportId]);
  const selectedReportRun = useMemo(
    () => reportRuns.find((reportRun) => reportRun.id === selectedReportRunId) ?? null,
    [reportRuns, selectedReportRunId],
  );

  // Mirror provider/model dropdowns to whatever the loaded report was generated
  // with. Runs each time the artifact query produces a new payload.
  useEffect(() => {
    const metadata = getReportMetadata(report);
    if (metadata?.llmProvider) setReportProvider(metadata.llmProvider as LLMProvider);
    if (metadata?.llmModel) setReportModel(metadata.llmModel);
  }, [report]);

  const handleJobProgress = useCallback((progress: JobProgress & { queuePosition?: number | null; status?: string }) => {
    const maybeStatus = progress.status;
    if (maybeStatus === 'queued') {
      setJobPhase('queued');
      setQueuePosition(progress.queuePosition ?? null);
      setProgressMsg('');
      return;
    }
    setJobPhase('running');
    setQueuePosition(null);
    setProgressMsg(progress.message || '');
  }, []);

  const pollExistingJob = useCallback(async (reportRun: ReportRunSummary) => {
    if (!reportRun.jobId) return;

    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setMutationStatus('generating');

    try {
      await pollJobUntilComplete(reportRun.jobId, {
        pollIntervalMs: 2000,
        signal: controller.signal,
        onProgress: (progress) => {
          handleJobProgress(progress);
        },
      });

      // Refresh the runs list so the just-completed row appears; selectedReportRunId
      // remains pinned so the artifact query refetches automatically.
      await invalidateReportRuns(queryClient, {
        appId,
        scope: 'single_run',
        sourceEvalRunId: runId,
      });
      setMutationStatus('idle');
    } catch (jobError) {
      if (jobError instanceof DOMException && jobError.name === 'AbortError') return;
      const message = jobError instanceof Error ? jobError.message : 'Report generation failed';
      setMutationError(message);
      setMutationStatus('error');
    } finally {
      setProgressMsg('');
      setQueuePosition(null);
      setJobPhase(null);
    }
  }, [appId, handleJobProgress, queryClient, runId]);

  // Resume polling for an in-flight job when the user lands back on this tab
  // mid-generation. TQ owns the artifact + runs caches; we just kick the poll.
  useEffect(() => {
    if (!selectedReportRun) return;
    if (
      (selectedReportRun.status === 'queued' || selectedReportRun.status === 'running') &&
      selectedReportRun.jobId
    ) {
      void pollExistingJob(selectedReportRun);
    }
  }, [pollExistingJob, selectedReportRun]);

  // Abort any in-flight poll on unmount.
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  // Derive the Status union the render block consumes. Queue / running runs
  // count as 'generating' even when no mutation is in flight (eg. landing back
  // on a tab with an in-progress job). Mutation status wins over query state
  // because the user is actively driving generation.
  const status: Status = useMemo(() => {
    if (mutationStatus === 'generating') return 'generating';
    if (mutationStatus === 'error') return 'error';
    if (configsQuery.isError) return 'error';
    if (configsQuery.isLoading) return 'loading';
    if (configs.length === 0) return 'idle';
    if (selectedReportId && runsQuery.isLoading && !runsQuery.data) return 'loading';
    if (runsQuery.isError) return 'error';
    const run = selectedReportRun;
    if (!run) return 'idle';
    if (run.status === 'failed' || run.status === 'cancelled') return 'error';
    if (run.status === 'queued' || run.status === 'running') return 'generating';
    if (artifactQuery.isLoading && !artifactQuery.data) return 'loading';
    if (artifactQuery.isError) return 'error';
    if (artifactQuery.data) return 'ready';
    return 'idle';
  }, [
    artifactQuery.data,
    artifactQuery.isError,
    artifactQuery.isLoading,
    configs.length,
    configsQuery.isError,
    configsQuery.isLoading,
    mutationStatus,
    runsQuery.data,
    runsQuery.isError,
    runsQuery.isLoading,
    selectedReportId,
    selectedReportRun,
  ]);

  const error: string | null = useMemo(() => {
    if (mutationError) return mutationError;
    if (configsQuery.error) {
      return configsQuery.error instanceof Error
        ? configsQuery.error.message
        : 'Failed to load report configs';
    }
    if (runsQuery.error) {
      return runsQuery.error instanceof Error
        ? runsQuery.error.message
        : 'Failed to load report runs';
    }
    if (artifactQuery.error) {
      return artifactQuery.error instanceof Error
        ? artifactQuery.error.message
        : 'Failed to load report';
    }
    if (selectedReportRun?.status === 'failed' || selectedReportRun?.status === 'cancelled') {
      return 'Report generation failed. Click Generate to retry.';
    }
    return null;
  }, [
    artifactQuery.error,
    configsQuery.error,
    mutationError,
    runsQuery.error,
    selectedReportRun,
  ]);

  const handleGenerate = useCallback(async () => {
    if (!overlayConfig) return;
    const targetReportId = overlayConfig.reportId;

    setShowGenerateOverlay(false);
    setSelectedReportId(targetReportId);
    setMutationStatus('generating');
    setMutationError(null);
    setProgressMsg('Submitting report job…');

    try {
      const completedJob = await submitAndPollJob(
        'generate-report',
        {
          run_id: runId,
          app_id: appId,
          report_id: targetReportId,
          provider: reportProvider,
          model: reportModel || undefined,
        },
        {
          pollIntervalMs: 2000,
          onProgress: (progress) => {
            handleJobProgress(progress);
          },
          onJobCreated: (jobId) => {
            setGeneratingJobId(jobId);
          },
        },
      );

      if (completedJob.status !== 'completed') {
        throw new Error(completedJob.errorMessage || 'Report generation failed');
      }

      const jobResult = (completedJob.result ?? {}) as Record<string, unknown>;
      const generatedReportRunId = typeof jobResult.report_run_id === 'string'
        ? jobResult.report_run_id
        : typeof jobResult.reportRunId === 'string'
          ? jobResult.reportRunId
          : null;

      // TQ-driven refresh: invalidate the runs query so the new row appears,
      // then pin selection to the just-generated run — the artifact query
      // refetches automatically on the key change.
      await invalidateReportRuns(queryClient, {
        appId,
        scope: 'single_run',
        sourceEvalRunId: runId,
      });
      if (generatedReportRunId) setSelectedReportRunId(generatedReportRunId);

      setMutationStatus('idle');
      notificationService.success('Report generated');
    } catch (generateError) {
      const message = generateError instanceof Error ? generateError.message : 'Report generation failed';
      setMutationError(message);
      setMutationStatus('error');
      notificationService.error(message);
    } finally {
      setProgressMsg('');
      setQueuePosition(null);
      setJobPhase(null);
      setGeneratingJobId(null);
      setCancellingGeneration(false);
    }
  }, [
    appId,
    handleJobProgress,
    overlayConfig,
    queryClient,
    reportModel,
    reportProvider,
    runId,
  ]);

  const handleCancelGeneration = useCallback(async () => {
    if (!generatingJobId || cancellingGeneration) return;
    setCancellingGeneration(true);
    try {
      await jobsApi.cancel(generatingJobId);
      pollAbortRef.current?.abort();
      notificationService.info('Report generation cancelled');
    } catch (cancelError) {
      const msg = cancelError instanceof Error ? cancelError.message : 'Failed to cancel generation';
      notificationService.error(msg);
      setCancellingGeneration(false);
    }
  }, [cancellingGeneration, generatingJobId]);

  const handleExportPdf = useCallback(async () => {
    if (!selectedReportRun || exporting) return;

    setExporting(true);
    try {
      const blob = await reportsApi.exportReportRunPdf(selectedReportRun.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `eval-report-${selectedReportRun.id.slice(0, 8)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      notificationService.success('PDF exported');
    } catch (exportError) {
      const { title, message } = formatPdfExportError(exportError);
      notificationService.error(message, title);
    } finally {
      setExporting(false);
    }
  }, [exporting, selectedReportRun]);

  const inProgressCard = (
    <div className="rounded-lg border border-white/15 bg-white/10 px-6 py-5 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {jobPhase === 'queued' ? (
          <Clock className="h-5 w-5 text-white/75" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-white" />
        )}
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">
            {jobPhase === 'queued' ? 'Queued for generation' : 'Generating report'}
          </p>
          <p className="mt-1 text-sm text-white/78">
            {jobPhase === 'queued'
              ? queuePosition != null && queuePosition > 0
                ? `${queuePosition} job${queuePosition > 1 ? 's' : ''} ahead`
                : 'Next in queue'
              : progressMsg || 'Composing the report and AI narrative.'}
          </p>
        </div>
        {generatingJobId && canGenerate ? (
          <button
            type="button"
            onClick={() => void handleCancelGeneration()}
            disabled={cancellingGeneration}
            aria-label={cancellingGeneration ? 'Cancelling generation' : 'Stop generation'}
            title={cancellingGeneration ? 'Cancelling…' : 'Stop generation'}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
          >
            {cancellingGeneration ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
            {cancellingGeneration ? 'Cancelling…' : 'Stop'}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (status === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (status === 'error' && !selectedConfig) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="Report loading failed"
        description={error ?? 'Unable to load reporting surfaces.'}
        compact
      />
    );
  }

  if (configs.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No report config available"
        description="Add a single-run report config before generating reports for this run."
        compact
      />
    );
  }

  const hasReportRuns = reportRuns.length > 0;
  const canOpenGenerateOverlay = canGenerate && configs.length > 0;
  const reportActionLabel = hasReportRuns ? 'Refresh' : 'Generate report';
  const reportRunOptions: SelectOption[] = reportRuns.map((reportRun) => ({
    value: reportRun.id,
    label: formatRunLabel(reportRun),
  }));

  const reportActionButtons = (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {supportsPdf && canExport && selectedReportRun?.status === 'completed' ? (
          <Tooltip content={exporting ? 'Exporting PDF…' : 'Export PDF'}>
            <Button
              size="sm"
              variant="secondary"
              iconOnly
              icon={exporting ? Loader2 : Download}
              onClick={() => void handleExportPdf()}
              disabled={exporting}
              title={exporting ? 'Exporting PDF…' : 'Export PDF'}
              aria-label={exporting ? 'Exporting PDF' : 'Export PDF'}
              className={exporting ? '[&_svg]:animate-spin' : undefined}
            />
          </Tooltip>
        ) : null}
        {canOpenGenerateOverlay && hasReportRuns ? (
          <Tooltip content="Refresh report">
            <Button
              size="sm"
              variant="secondary"
              iconOnly
              icon={RefreshCw}
              onClick={openGenerateOverlay}
              title="Refresh report"
              aria-label="Refresh report"
            />
          </Tooltip>
        ) : null}
        {canGenerate ? (
          <Tooltip content="Manage blueprints">
            <Button
              size="sm"
              variant="secondary"
              iconOnly
              icon={Settings2}
              onClick={() => setShowManageBlueprints(true)}
              title="Manage blueprints"
              aria-label="Manage blueprints"
            />
          </Tooltip>
        ) : null}
        <Tooltip content="Build custom report">
          <button
            onClick={() => {
              const store = useChatWidgetStore.getState();
              if (!store.open) store.toggle();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:scale-110 transition-all duration-150"
            style={{ background: 'linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-primary-hover) 50%, var(--color-brand-primary-deep) 100%)' }}
            title="Build Your Own Report"
            aria-label="Build Your Own Report"
          >
            <img src="/sherlock-icon.svg" alt="Sherlock" className="h-4 w-4 invert" />
          </button>
        </Tooltip>
      </div>
      {reportRuns.length > 1 && selectedReportRunId ? (
        <Select
          value={selectedReportRunId}
          onChange={setSelectedReportRunId}
          options={reportRunOptions}
          size="sm"
          className="min-w-[240px] max-w-[280px]"
        />
      ) : null}
    </div>
  );

  const generateOverlayFooter = !credentialsReady
    ? 'Configure provider credentials in Settings before generating a report.'
    : overlayConfig
      ? `Using ${overlayConfig.isDefault ? 'default' : 'blueprint'} ${overlayConfig.reportId}.`
      : 'Pick a blueprint to continue.';

  return (
    <>
      <div className="space-y-5">
        {status === 'generating' && !report ? (
          <ReportZeroState
            config={selectedConfig}
            sectionsPreview={sectionsPreview}
            canGenerate={canOpenGenerateOverlay}
            actionLabel={reportActionLabel}
            onGenerate={openGenerateOverlay}
            progressContent={<div className="max-w-md">{inProgressCard}</div>}
          />
        ) : status === 'error' && !report ? (
          <ReportZeroState
            config={selectedConfig}
            sectionsPreview={sectionsPreview}
            canGenerate={canOpenGenerateOverlay}
            actionLabel={reportActionLabel}
            onGenerate={openGenerateOverlay}
            errorMessage={error ?? 'Something went wrong while loading the selected report run.'}
          />
        ) : report ? (
          <div className="max-w-none">{renderReport(report, reportActionButtons)}</div>
        ) : (
          <ReportZeroState
            config={selectedConfig}
            sectionsPreview={sectionsPreview}
            canGenerate={canOpenGenerateOverlay}
            actionLabel={reportActionLabel}
            onGenerate={openGenerateOverlay}
          />
        )}
      </div>

      <SettingsSlideOver
        isOpen={showGenerateOverlay && canOpenGenerateOverlay}
        onClose={() => setShowGenerateOverlay(false)}
        title={reportActionLabel}
        description="Pick a blueprint and a model to generate a report for this run."
        onSubmit={() => void handleGenerate()}
        submitLabel="Generate"
        canSubmit={!!overlayConfig && credentialsReady && !!reportModel}
        widthClassName="w-[720px] max-w-[92vw]"
        footerContent={(
          <div className={`text-[12px] ${!credentialsReady ? 'text-[var(--color-warning)]' : 'text-[var(--text-muted)]'}`}>
            {generateOverlayFooter}
          </div>
        )}
      >
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Blueprint</span>
              <button
                type="button"
                onClick={() => {
                  setShowGenerateOverlay(false);
                  setShowManageBlueprints(true);
                }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)] hover:text-[var(--color-accent-purple)]"
              >
                <Settings2 className="h-3 w-3" />
                Manage
              </button>
            </div>
            {reportConfigOptions.length > 1 ? (
              <Select
                value={overlayReportId ?? ''}
                onChange={setOverlayReportId}
                options={reportConfigOptions}
                placeholder="Choose a saved blueprint"
                className="w-full"
              />
            ) : (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]">
                {reportConfigOptions[0]?.label ?? 'Default Single Run Report'}
              </div>
            )}
            {overlayConfig ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
                <span className="font-mono">{overlayConfig.reportId}</span>
                <span aria-hidden>·</span>
                <span>
                  {`${overlayConfigSectionCount} section${overlayConfigSectionCount === 1 ? '' : 's'}`}
                </span>
                {overlayConfig.description ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="min-w-0 truncate">{overlayConfig.description}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Provider and model</div>
            <LegacyLlmConfigCompat
              callSite="report_generation"
              provider={reportProvider}
              onProviderChange={(value) => {
                setReportProvider(value);
                setReportModel('');
              }}
              model={reportModel}
              onModelChange={setReportModel}
            />
          </div>

        </div>
      </SettingsSlideOver>

      <ManageBlueprintsSlideOver
        isOpen={showManageBlueprints}
        onClose={() => setShowManageBlueprints(false)}
        configs={configs}
        onConfigsChanged={async () => {
          // Bust the configs cache; the useEffect that defaults selectedReportId
          // re-runs against the new list and re-pins selection if the current
          // one was archived/renamed.
          await invalidateReportConfigs(queryClient, appId, 'single_run');
        }}
      />

    </>
  );
}
