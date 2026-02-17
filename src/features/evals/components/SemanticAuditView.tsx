import { useState, useMemo, useCallback } from 'react';
import { ClipboardList, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui';
import { SourceTranscriptPane } from './SourceTranscriptPane';
import { ExtractedDataPane } from './ExtractedDataPane';
import { JudgeVerdictPane } from './JudgeVerdictPane';
import type { Listing, AIEvaluation, FieldCritique } from '@/types';

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
  
  // Extract transcript - prefer judge's transcription, fall back to API input
  const transcript = useMemo(() => {
    return aiEval?.judgeOutput?.transcript || apiResponse?.input || '';
  }, [aiEval?.judgeOutput?.transcript, apiResponse?.input]);
  
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
  
  // Extract structured data - prefer judge's structured data, fall back to API rx
  const structuredData = useMemo(() => {
    return aiEval?.judgeOutput?.structuredData || apiResponse?.rx || {};
  }, [aiEval?.judgeOutput?.structuredData, apiResponse?.rx]);
  
  // Get field critiques from API evaluation
  const critiques: FieldCritique[] = useMemo(() => {
    // Classic shape: structuredComparison.fields
    if (aiEval?.apiCritique?.structuredComparison?.fields) {
      return aiEval.apiCritique.structuredComparison.fields;
    }
    // Schema-driven shape: rawOutput.field_critiques
    const raw = aiEval?.apiCritique?.rawOutput;
    if (raw?.field_critiques && Array.isArray(raw.field_critiques)) {
      return (raw.field_critiques as Record<string, unknown>[]).map(fc => {
        const pass = String(fc.verdict || '').toLowerCase() === 'pass';
        return {
          fieldPath: String(fc.field_name || ''),
          apiValue: fc.extracted_value ?? null,
          judgeValue: fc.correction ?? fc.extracted_value ?? null,
          match: pass,
          critique: String(fc.reasoning || ''),
          severity: (pass ? 'none' : (fc.error_type === 'contradiction' ? 'critical' : 'moderate')) as FieldCritique['severity'],
          confidence: 'high' as FieldCritique['confidence'],
          evidenceSnippet: fc.evidence_snippet ? String(fc.evidence_snippet) : undefined,
        };
      });
    }
    return [];
  }, [aiEval?.apiCritique]);
  
  // Find selected critique
  const selectedCritique = useMemo(() => {
    if (!selectedFieldPath) return null;
    return critiques.find(c => c.fieldPath === selectedFieldPath) || null;
  }, [selectedFieldPath, critiques]);
  
  // Get evidence snippet for highlight - use evidenceSnippet from critique or extract from critique text
  const evidenceSnippet = useMemo(() => {
    if (!selectedCritique) return undefined;
    
    // First, use explicit evidenceSnippet if available
    if (selectedCritique.evidenceSnippet) {
      return selectedCritique.evidenceSnippet;
    }
    
    // Fallback: try to extract quoted text from critique reasoning
    // Look for text in quotes or after "says", "mentions", "states"
    const critiqueText = selectedCritique.critique;
    const quoteMatch = critiqueText.match(/"([^"]+)"/);
    if (quoteMatch && quoteMatch[1].length > 5) {
      return quoteMatch[1];
    }
    
    return undefined;
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
  const overallAssessment = aiEval?.apiCritique?.overallAssessment;

  return (
    <div className="h-full flex flex-col">
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
        <div className="w-1/3 border-r border-[var(--border-subtle)] min-w-0">
          <SourceTranscriptPane 
            transcript={transcript}
            highlightSnippet={evidenceSnippet}
            normalizedTranscript={normalizedTranscript}
            normalizationMeta={normalizationMeta}
          />
        </div>
        
        {/* Center pane - Extracted Data */}
        <div className="w-1/3 border-r border-[var(--border-subtle)] min-w-0">
          <ExtractedDataPane
            data={structuredData as Record<string, unknown>}
            critiques={critiques}
            selectedFieldPath={selectedFieldPath}
            onFieldSelect={handleFieldSelect}
          />
        </div>
        
        {/* Right pane - Judge Verdict */}
        <div className="w-1/3 min-w-0">
          <JudgeVerdictPane critique={selectedCritique} />
        </div>
      </div>
    </div>
  );
}
