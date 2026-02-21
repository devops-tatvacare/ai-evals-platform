import { useState, useMemo, useCallback } from 'react';
import { ClipboardList, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui';
import { SourceTranscriptPane } from './SourceTranscriptPane';
import { ExtractedDataPane } from './ExtractedDataPane';
import { JudgeVerdictPane } from './JudgeVerdictPane';
import type { Listing, AIEvaluation } from '@/types';

interface SemanticAuditViewProps {
  listing: Listing;
  aiEval?: AIEvaluation | null;
}

/**
 * Three-pane inspector for API flow evaluations.
 * 
 * Layout:
 * +------------------+--------------------+------------------+
 * | SOURCE TRANSCRIPT| EXTRACTED DATA     | JUDGE VERDICT    |
 * | (Read-Only)      | (Interactive)      |                  |
 * +------------------+--------------------+------------------+
 * 
 * - Left: Source transcript with highlight support for evidence
 * - Center: Collapsible tree view of extracted JSON with status indicators
 * - Right: Details for the selected field's verdict
 */
export function SemanticAuditView({ listing, aiEval }: SemanticAuditViewProps) {
  const [selectedFieldPath, setSelectedFieldPath] = useState<string | undefined>();

  // Get data from listing
  const { apiResponse } = listing;
  
  // Source transcript = API's original output (the system under test)
  const transcript = apiResponse?.input || '';
  
  // Extract normalization data
  const normalizedTranscript = aiEval?.normalizedOriginal?.fullTranscript;

  const normalizationMeta = useMemo(() => {
    const meta = aiEval?.normalizationMeta;
    if (!meta?.enabled) return undefined;
    return {
      enabled: meta.enabled,
      sourceScript: meta.sourceScript,
      targetScript: meta.targetScript,
    };
  }, [aiEval?.normalizationMeta]);
  
  // Show API's rx data (the system under test) — judge critiques overlay on top
  const structuredData = useMemo(() => {
    return apiResponse?.rx || {};
  }, [apiResponse?.rx]);
  
  // Get field critiques directly from unified critique
  const critiques = aiEval?.critique?.fieldCritiques ?? [];
  
  // Find selected critique
  const selectedCritique = useMemo(() => {
    if (!selectedFieldPath) return null;
    return critiques.find(c => c.fieldPath === selectedFieldPath) || null;
  }, [selectedFieldPath, critiques]);
  
  // Build prioritized highlight candidates from critique data.
  // SourceTranscriptPane tries each in order against the displayed transcript.
  const highlightCandidates = useMemo(() => {
    if (!selectedCritique) return undefined;

    const candidates: string[] = [];
    const seen = new Set<string>();
    const add = (val: unknown) => {
      const s = String(val ?? '').trim();
      // Strip wrapping quotes (from JSON stringification)
      const cleaned = s.length >= 2 && s.startsWith('"') && s.endsWith('"')
        ? s.slice(1, -1)
        : s;
      if (
        cleaned.length >= 3 &&
        cleaned !== '(empty)' &&
        cleaned !== '(not found)' &&
        !cleaned.startsWith('{') &&
        !cleaned.startsWith('[') &&
        !seen.has(cleaned.toLowerCase())
      ) {
        seen.add(cleaned.toLowerCase());
        candidates.push(cleaned);
      }
    };

    // 1. LLM's explicit evidence snippet (asked to quote from API transcript)
    add(selectedCritique.evidenceSnippet);
    // 2. API value — deterministic, extracted from the transcript by the API
    add(selectedCritique.apiValue);
    // 3. Judge value — useful when API value doesn't match (different phrasing)
    add(selectedCritique.judgeValue);
    // 4. Quoted text from critique reasoning (last resort)
    const quoteMatch = selectedCritique.critique.match(/"([^"]+)"/);
    if (quoteMatch) add(quoteMatch[1]);

    return candidates.length > 0 ? candidates : undefined;
  }, [selectedCritique]);
  
  const handleFieldSelect = useCallback((path: string) => {
    setSelectedFieldPath(prev => prev === path ? undefined : path);
  }, []);
  
  // Calculate summary stats
  const stats = useMemo(() => {
    const total = critiques.length;
    const matches = critiques.filter(c => c.match).length;
    const mismatches = total - matches;
    const accuracy = total > 0 ? Math.round((matches / total) * 100) : 0;
    
    return { total, matches, mismatches, accuracy };
  }, [critiques]);
  
  // Overall assessment
  const overallAssessment = aiEval?.critique?.overallAssessment;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header with summary stats */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Semantic Audit
          </h3>
          
          {/* Accuracy badge */}
          <div className="flex items-center gap-2">
            <Badge 
              variant={stats.accuracy >= 90 ? 'success' : stats.accuracy >= 70 ? 'warning' : 'error'}
              className="gap-1"
            >
              <BarChart3 className="h-3 w-3" />
              {stats.accuracy}% Accuracy
            </Badge>
            <span className="text-xs text-[var(--text-muted)]">
              {stats.matches}/{stats.total} fields correct
            </span>
          </div>
        </div>
        
        {/* Overall assessment */}
        {overallAssessment && (
          <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
            {overallAssessment}
          </p>
        )}
      </div>

      {/* Three-pane layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left pane - Source Transcript */}
        <div className="w-1/3 border-r border-[var(--border-subtle)] min-w-0 overflow-hidden">
          <SourceTranscriptPane
            transcript={transcript}
            highlightCandidates={highlightCandidates}
            normalizedTranscript={normalizedTranscript}
            normalizationMeta={normalizationMeta}
          />
        </div>

        {/* Center pane - Extracted Data */}
        <div className="w-1/3 border-r border-[var(--border-subtle)] min-w-0 overflow-hidden">
          <ExtractedDataPane
            data={structuredData as Record<string, unknown>}
            critiques={critiques}
            selectedFieldPath={selectedFieldPath}
            onFieldSelect={handleFieldSelect}
          />
        </div>

        {/* Right pane - Judge Verdict */}
        <div className="w-1/3 min-w-0 overflow-hidden">
          <JudgeVerdictPane critique={selectedCritique} />
        </div>
      </div>
    </div>
  );
}
