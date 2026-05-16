import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Clock, Download, FileBarChart, Loader2, RefreshCw, Settings2, Sparkles } from 'lucide-react';

import { Button, EmptyState, LLMConfigSection, Select, Tooltip, type SelectOption } from '@/components/ui';
import { SettingsSlideOver } from '@/features/settings/components/SettingsSlideOver';
import { ManageBlueprintsSlideOver } from './ManageBlueprintsSlideOver';
import { formatPdfExportError } from './pdfExportError';
import { pollJobUntilComplete, submitAndPollJob, type JobProgress } from '@/services/api/jobPolling';
import { reportsApi } from '@/services/api/reportsApi';
import { notificationService } from '@/services/notifications';
import { useProviderConfigs } from '@/services/api/aiSettingsQueries';
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

function ReportZeroState({
  config,
  canGenerate,
  actionLabel,
  onGenerate,
  progressContent,
  errorMessage,
}: {
  config: ReportConfigSummary | null;
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

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
      <div className="px-7 py-8 text-white md:px-9 md:py-10" style={heroStyle}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
          <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">Default single-run report</span>
          <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-mono normal-case tracking-normal text-white/90">
            {config?.reportId ?? 'default-single-run'}
          </span>
        </div>
        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.03em] md:text-[2.35rem]">
          {config?.name ?? 'Run report'}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/82 md:text-[15px]">
          {errorMessage
            ? errorMessage
            : config?.description || 'Compose the narrative report for this run using the platform report contract and the default presentation theme.'}
        </p>
        <div className="mt-7">
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

      <div className="grid gap-3 p-6 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
          <div className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold" style={chipStyle}>
            Executive summary
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            AI-generated narrative, top issues, and recommendations rendered inside the platform report shell.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
          <div className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold" style={chipStyle}>
            Compliance and trends
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            Rule compliance, verdict distributions, and metric breakdowns shown with the same document grammar as export.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
          <div className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold" style={chipStyle}>
            Exemplars and prompt gaps
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            Best/worst examples, prompt gaps, and action items composed into a polished report instead of a raw analytics grid.
          </p>
        </div>
      </div>
    </section>
  );
}

export default function ReportTab<TReport extends ReportPayloadLike>({
  appId,
  runId,
  supportsPdf = true,
  renderReport,
}: Props<TReport>) {
  const [configs, setConfigs] = useState<ReportConfigSummary[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportRuns, setReportRuns] = useState<ReportRunSummary[]>([]);
  const [selectedReportRunId, setSelectedReportRunId] = useState<string | null>(null);
  const [report, setReport] = useState<TReport | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showGenerateOverlay, setShowGenerateOverlay] = useState(false);
  const [overlayReportId, setOverlayReportId] = useState<string | null>(null);
  const [showManageBlueprints, setShowManageBlueprints] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [jobPhase, setJobPhase] = useState<'queued' | 'running' | null>(null);
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

  const loadConfigs = useCallback(async () => {
    const nextConfigs = await reportsApi.listReportConfigs(appId, 'single_run');
    setConfigs(nextConfigs);
    setSelectedReportId(nextConfigs.find((config) => config.isDefault)?.reportId ?? nextConfigs[0]?.reportId ?? null);
    return nextConfigs;
  }, [appId]);

  const loadReportRuns = useCallback(async (reportId: string) => {
    const nextRuns = await reportsApi.listReportRuns({
      appId,
      scope: 'single_run',
      sourceEvalRunId: runId,
      reportId,
      limit: 20,
    });
    setReportRuns(nextRuns);
    setSelectedReportRunId((current) => {
      if (current && nextRuns.some((reportRun) => reportRun.id === current)) return current;
      return nextRuns.find((reportRun) => reportRun.status === 'completed')?.id ?? nextRuns[0]?.id ?? null;
    });
    return nextRuns;
  }, [appId, runId]);

  const syncModelSelectionFromReport = useCallback((nextReport: TReport | null) => {
    const metadata = getReportMetadata(nextReport);
    if (metadata?.llmProvider) setReportProvider(metadata.llmProvider as LLMProvider);
    if (metadata?.llmModel) setReportModel(metadata.llmModel);
  }, []);

  const loadSelectedArtifact = useCallback(async (reportRun: ReportRunSummary | null) => {
    if (!reportRun) {
      setReport(null);
      setStatus('idle');
      return;
    }

    if (reportRun.status === 'failed' || reportRun.status === 'cancelled') {
      setReport(null);
      setError('Report generation failed. Click Generate to retry.');
      setStatus('error');
      return;
    }

    if (reportRun.status !== 'completed') {
      setReport(null);
      setStatus('generating');
      return;
    }

    const nextReport = await reportsApi.fetchReportRunArtifact(reportRun.id) as unknown as TReport;
    setReport(nextReport);
    syncModelSelectionFromReport(nextReport);
    setStatus('ready');
  }, [syncModelSelectionFromReport]);

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
    setStatus('generating');

    try {
      await pollJobUntilComplete(reportRun.jobId, {
        pollIntervalMs: 2000,
        signal: controller.signal,
        onProgress: (progress) => {
          handleJobProgress(progress);
        },
      });

      const refreshedRuns = await loadReportRuns(reportRun.reportId);
      const completedRun = refreshedRuns.find((entry) => entry.id === reportRun.id && entry.status === 'completed')
        ?? refreshedRuns.find((entry) => entry.status === 'completed');

      if (completedRun) {
        setSelectedReportRunId(completedRun.id);
        await loadSelectedArtifact(completedRun);
      } else {
        setStatus('idle');
      }
    } catch (jobError) {
      if (jobError instanceof DOMException && jobError.name === 'AbortError') return;
      const message = jobError instanceof Error ? jobError.message : 'Report generation failed';
      setError(message);
      setStatus('error');
    } finally {
      setProgressMsg('');
      setQueuePosition(null);
      setJobPhase(null);
    }
  }, [handleJobProgress, loadReportRuns, loadSelectedArtifact]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setReport(null);
    setReportRuns([]);
    setSelectedReportRunId(null);

    void loadConfigs()
      .then((nextConfigs) => {
        if (cancelled) return;
        if (nextConfigs.length === 0) {
          setStatus('idle');
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load report configs');
        setStatus('error');
      });

    return () => {
      cancelled = true;
      pollAbortRef.current?.abort();
    };
  }, [loadConfigs, runId]);

  useEffect(() => {
    if (!selectedReportId) return;
    let cancelled = false;

    void loadReportRuns(selectedReportId)
      .then((nextRuns) => {
        if (cancelled) return;
        if (nextRuns.length === 0) {
          setReport(null);
          setStatus('idle');
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load report runs');
        setStatus('error');
      });

    return () => {
      cancelled = true;
      pollAbortRef.current?.abort();
    };
  }, [loadReportRuns, selectedReportId]);

  useEffect(() => {
    if (!selectedReportRun) return;

    void loadSelectedArtifact(selectedReportRun).catch((loadError) => {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load report';
      setError(message);
      setStatus('error');
    });

    if ((selectedReportRun.status === 'queued' || selectedReportRun.status === 'running') && selectedReportRun.jobId) {
      void pollExistingJob(selectedReportRun);
    }
  }, [loadSelectedArtifact, pollExistingJob, selectedReportRun]);

  const handleGenerate = useCallback(async () => {
    if (!overlayConfig) return;
    const targetReportId = overlayConfig.reportId;

    setShowGenerateOverlay(false);
    setSelectedReportId(targetReportId);
    setStatus('generating');
    setError(null);
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

      const nextRuns = await loadReportRuns(targetReportId);
      const nextReportRun = nextRuns.find((entry) => entry.id === generatedReportRunId)
        ?? nextRuns.find((entry) => entry.status === 'completed');

      if (!nextReportRun) {
        setReport(null);
        setStatus('idle');
        return;
      }

      setSelectedReportRunId(nextReportRun.id);
      await loadSelectedArtifact(nextReportRun);
      notificationService.success('Report generated');
    } catch (generateError) {
      const message = generateError instanceof Error ? generateError.message : 'Report generation failed';
      setError(message);
      setStatus('error');
      notificationService.error(message);
    } finally {
      setProgressMsg('');
      setQueuePosition(null);
      setJobPhase(null);
    }
  }, [
    appId,
    handleJobProgress,
    loadReportRuns,
    loadSelectedArtifact,
    overlayConfig,
    reportModel,
    reportProvider,
    runId,
  ]);

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
        <div>
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
            style={{ background: 'linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-primary-hover) 50%, #2D1B69 100%)' }}
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
            canGenerate={canOpenGenerateOverlay}
            actionLabel={reportActionLabel}
            onGenerate={openGenerateOverlay}
            progressContent={<div className="max-w-md">{inProgressCard}</div>}
          />
        ) : status === 'error' && !report ? (
          <ReportZeroState
            config={selectedConfig}
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
            <LLMConfigSection
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
          const nextConfigs = await loadConfigs();
          if (!nextConfigs.some((config) => config.reportId === selectedReportId)) {
            setSelectedReportId(nextConfigs.find((config) => config.isDefault)?.reportId ?? nextConfigs[0]?.reportId ?? null);
          }
        }}
      />

    </>
  );
}
