/**
 * CSV Import modal for Inside Sales evaluators.
 * Parses CSV with columns: dimension, check, points
 * Compliance gates in [COMPLIANCE] section with column: gate
 */

import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, AlertTriangle } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { notificationService } from '@/services/notifications';
import { useEvaluatorsStore } from '@/stores';
import type { EvaluatorOutputField } from '@/types';

interface EvaluatorCSVImportProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void;
}

interface ParsedDimension {
  name: string;
  maxPoints: number;
  checks: { name: string; points: number }[];
}

interface ParseResult {
  dimensions: ParsedDimension[];
  complianceGates: string[];
  errors: string[];
}

function parseCSV(text: string): ParseResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const dimensions: ParsedDimension[] = [];
  const complianceGates: string[] = [];
  const errors: string[] = [];

  let inCompliance = false;
  let currentDim: ParsedDimension | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Header row
    if (i === 0 && (line.toLowerCase().startsWith('dimension') || line.toLowerCase().startsWith('gate'))) {
      continue;
    }

    // Compliance section marker
    if (line === '[COMPLIANCE]') {
      inCompliance = true;
      // Skip the "gate" header if next
      if (i + 1 < lines.length && lines[i + 1].toLowerCase() === 'gate') {
        i++;
      }
      continue;
    }

    if (inCompliance) {
      complianceGates.push(line);
      continue;
    }

    // Parse dimension,check,points
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 3) {
      errors.push(`Line ${i + 1}: expected 3 columns (dimension, check, points), got ${parts.length}`);
      continue;
    }

    const [dimName, checkName, pointsStr] = parts;
    const points = parseInt(pointsStr, 10);
    if (isNaN(points)) {
      errors.push(`Line ${i + 1}: invalid points value "${pointsStr}"`);
      continue;
    }

    if (!currentDim || currentDim.name !== dimName) {
      currentDim = { name: dimName, maxPoints: 0, checks: [] };
      dimensions.push(currentDim);
    }
    currentDim.checks.push({ name: checkName, points });
    currentDim.maxPoints += points;
  }

  return { dimensions, complianceGates, errors };
}

function buildOutputSchema(result: ParseResult): EvaluatorOutputField[] {
  const fields: EvaluatorOutputField[] = [];

  fields.push({
    key: 'overall_score',
    type: 'number',
    description: 'Total score out of 100',
    displayMode: 'header',
    isMainMetric: true,
    thresholds: { green: 80, yellow: 65 },
  });

  for (const dim of result.dimensions) {
    const key = dim.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    fields.push({
      key,
      type: 'number',
      description: `${dim.name} (max ${dim.maxPoints})`,
      displayMode: 'card',
      isMainMetric: false,
      thresholds: { green: Math.round(dim.maxPoints * 0.8), yellow: Math.round(dim.maxPoints * 0.5) },
    });
  }

  for (const gate of result.complianceGates) {
    const key = 'compliance_' + gate.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    fields.push({
      key,
      type: 'boolean',
      description: gate,
      displayMode: 'card',
      isMainMetric: false,
    });
  }

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

function buildPrompt(result: ParseResult): string {
  let prompt = `You are an expert sales call quality evaluator. Evaluate the following call transcript.

{{transcript}}

SCORING RUBRIC:

`;
  result.dimensions.forEach((dim, i) => {
    prompt += `${i + 1}. ${dim.name.toUpperCase()} (max ${dim.maxPoints} pts)\n`;
    dim.checks.forEach((c) => {
      prompt += `   - ${c.name} (${c.points} pts)\n`;
    });
    prompt += '\n';
  });

  if (result.complianceGates.length > 0) {
    prompt += 'COMPLIANCE GATES:\n';
    result.complianceGates.forEach((g) => {
      prompt += `- ${g}\n`;
    });
  }

  prompt += '\nScore each dimension. Normalize total to 100 as overall_score. Report compliance gates as TRUE/FALSE. Provide reasoning with evidence.';
  return prompt;
}

export function EvaluatorCSVImport({ isOpen, onClose, onImported }: EvaluatorCSVImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const addEvaluator = useEvaluatorsStore((state) => state.addEvaluator);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCSV(text);
      setParsed(result);
      setName(file.name.replace(/\.csv$/i, ''));
    };
    reader.readAsText(file);
  }, []);

  const handleImport = useCallback(async () => {
    if (!parsed || !name.trim()) return;

    setIsSaving(true);
    try {
      const outputSchema = buildOutputSchema(parsed);
      const prompt = buildPrompt(parsed);

      await addEvaluator({
        id: '',
        name: name.trim(),
        prompt,
        modelId: '',
        outputSchema,
        appId: 'inside-sales',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      notificationService.success('Evaluator imported from CSV');
      onImported?.();
      onClose();
      setParsed(null);
      setName('');
    } catch {
      notificationService.error('Failed to import evaluator');
    } finally {
      setIsSaving(false);
    }
  }, [addEvaluator, parsed, name, onImported, onClose]);

  const handleClose = () => {
    setParsed(null);
    setName('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import Evaluator from CSV">
      <div className="space-y-4">
        {/* File upload */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Choose CSV File
          </Button>
          <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
            Format: <code className="text-[10px]">dimension,check,points</code> rows.
            Add <code className="text-[10px]">[COMPLIANCE]</code> section for gates.
          </p>
        </div>

        {/* Preview */}
        {parsed && (
          <>
            {parsed.errors.length > 0 && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-amber-400">Parse Warnings</span>
                </div>
                <ul className="text-[11px] text-[var(--text-muted)] space-y-0.5">
                  {parsed.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
                Evaluator Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
              />
            </div>

            <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <span className="text-xs font-medium text-[var(--text-primary)]">Preview</span>
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] space-y-1">
                <p>{parsed.dimensions.length} dimensions, {parsed.dimensions.reduce((s, d) => s + d.maxPoints, 0)} total points</p>
                {parsed.dimensions.map((d, i) => (
                  <p key={i} className="ml-2">
                    {d.name}: {d.checks.length} checks, {d.maxPoints} pts
                  </p>
                ))}
                {parsed.complianceGates.length > 0 && (
                  <p>{parsed.complianceGates.length} compliance gates</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleImport} disabled={!name.trim() || isSaving}>
                Import
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
