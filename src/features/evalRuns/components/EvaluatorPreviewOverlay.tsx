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
      description: 'Intent classification result for a single user query, including predicted agent, query type, confidence, and reasoning.',
      properties: {
        predicted_agent: { type: 'string', description: 'The predicted intent/agent category for this user query. Must be one of the allowed agent values from the system prompt.' },
        query_type: { type: 'string', description: 'The query type classification (e.g. "logging" for recording data, "question" for asking information).' },
        confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0 indicating how certain the classification is.' },
        reasoning: { type: 'string', description: 'Brief explanation of why this agent and query type were chosen, citing specific query keywords or context.' },
        all_predictions: { type: 'object', description: 'Optional map of all considered agent categories to their confidence scores. Keys are agent names, values are floats 0.0-1.0.' },
      },
      required: ['predicted_agent', 'query_type', 'confidence', 'reasoning'],
    },
  },
  correctness: {
    name: 'Correctness Evaluation',
    description: 'Verify factual correctness, calorie sanity, and rule compliance. Evaluates each bot response for nutritional accuracy, arithmetic consistency, and food-quantity coherence.',
    prompt: `You are a nutritional-accuracy auditor for a health-assistant chatbot that logs meals.

You will receive a USER INPUT and the BOT RESPONSE. Your job is to produce a structured evaluation of the meal summary's factual correctness.

IMAGE-BASED MEALS

When the user message is tagged with [IMAGE ATTACHED], the user sent a photo of their food. The bot analysed the image to identify foods and quantities — you do NOT have access to the original image. In these cases:
- You CANNOT verify food-quantity coherence (Check 3) because the ground truth is in the image, not in the text.
- You CANNOT flag food names as "hallucinated" or "mismatched" — the bot identified them from the image.
- You CAN still check calorie sanity (Check 1) and arithmetic consistency (Check 2).
- If the calories and arithmetic are plausible, verdict should be PASS even if the user text is vague (e.g. "Log this meal for me").
- Only fail image-based meals for genuinely implausible calorie values or broken arithmetic.

CHECKS TO PERFORM

1. CALORIE SANITY
- Is the total calorie value plausible for the foods and quantities described?
- A single food item should rarely exceed 2000 Kcal.
- A single meal total should rarely exceed 4000 Kcal.
- Values like 10,000+ Kcal for everyday foods are ALWAYS wrong.

2. INTERNAL ARITHMETIC CONSISTENCY
- Do the per-item calorie values add up to the stated total? (tolerance ±15 Kcal or ±5%, whichever is larger)
- Do the macros roughly account for the calories? Protein×4 + Carbs×4 + Fat×9 ≈ Total Calories (tolerance ±20%).

3. FOOD-QUANTITY COHERENCE
- Does the quantity shown in the response match what the user stated?
- SKIP this check if the user message has [IMAGE ATTACHED] — food names come from the image, not text.

VERDICT CRITERIA

Apply exactly one verdict. Do not interpolate between levels.

- PASS: All applicable checks pass. Calories plausible, arithmetic consistent, quantities match.
- SOFT_FAIL: Minor issues that do not materially affect the user (e.g. rounding error within tolerance, slightly unusual but defensible calorie estimate).
- HARD_FAIL: Clear nutritional inaccuracy. Wrong food item, significant calorie miscalculation, or quantity mismatch.
- CRITICAL: Order-of-magnitude calorie error (e.g. 100 Kcal shown for a 1000 Kcal meal) or dangerous mis-statement that could harm the user.
- NOT_APPLICABLE: The bot response is NOT a meal summary (no nutrition data present).

RULE COMPLIANCE

Evaluate whether the bot response follows each production prompt rule provided in the evaluation prompt. Include one rule_compliance entry per rule. Do not omit any rule. Do not invent rules not listed.

OUTPUT FORMAT

Return strictly valid JSON with no surrounding text, no markdown fencing, no commentary. Every field is required.`,
    outputSchema: {
      type: 'object',
      description: 'Structured evaluation of a single bot response\'s nutritional correctness, covering calorie sanity, arithmetic consistency, food-quantity coherence, and production rule compliance.',
      properties: {
        verdict: {
          type: 'string',
          enum: ['PASS', 'SOFT_FAIL', 'HARD_FAIL', 'CRITICAL', 'NOT_APPLICABLE'],
          description: 'Overall correctness verdict. PASS: all checks pass. SOFT_FAIL: minor issues within tolerance. HARD_FAIL: clear nutritional inaccuracy. CRITICAL: order-of-magnitude error or dangerous mis-statement. NOT_APPLICABLE: response is not a meal summary.',
        },
        calorie_sanity: {
          type: 'object',
          description: 'Whether the total calorie value is plausible for the foods and quantities described.',
          properties: {
            plausible: { type: 'boolean', description: 'True if the stated total calories fall within a reasonable range for the described meal.' },
            stated_total_kcal: { type: 'number', description: 'The total calorie value stated in the bot response. Null if not present.' },
            expected_range_low: { type: 'number', description: 'Lower bound of the plausible calorie range for this meal. Null if not estimable.' },
            expected_range_high: { type: 'number', description: 'Upper bound of the plausible calorie range for this meal. Null if not estimable.' },
            reason: { type: 'string', description: 'One sentence explaining why the calorie value is or is not plausible.' },
          },
        },
        arithmetic_consistency: {
          type: 'object',
          description: 'Whether per-item calories sum to the stated total and macros roughly account for the calories.',
          properties: {
            consistent: { type: 'boolean', description: 'True if item-level calories sum to the stated total within tolerance (±15 Kcal or ±5%).' },
            items_sum_kcal: { type: 'number', description: 'Sum of all per-item calorie values listed in the response. Null if not computable.' },
            stated_total_kcal: { type: 'number', description: 'The total calorie value stated in the bot response. Null if not present.' },
            macro_calories_estimate: { type: 'number', description: 'Estimated calories from macros: Protein×4 + Carbs×4 + Fat×9. Null if macros not provided.' },
            reason: { type: 'string', description: 'One sentence explaining the arithmetic check result.' },
          },
        },
        quantity_coherence: {
          type: 'object',
          description: 'Whether the quantities in the bot response match what the user stated. Skipped for image-based meals.',
          properties: {
            coherent: { type: 'boolean', description: 'True if all quantities in the response match the user\'s stated amounts. Always true for image-based meals.' },
            mismatches: { type: 'array', items: { type: 'string' }, description: 'List of specific quantity mismatches found. Empty array if coherent.' },
          },
        },
        reasoning: { type: 'string', description: 'Two to three sentence overall assessment covering what was checked and the key finding.' },
        rule_compliance: {
          type: 'array',
          description: 'One entry per production rule provided in the prompt. Every rule must be evaluated.',
          items: {
            type: 'object',
            description: 'Compliance check for a single production rule.',
            properties: {
              rule_id: { type: 'string', description: 'The exact rule_id as provided in the rules list.' },
              followed: { type: 'boolean', description: 'True if the bot followed this rule. False if it violated the rule.' },
              evidence: { type: 'string', description: 'One sentence citing specific content as evidence.' },
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
    prompt: `You are a conversation-quality auditor for a health-assistant chatbot that logs meals.

You will receive a complete conversation thread. Your job is to produce a structured evaluation of the conversation's efficiency, task outcome, and rule compliance.

CONTEXT

The ideal meal-logging flow completes in 2 turns: the user describes food, the bot shows a summary with confirmation action chips, done. Any turn beyond that is friction. Friction is either justified (user failed to provide required information) or unjustified (bot made an error).

CORRECT BOT BEHAVIORS (do NOT count as friction):
- Asking for meal time when the user did not provide one
- Asking for quantity when the user's description is ambiguous
- Rejecting a future meal time
- Asking what food the user wants to log when only quantity or time was given
- Treating a composite dish (e.g. "porridge with almonds and honey") as a single item
- Asking for confirmation before logging

BOT ERRORS (count as friction, cause = "bot"):
- Re-asking for time or quantity that the user already provided
- Accepting a future meal time without questioning it
- Guessing or assuming a food item when the user only gave quantity or time
- Splitting a composite dish into separate line items
- Showing incorrect calorie values or extracting the wrong food
- Ignoring a user correction or repeating the same mistake after correction

EVALUATION TASKS

1. TASK COMPLETION
Determine whether the user's intended action completed correctly. A task is complete ONLY when the correct data was logged. If the bot said "logged" but used wrong quantities, wrong foods, or ignored a user correction, task_completed MUST be false.

2. FRICTION ANALYSIS
For every turn after the first two, assign cause "user" or "bot" with a one-sentence description. If a turn exists only because the bot made an error in the previous turn, cause is "bot".

3. RECOVERY QUALITY
If the user corrected the bot at any point during the conversation:
- "good": Bot applied the correction immediately and correctly in the next response.
- "partial": Bot fixed some aspects but not all, or needed multiple attempts.
- "failed": Bot ignored the correction, repeated the same error, or introduced a new one.
- "not_needed": The user never corrected the bot.

4. FAILURE REASON
If task_completed is false, state the specific root cause in one sentence. If task_completed is true, return an empty string. Do not speculate; describe only what is observable in the transcript.

VERDICT CRITERIA

Apply exactly one verdict per the rules below. Do not interpolate between levels. Evaluate both axes independently: (1) did the bot make errors? (2) did the task complete?

- EFFICIENT: Task completed correctly in 2 turns or fewer. No friction of any kind. Bot behaved correctly.
- ACCEPTABLE: Task completed correctly but took more than 2 turns. Every extra turn was caused by the user not providing required information. The bot behaved correctly throughout.
- INCOMPLETE: Task did NOT complete, but the bot made NO errors in the available turns. The conversation data is truncated, the user chose not to continue (e.g. clicked edit then stopped), or the user abandoned for reasons unrelated to bot behavior. Use this when there is no evidence of bot error causing the incompletion.
- FRICTION: At least one extra turn was caused by a bot error, but the conversation eventually recovered and reached a correct outcome, or the bot error did not prevent task completion.
- BROKEN: A bot error directly caused task failure. The bot ignored a user correction and persisted the same error, OR the bot logged incorrect data despite the user pointing out the mistake, OR the user abandoned the conversation because the bot could not recover from its own error. Requires evidence of bot error in the transcript.

OUTPUT FORMAT

Return strictly valid JSON with no surrounding text, no markdown fencing, no commentary. Every field is required.`,
    outputSchema: {
      type: 'object',
      description: 'Structured evaluation of a single conversation thread\'s efficiency, task outcome, friction, recovery, and rule compliance.',
      properties: {
        verdict: {
          type: 'string',
          enum: ['EFFICIENT', 'ACCEPTABLE', 'INCOMPLETE', 'FRICTION', 'BROKEN'],
          description: 'Overall efficiency verdict. EFFICIENT: completed correctly in 2 or fewer turns. ACCEPTABLE: extra turns all caused by user, task completed. INCOMPLETE: task did not complete but no bot error is present. FRICTION: at least one bot-caused extra turn but task completed. BROKEN: bot error directly caused task failure.',
        },
        task_completed: {
          type: 'boolean',
          description: 'True ONLY if the user\'s intended action completed with correct data. False if the bot logged wrong data, ignored a correction, or the conversation ended without achieving the goal.',
        },
        friction_turns: {
          type: 'array',
          description: 'One entry per turn beyond the first two. Empty array if conversation was 2 turns or fewer.',
          items: {
            type: 'object',
            description: 'A single friction turn analysis.',
            properties: {
              turn: { type: 'integer', description: 'The 1-based turn number in the conversation.' },
              cause: { type: 'string', enum: ['user', 'bot'], description: 'Who caused this extra turn.' },
              description: { type: 'string', description: 'One sentence explaining why this turn was needed.' },
            },
          },
        },
        recovery_quality: {
          type: 'string',
          enum: ['good', 'partial', 'failed', 'not_needed'],
          description: 'How well the bot recovered after a user correction.',
        },
        failure_reason: {
          type: 'string',
          description: 'If task_completed is false, one sentence stating the root cause. If true, empty string.',
        },
        reasoning: {
          type: 'string',
          description: 'Two to three sentence assessment of the overall conversation quality.',
        },
        rule_compliance: {
          type: 'array',
          description: 'One entry per production rule provided in the prompt. Every rule must be evaluated.',
          items: {
            type: 'object',
            description: 'Compliance check for a single production rule.',
            properties: {
              rule_id: { type: 'string', description: 'The exact rule_id as provided in the rules list.' },
              followed: { type: 'boolean', description: 'True if the bot followed this rule throughout the conversation.' },
              evidence: { type: 'string', description: 'One sentence citing specific turn(s) or bot behavior as evidence.' },
            },
          },
        },
      },
      required: ['verdict', 'task_completed', 'friction_turns', 'recovery_quality', 'failure_reason', 'reasoning', 'rule_compliance'],
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
          'ml-auto relative z-10 h-full w-[var(--overlay-width-md)] max-w-[85vw] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden',
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
                  : 'bg-[var(--color-accent-purple)]/10 text-[var(--color-accent-purple)]',
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
