/**
 * EvaluatorPreviewOverlay — read-only preview of evaluator details (built-in or custom).
 *
 * Renders in a portal so it stacks above parent overlays like BatchCustomEvaluatorPicker.
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check } from 'lucide-react';
import { cn } from '@/utils';
import type { EvaluatorDefinition } from '@/types';
import type { EvaluatorToggles } from './EvaluatorToggleStep';

interface EvaluatorPreviewOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  evaluator?: EvaluatorDefinition | null;
  builtinKey?: keyof EvaluatorToggles | null;
}

// ── Built-in evaluator static metadata ──────────────────────────────────────

interface BuiltinEvaluatorDetail {
  name: string;
  description: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
}

const BUILTIN_EVALUATOR_DETAILS: Record<keyof EvaluatorToggles, BuiltinEvaluatorDetail> = {
  intent: {
    name: 'Intent Evaluation',
    description: 'Classify user intents and measure accuracy against expected labels. Evaluates each message independently using the system prompt to determine the correct intent category.',
    prompt: `{history_context}
User Query: "{message.query_text}"

Classify this query according to the system prompt. Return a JSON response with your
independent classification — do NOT guess or assume what the production system chose.`,
    outputSchema: {
      type: 'object',
      properties: {
        predicted_agent: { type: 'string', description: 'The predicted intent/agent category' },
        query_type: { type: 'string', description: 'The query type classification' },
        confidence: { type: 'number', description: 'Confidence score (0-1)' },
        reasoning: { type: 'string', description: 'Explanation of the classification' },
        all_predictions: { type: 'object', description: 'Full prediction map across all intents' },
      },
      required: ['predicted_agent', 'query_type', 'confidence', 'reasoning'],
    },
  },
  correctness: {
    name: 'Correctness Evaluation',
    description: 'Verify factual correctness, calorie sanity, and rule compliance. Evaluates each bot response for nutritional accuracy, arithmetic consistency, and food-quantity coherence.',
    prompt: `You are a strict nutritional accuracy auditor for a health chatbot.
You will receive a USER INPUT and the BOT RESPONSE. Your job is to evaluate whether the
meal summary in the bot response is factually defensible.

## IMPORTANT: Image-based meals
When the user message is tagged with [IMAGE ATTACHED], the user sent a photo of their food.
The bot analyzed the image to identify foods and quantities — you do NOT have access to the
original image. In these cases:
- You CANNOT verify food-quantity coherence (Check 3).
- You CAN still check calorie sanity (Check 1) and arithmetic consistency (Check 2).
- Only fail image-based meals for genuinely implausible calorie values or broken arithmetic.

## Checks to perform

### 1. Calorie Sanity
- Is the total calorie value plausible for the foods and quantities described?
- A single food item should rarely exceed 2000 Kcal.
- A single meal total should rarely exceed 4000 Kcal.

### 2. Internal Arithmetic Consistency
- Do the per-item calorie values add up to the stated total? (tolerance ±15 Kcal or ±5%)
- Do the macros roughly account for the calories? Protein×4 + Carbs×4 + Fat×9 ≈ Total (±20%)

### 3. Food-Quantity Coherence
- Does the quantity shown in the response match what the user stated?
- SKIP this check if the user message has [IMAGE ATTACHED].

## Verdict
- PASS — All applicable checks pass.
- SOFT_FAIL — Minor issues.
- HARD_FAIL — Clear nutritional inaccuracy.
- CRITICAL — Order-of-magnitude calorie error or dangerous mis-statement.
- NOT_APPLICABLE — The bot response is NOT a meal summary.`,
    outputSchema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['PASS', 'SOFT_FAIL', 'HARD_FAIL', 'CRITICAL', 'NOT_APPLICABLE'] },
        calorie_sanity: {
          type: 'object',
          properties: {
            plausible: { type: 'boolean' },
            stated_total_kcal: { type: 'number' },
            expected_range_low: { type: 'number' },
            expected_range_high: { type: 'number' },
            reason: { type: 'string' },
          },
        },
        arithmetic_consistency: {
          type: 'object',
          properties: {
            consistent: { type: 'boolean' },
            items_sum_kcal: { type: 'number' },
            stated_total_kcal: { type: 'number' },
            macro_calories_estimate: { type: 'number' },
            reason: { type: 'string' },
          },
        },
        quantity_coherence: {
          type: 'object',
          properties: {
            coherent: { type: 'boolean' },
            mismatches: { type: 'array', items: { type: 'string' } },
          },
        },
        reasoning: { type: 'string' },
        rule_compliance: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rule_id: { type: 'string' },
              followed: { type: 'boolean' },
              evidence: { type: 'string' },
            },
          },
        },
      },
      required: ['verdict', 'calorie_sanity', 'arithmetic_consistency', 'quantity_coherence', 'reasoning', 'rule_compliance'],
    },
  },
  efficiency: {
    name: 'Efficiency Evaluation',
    description: 'Assess conversation flow, friction points, and task completion. Evaluates the entire conversation thread for efficiency, identifying bot-caused friction and recovery quality.',
    prompt: `You are an expert conversation-quality auditor for a health-assistant chatbot
that logs meals. You will receive a COMPLETE conversation thread (all turns, in order).

## Context about this chatbot
- The ideal meal-logging flow is 2 turns: user describes food → bot shows summary + confirm chip → done.
- Extra turns may happen because:
  (a) The user genuinely didn't provide required info — ACCEPTABLE friction.
  (b) The bot failed to parse the user's input correctly — BOT friction.
  (c) The bot produced wrong calorie / nutrition values — BOT friction.
  (d) The bot showed wrong foods, quantities, or duplicated items — BOT friction.

## Evaluation tasks

### 1. Task Completion
Did the user achieve what they wanted?

### 2. Friction Analysis
For each turn beyond the first two, determine: user caused or bot caused?

### 3. Recovery Quality
When the user corrected the bot, did it fix the issue?

### 4. Abandonment Root Cause
If conversation ended WITHOUT successful logging, why?

## Verdict
- EFFICIENT — ≤2 turns, clean completion.
- ACCEPTABLE — Extra turns, but ALL caused by genuinely missing user info.
- FRICTION — At least one extra turn caused by bot error.
- BROKEN — User correction wasn't applied, or abandoned due to bot failure.`,
    outputSchema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['EFFICIENT', 'ACCEPTABLE', 'FRICTION', 'BROKEN'] },
        task_completed: { type: 'boolean' },
        friction_turns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              turn: { type: 'integer' },
              cause: { type: 'string', enum: ['user', 'bot'] },
              description: { type: 'string' },
            },
          },
        },
        recovery_quality: { type: 'string', enum: ['good', 'partial', 'failed', 'not_needed'] },
        abandonment_reason: { type: 'string' },
        reasoning: { type: 'string' },
        rule_compliance: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rule_id: { type: 'string' },
              followed: { type: 'boolean' },
              evidence: { type: 'string' },
            },
          },
        },
      },
      required: ['verdict', 'task_completed', 'friction_turns', 'recovery_quality', 'abandonment_reason', 'reasoning', 'rule_compliance'],
    },
  },
};

// ── Prompt text with highlighted {{variables}} ──────────────────────────────

function HighlightedPrompt({ text }: { text: string }) {
  const parts = text.split(/({{[^}]+}}|\{[^}]+\})/g);
  return (
    <pre className="whitespace-pre-wrap text-[12px] leading-relaxed font-mono text-[var(--text-secondary)]">
      {parts.map((part, i) =>
        /^\{/.test(part) ? (
          <span
            key={i}
            className="bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-accent)] rounded px-1 py-0.5"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </pre>
  );
}

// ── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Main overlay ────────────────────────────────────────────────────────────

export function EvaluatorPreviewOverlay({
  isOpen,
  onClose,
  evaluator,
  builtinKey,
}: EvaluatorPreviewOverlayProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // Capture-phase Escape so parent overlays don't also close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown, true);
      return () => document.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const isBuiltin = !!builtinKey;
  const builtin = builtinKey ? BUILTIN_EVALUATOR_DETAILS[builtinKey] : null;

  const name = isBuiltin ? builtin!.name : evaluator?.name ?? '';
  const description = isBuiltin ? builtin!.description : '';
  const promptText = isBuiltin ? builtin!.prompt : evaluator?.prompt ?? '';
  const typeBadge = isBuiltin ? 'Built-in' : 'Custom';

  const content = (
    <div className="fixed inset-0 z-[60] flex">
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/20 backdrop-blur-[2px] transition-opacity duration-300',
          isVisible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          'ml-auto relative z-10 h-full w-[650px] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden',
          'flex flex-col',
          'transform transition-transform duration-300 ease-out',
          isVisible ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] truncate">
              {name}
            </h2>
            <span
              className={cn(
                'shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium',
                isBuiltin
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
              )}
            >
              {typeBadge}
            </span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Description */}
          {description && (
            <section>
              <h3 className="text-[13px] font-medium text-[var(--text-primary)] mb-2">Description</h3>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{description}</p>
            </section>
          )}

          {/* Configuration (custom only) */}
          {!isBuiltin && evaluator && (
            <section>
              <h3 className="text-[13px] font-medium text-[var(--text-primary)] mb-2">Configuration</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
                  <div className="text-[11px] text-[var(--text-muted)] mb-0.5">Model</div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">{evaluator.modelId}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
                  <div className="text-[11px] text-[var(--text-muted)] mb-0.5">Registry</div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    {evaluator.isGlobal ? 'Global' : 'Local'}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
                  <div className="text-[11px] text-[var(--text-muted)] mb-0.5">Created</div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    {new Date(evaluator.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Prompt */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-medium text-[var(--text-primary)]">Prompt</h3>
              <CopyButton text={promptText} />
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 max-h-[400px] overflow-y-auto">
              <HighlightedPrompt text={promptText} />
            </div>
          </section>

          {/* Output Schema */}
          <section>
            <h3 className="text-[13px] font-medium text-[var(--text-primary)] mb-2">Output Schema</h3>

            {isBuiltin && builtin ? (
              /* Built-in: render JSON schema in code block */
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 max-h-[350px] overflow-y-auto">
                <pre className="whitespace-pre-wrap text-[12px] leading-relaxed font-mono text-[var(--text-secondary)]">
                  {JSON.stringify(builtin.outputSchema, null, 2)}
                </pre>
              </div>
            ) : evaluator?.outputSchema && evaluator.outputSchema.length > 0 ? (
              /* Custom: render field table */
              <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
                      <th className="text-left px-3 py-2 font-medium text-[var(--text-muted)]">Key</th>
                      <th className="text-left px-3 py-2 font-medium text-[var(--text-muted)]">Type</th>
                      <th className="text-left px-3 py-2 font-medium text-[var(--text-muted)]">Display</th>
                      <th className="text-left px-3 py-2 font-medium text-[var(--text-muted)]">Thresholds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluator.outputSchema.map((field) => (
                      <tr key={field.key} className="border-b border-[var(--border-subtle)] last:border-b-0">
                        <td className="px-3 py-2">
                          <code className="text-[12px] font-mono text-[var(--text-primary)]">{field.key}</code>
                          {field.isMainMetric && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                              main
                            </span>
                          )}
                          {field.description && (
                            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{field.description}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{field.type}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{field.displayMode}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">
                          {field.thresholds ? (
                            <span className="text-[11px]">
                              <span className="text-green-600">≥{field.thresholds.green}</span>
                              {' / '}
                              <span className="text-yellow-600">≥{field.thresholds.yellow}</span>
                            </span>
                          ) : (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[13px] text-[var(--text-muted)] italic">No output schema defined.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
