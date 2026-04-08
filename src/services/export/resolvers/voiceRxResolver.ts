/**
 * Voice-RX Export Resolver
 *
 * Gathers ALL evaluation data for a listing and normalizes it
 * into the universal EvalExportPayload. App-specific logic lives here;
 * exporters never see voice-rx details.
 */
import { fetchRunsByListing, fetchHumanReview } from '@/services/api/evalRunsApi';
import { evaluatorsRepository } from '@/services/api/evaluatorsApi';
import { APPS } from '@/types/app.types';
import type { Listing, EvalRun, AIEvaluation, HumanReview, EvaluatorDefinition } from '@/types';
import type {
  EvalExportPayload,
  ExportSource,
  EvalExportEntry,
  ExportField,
  ExportHumanReview,
} from '../types';

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

export async function resolveVoiceRxExport(
  appId: string,
  listing: Listing,
): Promise<EvalExportPayload> {
  // Fetch all eval runs + evaluator definitions in parallel
  const [allRuns, evaluatorDefs] = await Promise.all([
    fetchRunsByListing(listing.id),
    evaluatorsRepository.getForListing(appId, listing.id),
  ]);

  const evaluatorMap = new Map<string, EvaluatorDefinition>();
  for (const def of evaluatorDefs) {
    evaluatorMap.set(def.id, def);
  }

  const source = buildSource(appId, listing);
  const evaluations: EvalExportEntry[] = [];

  // Process each run
  for (const run of allRuns) {
    if (run.evalType === 'full_evaluation') {
      const humanReview = await fetchHumanReviewSafe(run.id);
      evaluations.push(buildFullEvalEntry(run, listing, humanReview));
      // Also add human review as a standalone entry if present
      if (humanReview) {
        evaluations.push(buildHumanReviewEntry(humanReview));
      }
    } else if (run.evalType === 'custom') {
      const evaluator = run.evaluatorId ? evaluatorMap.get(run.evaluatorId) : undefined;
      evaluations.push(buildCustomEvalEntry(run, evaluator));
    }
  }

  return {
    exportedAt: new Date(),
    source,
    evaluations,
  };
}

// ═══════════════════════════════════════════════════════════════
// Source builder
// ═══════════════════════════════════════════════════════════════

function buildSource(appId: string, listing: Listing): ExportSource {
  const appMeta = APPS[appId as keyof typeof APPS];
  const metadata: Record<string, unknown> = {};

  if (listing.audioFile) {
    metadata.audioFileName = listing.audioFile.name;
    if (listing.audioFile.duration) {
      const mins = Math.floor(listing.audioFile.duration / 60);
      const secs = Math.floor(listing.audioFile.duration % 60);
      metadata.audioDuration = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
  }

  if (listing.transcript) {
    metadata.totalSegments = listing.transcript.segments.length;
    const speakers = new Set(listing.transcript.segments.map(s => s.speaker));
    metadata.speakers = Array.from(speakers).join(', ');
    const wordCount = listing.transcript.segments.reduce(
      (sum, s) => sum + s.text.split(/\s+/).filter(w => w).length, 0,
    );
    metadata.wordCount = wordCount;
  }

  metadata.sourceType = listing.sourceType;
  metadata.status = listing.status;

  return {
    id: listing.id,
    appId,
    appLabel: appMeta?.name ?? appId,
    title: listing.title,
    type: 'listing',
    createdAt: listing.createdAt instanceof Date
      ? listing.createdAt.toISOString()
      : String(listing.createdAt),
    metadata,
  };
}

// ═══════════════════════════════════════════════════════════════
// Full Evaluation entry
// ═══════════════════════════════════════════════════════════════

function buildFullEvalEntry(
  run: EvalRun,
  listing: Listing,
  humanReview: HumanReview | null,
): EvalExportEntry {
  const aiEval = run.result as unknown as AIEvaluation | undefined;
  const stats = aiEval?.critique?.statistics as Record<string, unknown> | undefined;
  const fields: ExportField[] = [];

  // Build fields from statistics
  if (stats) {
    const numericKeys: Array<[string, string]> = [
      ['totalSegments', 'Total Segments'],
      ['criticalCount', 'Critical Issues'],
      ['moderateCount', 'Moderate Issues'],
      ['minorCount', 'Minor Issues'],
      ['matchCount', 'Matches'],
      ['originalCorrectCount', 'Original Correct'],
      ['judgeCorrectCount', 'Judge Correct'],
      ['unclearCount', 'Unclear'],
    ];
    for (const [key, label] of numericKeys) {
      if (stats[key] != null) {
        fields.push({ key, label, value: stats[key], type: 'number', role: 'metric' });
      }
    }
  }

  // Primary metric: match rate
  let primaryMetric: EvalExportEntry['primaryMetric'];
  const total = (stats?.totalSegments as number) ?? 0;
  const matches = (stats?.matchCount as number) ?? 0;
  if (total > 0) {
    primaryMetric = {
      key: 'matchRate',
      label: 'Match Rate',
      value: Number(((matches / total) * 100).toFixed(1)),
      format: 'percentage',
    };
  }

  // Detail rows: segment-by-segment comparison
  let detailColumns: string[] | undefined;
  let detailRows: unknown[][] | undefined;

  const segments = listing.transcript?.segments;
  const critiqueSegments = aiEval?.critique?.segments as Array<Record<string, unknown>> | undefined;

  if (segments?.length && critiqueSegments?.length) {
    const critiqueByIdx = new Map<number, Record<string, unknown>>();
    for (const c of critiqueSegments) {
      critiqueByIdx.set(c.segmentIndex as number, c);
    }

    // If there's a human review, build corrections map
    const correctionByIdx = new Map<number, Record<string, unknown>>();
    if (humanReview?.reviewSchema === 'segment_review') {
      for (const item of humanReview.result.items) {
        const rec = item as unknown as Record<string, unknown>;
        correctionByIdx.set(rec.segmentIndex as number, rec);
      }
    }

    detailColumns = [
      '#', 'Speaker', 'Start', 'End', 'Original Text', 'AI Judge Text',
      'Discrepancy', 'Severity', 'Likely Correct', 'Confidence',
      'Human Verdict', 'Corrected Text', 'Comment',
    ];

    detailRows = segments.map((seg, idx) => {
      const c = critiqueByIdx.get(idx);
      const r = correctionByIdx.get(idx);
      return [
        idx + 1,
        seg.speaker ?? '',
        seg.startTime ?? '',
        seg.endTime ?? '',
        seg.text ?? '',
        c?.judgeText ?? '',
        c?.discrepancy ?? '',
        c?.severity ?? '',
        c?.likelyCorrect ?? '',
        c?.confidence ?? '',
        r?.verdict ?? '',
        r?.correctedText ?? '',
        r?.comment ?? '',
      ];
    });
  } else if (aiEval?.critique?.fieldCritiques?.length) {
    // API flow: field-by-field comparison
    detailColumns = ['Field Path', 'API Value', 'Judge Value', 'Match', 'Critique', 'Severity', 'Confidence'];
    detailRows = aiEval.critique.fieldCritiques.map(fc => [
      fc.fieldPath,
      formatValue(fc.apiValue),
      formatValue(fc.judgeValue),
      fc.match ? 'Yes' : 'No',
      fc.critique,
      fc.severity,
      fc.confidence,
    ]);
  }

  // Human review attachment
  let exportHumanReview: ExportHumanReview | undefined;
  if (humanReview) {
    exportHumanReview = buildExportHumanReview(humanReview);
  }

  return {
    runId: run.id,
    evaluatorName: 'Full Evaluation',
    evaluatorType: 'built-in',
    evalType: run.evalType,
    status: run.status,
    model: aiEval?.models?.transcription ?? run.llmModel,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    primaryMetric,
    fields,
    overallAssessment: aiEval?.critique?.overallAssessment,
    detailColumns,
    detailRows,
    humanReview: exportHumanReview,
  };
}

// ═══════════════════════════════════════════════════════════════
// Custom Evaluator entry
// ═══════════════════════════════════════════════════════════════

function buildCustomEvalEntry(
  run: EvalRun,
  evaluator?: EvaluatorDefinition,
): EvalExportEntry {
  const result = run.result as Record<string, unknown> | undefined;
  const output = result?.output as Record<string, unknown> | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;
  const fields: ExportField[] = [];

  // Map output fields through evaluator's schema for labels/types
  const schemaFields = evaluator?.outputSchema ?? [];
  const schemaMap = new Map(schemaFields.map(f => [f.key, f]));

  if (output) {
    for (const [key, value] of Object.entries(output)) {
      const schemaDef = schemaMap.get(key);
      fields.push({
        key,
        label: schemaDef?.description || key,
        value,
        type: schemaDef?.type ?? typeof value,
        role: schemaDef?.role,
      });
    }
  }

  // Primary metric: use main metric field from schema or fall back to summary.overall_score
  let primaryMetric: EvalExportEntry['primaryMetric'];
  const mainField = schemaFields.find(f => f.isMainMetric);

  if (mainField && output?.[mainField.key] != null) {
    primaryMetric = {
      key: mainField.key,
      label: mainField.description || mainField.key,
      value: output[mainField.key],
      format: mainField.type === 'number' ? 'number'
        : mainField.type === 'boolean' ? 'boolean'
        : 'text',
    };
  } else if (summary?.overall_score != null) {
    primaryMetric = {
      key: 'overall_score',
      label: 'Overall Score',
      value: summary.overall_score,
      format: typeof summary.overall_score === 'number' ? 'number' : 'text',
    };
  }

  return {
    runId: run.id,
    evaluatorName: evaluator?.name ?? (summary?.evaluator_name as string) ?? 'Custom Evaluator',
    evaluatorType: 'custom',
    evalType: run.evalType,
    status: run.status,
    model: run.llmModel,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    primaryMetric,
    fields,
    reasoning: summary?.reasoning as string | undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// Human Review standalone entry
// ═══════════════════════════════════════════════════════════════

function buildHumanReviewEntry(
  review: HumanReview,
): EvalExportEntry {
  const s = review.summary;
  const fields: ExportField[] = [
    { key: 'totalItems', label: 'Total Items', value: s.totalItems, type: 'number', role: 'metric' },
    { key: 'accepted', label: 'Accepted', value: s.accepted, type: 'number', role: 'metric' },
    { key: 'rejected', label: 'Rejected', value: s.rejected, type: 'number', role: 'metric' },
    { key: 'corrected', label: 'Corrected', value: s.corrected, type: 'number', role: 'metric' },
    { key: 'unreviewed', label: 'Unreviewed', value: s.unreviewed, type: 'number', role: 'metric' },
  ];

  return {
    runId: review.id,
    evaluatorName: 'Human Review',
    evaluatorType: 'human',
    evalType: 'custom',
    status: 'completed',
    completedAt: review.completedAt,
    primaryMetric: {
      key: 'verdict',
      label: 'Verdict',
      value: review.result.overallVerdict.replace(/_/g, ' '),
      format: 'verdict',
    },
    fields,
    humanReview: buildExportHumanReview(review),
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function buildExportHumanReview(review: HumanReview): ExportHumanReview {
  const s = review.summary;
  return {
    verdict: review.result.overallVerdict.replace(/_/g, ' '),
    notes: review.result.notes,
    stats: {
      total: s.totalItems,
      accepted: s.accepted,
      rejected: s.rejected,
      corrected: s.corrected,
    },
    items: review.result.items.map((item, idx) => {
      const segItem = item as unknown as Record<string, unknown>;
      return {
        index: (segItem.segmentIndex as number) ?? idx,
        verdict: String(segItem.verdict ?? ''),
        correctedValue: segItem.correctedText as string | undefined,
        comment: segItem.comment as string | undefined,
      };
    }),
  };
}

async function fetchHumanReviewSafe(runId: string): Promise<HumanReview | null> {
  try {
    return await fetchHumanReview(runId);
  } catch {
    return null;
  }
}

function formatValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
