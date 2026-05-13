/**
 * Rubric Builder for Inside Sales evaluators.
 * Replaces the standard output schema builder for rubric-capable apps.
 * Manages dimensions with checks, compliance gates, and thresholds.
 * Serializes to standard EvaluatorOutputField[] format on change.
 */

import { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Shield, AlertTriangle } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import type { EvaluatorOutputField } from '@/types';

interface Check {
  name: string;
  points: number;
}

interface Dimension {
  name: string;
  maxPoints: number;
  checks: Check[];
}

interface RubricData {
  dimensions: Dimension[];
  complianceGates: string[];
  passThreshold: number;
  excellentThreshold: number;
}

interface RubricBuilderProps {
  outputFields: EvaluatorOutputField[];
  onFieldsChange: (fields: EvaluatorOutputField[]) => void;
  onPromptGenerated: (prompt: string) => void;
}

/* ── Parse existing output_schema back to rubric ─────────── */

function parseOutputToRubric(fields: EvaluatorOutputField[]): RubricData {
  const dimensions: Dimension[] = [];
  const complianceGates: string[] = [];
  let passThreshold = 65;
  let excellentThreshold = 80;

  for (const f of fields) {
    const role = f.role ?? (f.isMainMetric ? 'metric' : 'detail');

    if (f.isMainMetric && f.type === 'number') {
      passThreshold = f.thresholds?.yellow ?? 65;
      excellentThreshold = f.thresholds?.green ?? 80;
      continue;
    }
    if (role === 'reasoning') {
      continue;
    }
    if (f.type === 'number' && !f.isMainMetric) {
      const match = f.description?.match(/^(.+?)\s*\(max (\d+)\)$/);
      dimensions.push({
        name: match ? match[1] : f.key,
        maxPoints: match ? parseInt(match[2], 10) : 10,
        checks: [],
      });
    }
    if (f.type === 'boolean') {
      complianceGates.push(f.description || f.key);
    }
  }

  return { dimensions, complianceGates, passThreshold, excellentThreshold };
}

/* ── Serialize rubric to output_schema ───────────────────── */

function rubricToOutputFields(rubric: RubricData): EvaluatorOutputField[] {
  const fields: EvaluatorOutputField[] = [];

  // Overall score (main metric)
  fields.push({
    key: 'overall_score',
    type: 'number',
    description: 'Total score out of 100',
    displayMode: 'header',
    isMainMetric: true,
    role: 'metric',
    thresholds: { green: rubric.excellentThreshold, yellow: rubric.passThreshold },
  });

  // Dimensions
  for (const dim of rubric.dimensions) {
    const key = dim.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const greenThreshold = Math.round(dim.maxPoints * 0.8);
    const yellowThreshold = Math.round(dim.maxPoints * 0.5);
    fields.push({
      key,
      type: 'number',
      description: `${dim.name} (max ${dim.maxPoints})`,
      displayMode: 'card',
      isMainMetric: false,
      role: 'detail',
      thresholds: { green: greenThreshold, yellow: yellowThreshold },
    });
  }

  // Compliance gates
  for (const gate of rubric.complianceGates) {
    const key = 'compliance_' + gate.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    fields.push({
      key,
      type: 'boolean',
      description: gate,
      displayMode: 'card',
      isMainMetric: false,
      role: 'detail',
    });
  }

  // Reasoning
  fields.push({
    key: 'reasoning',
    type: 'text',
    description: 'Detailed critique per dimension with evidence',
    displayMode: 'hidden',
    isMainMetric: false,
    role: 'reasoning',
  });

  return fields;
}

/* ── Generate prompt from rubric ─────────────────────────── */

function generatePrompt(rubric: RubricData): string {
  let prompt = `You are an expert sales call quality evaluator. Evaluate the following call transcript against the scoring rubric below.

═══════════════════════════════════════════════════════════════════════════════
CALL TRANSCRIPT
═══════════════════════════════════════════════════════════════════════════════

{{transcript}}

═══════════════════════════════════════════════════════════════════════════════
SCORING RUBRIC — ${rubric.dimensions.length} DIMENSIONS
═══════════════════════════════════════════════════════════════════════════════

Score each dimension based on the checks below. Award points only when the check is clearly demonstrated in the transcript.

`;

  rubric.dimensions.forEach((dim, i) => {
    prompt += `${i + 1}. ${dim.name.toUpperCase()} (max ${dim.maxPoints} pts)\n`;
    if (dim.checks.length > 0) {
      dim.checks.forEach((check) => {
        prompt += `   - ${check.name} (${check.points} pts)\n`;
      });
    }
    prompt += '\n';
  });

  if (rubric.complianceGates.length > 0) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
COMPLIANCE GATES (instant flags — do NOT affect score but MUST be reported)
═══════════════════════════════════════════════════════════════════════════════

`;
    rubric.complianceGates.forEach((gate) => {
      const key = 'compliance_' + gate.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      prompt += `- ${key}: TRUE if the agent did NOT violate this gate. FALSE if they did.\n  Gate: ${gate}\n`;
    });
    prompt += '\n';
  }

  prompt += `═══════════════════════════════════════════════════════════════════════════════
SCORING INTERPRETATION
═══════════════════════════════════════════════════════════════════════════════

- ${rubric.excellentThreshold}-100: Strong
- ${rubric.passThreshold}-${rubric.excellentThreshold - 1}: Good
- ${Math.round(rubric.passThreshold * 0.75)}-${rubric.passThreshold - 1}: Needs work
- Below ${Math.round(rubric.passThreshold * 0.75)}: Poor

═══════════════════════════════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════════════════════════════

Score each dimension. Sum all dimension scores, normalize to 100, and provide as overall_score. For each compliance gate, report TRUE (passed) or FALSE (violated). In the reasoning field, provide a detailed critique for each dimension with specific transcript evidence.`;

  return prompt;
}

/* ── Component ───────────────────────────────────────────── */

export function RubricBuilder({ outputFields, onFieldsChange, onPromptGenerated }: RubricBuilderProps) {
  const [rubric, setRubric] = useState<RubricData>(() => {
    if (outputFields.length > 0) return parseOutputToRubric(outputFields);
    return {
      dimensions: [{ name: '', maxPoints: 10, checks: [] }],
      complianceGates: [],
      passThreshold: 65,
      excellentThreshold: 80,
    };
  });

  // Sync rubric changes to parent
  const syncToParent = useCallback((r: RubricData) => {
    onFieldsChange(rubricToOutputFields(r));
    onPromptGenerated(generatePrompt(r));
  }, [onFieldsChange, onPromptGenerated]);

  useEffect(() => {
    syncToParent(rubric);
  }, [rubric, syncToParent]);

  const updateRubric = useCallback((updater: (prev: RubricData) => RubricData) => {
    setRubric((prev) => updater(prev));
  }, []);

  // Dimension handlers
  const addDimension = () => {
    updateRubric((r) => ({
      ...r,
      dimensions: [...r.dimensions, { name: '', maxPoints: 10, checks: [] }],
    }));
  };

  const removeDimension = (idx: number) => {
    updateRubric((r) => ({
      ...r,
      dimensions: r.dimensions.filter((_, i) => i !== idx),
    }));
  };

  const updateDimension = (idx: number, updates: Partial<Dimension>) => {
    updateRubric((r) => ({
      ...r,
      dimensions: r.dimensions.map((d, i) => (i === idx ? { ...d, ...updates } : d)),
    }));
  };

  // Check handlers
  const addCheck = (dimIdx: number) => {
    updateRubric((r) => ({
      ...r,
      dimensions: r.dimensions.map((d, i) =>
        i === dimIdx ? { ...d, checks: [...d.checks, { name: '', points: 1 }] } : d
      ),
    }));
  };

  const removeCheck = (dimIdx: number, checkIdx: number) => {
    updateRubric((r) => ({
      ...r,
      dimensions: r.dimensions.map((d, i) =>
        i === dimIdx ? { ...d, checks: d.checks.filter((_, ci) => ci !== checkIdx) } : d
      ),
    }));
  };

  const updateCheck = (dimIdx: number, checkIdx: number, updates: Partial<Check>) => {
    updateRubric((r) => ({
      ...r,
      dimensions: r.dimensions.map((d, i) =>
        i === dimIdx
          ? {
              ...d,
              checks: d.checks.map((c, ci) => (ci === checkIdx ? { ...c, ...updates } : c)),
            }
          : d
      ),
    }));
  };

  // Compliance gate handlers
  const addGate = () => {
    updateRubric((r) => ({ ...r, complianceGates: [...r.complianceGates, ''] }));
  };

  const removeGate = (idx: number) => {
    updateRubric((r) => ({
      ...r,
      complianceGates: r.complianceGates.filter((_, i) => i !== idx),
    }));
  };

  const updateGate = (idx: number, value: string) => {
    updateRubric((r) => ({
      ...r,
      complianceGates: r.complianceGates.map((g, i) => (i === idx ? value : g)),
    }));
  };

  const totalPoints = rubric.dimensions.reduce((sum, d) => sum + d.maxPoints, 0);

  return (
    <div className="space-y-5">
      {/* Thresholds */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Scoring Thresholds</h3>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
              Pass Threshold
            </label>
            <Input
              type="number"
              value={rubric.passThreshold}
              onChange={(e) => updateRubric((r) => ({ ...r, passThreshold: parseInt(e.target.value, 10) || 0 }))}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
              Excellent Threshold
            </label>
            <Input
              type="number"
              value={rubric.excellentThreshold}
              onChange={(e) => updateRubric((r) => ({ ...r, excellentThreshold: parseInt(e.target.value, 10) || 0 }))}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
              Total Points
            </label>
            <div className="h-8 flex items-center text-xs font-mono text-[var(--text-secondary)]">
              {totalPoints}
            </div>
          </div>
        </div>
      </div>

      {/* Dimensions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Dimensions ({rubric.dimensions.length})
          </h3>
          <Button variant="secondary" size="sm" onClick={addDimension}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Dimension
          </Button>
        </div>

        <div className="space-y-3">
          {rubric.dimensions.map((dim, dimIdx) => (
            <div
              key={dimIdx}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3"
            >
              {/* Dimension header */}
              <div className="flex items-center gap-2 mb-2">
                <Input
                  value={dim.name}
                  onChange={(e) => updateDimension(dimIdx, { name: e.target.value })}
                  placeholder="Dimension name..."
                  className="h-8 text-xs flex-1"
                />
                <Input
                  type="number"
                  value={dim.maxPoints}
                  onChange={(e) => updateDimension(dimIdx, { maxPoints: parseInt(e.target.value, 10) || 0 })}
                  className="h-8 text-xs w-20"
                />
                <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">pts</span>
                <button
                  onClick={() => removeDimension(dimIdx)}
                  className="rounded p-1 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Checks */}
              <div className="space-y-1.5 ml-3">
                {dim.checks.map((check, checkIdx) => (
                  <div key={checkIdx} className="flex items-center gap-2">
                    <button
                      onClick={() => removeCheck(dimIdx, checkIdx)}
                      className="rounded p-0.5 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <input
                      value={check.name}
                      onChange={(e) => updateCheck(dimIdx, checkIdx, { name: e.target.value })}
                      placeholder="Check item..."
                      className="flex-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
                    />
                    <input
                      type="number"
                      value={check.points}
                      onChange={(e) => updateCheck(dimIdx, checkIdx, { points: parseInt(e.target.value, 10) || 0 })}
                      className="w-14 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-right font-mono text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
                    />
                    <span className="text-[10px] text-[var(--text-muted)]">pts</span>
                  </div>
                ))}
                <button
                  onClick={() => addCheck(dimIdx)}
                  className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-brand)] transition-colors mt-1"
                >
                  <Plus className="h-3 w-3" />
                  Add check
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Compliance Gates */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-red-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Compliance Gates ({rubric.complianceGates.length})
            </h3>
          </div>
          <Button variant="secondary" size="sm" onClick={addGate}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Gate
          </Button>
        </div>

        <div className="space-y-1.5">
          {rubric.complianceGates.map((gate, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              <input
                value={gate}
                onChange={(e) => updateGate(idx, e.target.value)}
                placeholder="e.g. No medical misinformation"
                className="flex-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
              />
              <button
                onClick={() => removeGate(idx)}
                className="rounded p-1 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
