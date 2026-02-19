import type { FieldCritique, ApiEvaluationCritique } from '@/types';

/**
 * Extract FieldCritique[] from an ApiEvaluationCritique, handling both data shapes:
 * 1. Classic shape: structuredComparison.fields (already FieldCritique[])
 * 2. Semantic audit shape: rawOutput.field_critiques (needs transformation)
 *
 * Used by both SemanticAuditView (Inspector) and ApiEvalsView (Classic) to
 * avoid duplicating the transformation logic.
 */
export function extractFieldCritiques(apiCritique: ApiEvaluationCritique | undefined | null): FieldCritique[] {
  if (!apiCritique) return [];

  // Classic shape: structuredComparison.fields
  if (apiCritique.structuredComparison?.fields) {
    return apiCritique.structuredComparison.fields;
  }

  // Schema-driven shape: rawOutput.field_critiques
  const raw = apiCritique.rawOutput;
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
}

/**
 * Build a structuredComparison-compatible object from field critiques + assessment.
 * Used when Classic view needs to display data that only exists in rawOutput shape.
 */
export function buildStructuredComparison(
  critiques: FieldCritique[],
  assessment: string,
): ApiEvaluationCritique['structuredComparison'] {
  if (critiques.length === 0) return undefined;

  const matches = critiques.filter(c => c.match).length;
  const accuracy = critiques.length > 0 ? Math.round((matches / critiques.length) * 100) : 0;

  return {
    fields: critiques,
    overallAccuracy: accuracy,
    summary: assessment,
  };
}
