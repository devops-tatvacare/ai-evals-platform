# LLM Evaluation System - Implementation Plan

## Overview

Implement a two-call LLM evaluation system with:
1. **Call 1 (Transcription)**: Audio → AI Transcript
2. **Call 2 (Critique)**: Audio + Original + AI Transcript → Per-segment critique

Template variables (`{{audio}}`, `{{transcript}}`, etc.) with availability checking.

---

## Phase 1: Structure & Foundation

### 1.1 Type Definitions

**File: `src/types/eval.types.ts`** (extend existing)

```typescript
// Add these types

export interface SegmentCritique {
  segmentIndex: number;
  originalText: string;
  llmText: string;
  critique: string;
  severity: 'none' | 'minor' | 'moderate' | 'critical';
  category?: string; // e.g., 'dosage', 'speaker', 'medical-term'
}

export interface EvaluationCritique {
  segments: SegmentCritique[];
  overallAssessment: string;
  generatedAt: Date;
  model: string;
}

// Update AIEvaluation interface
export interface AIEvaluation {
  id: string;
  createdAt: Date;
  model: string;
  status: EvalStatus;
  // Call 1 result
  llmTranscript?: TranscriptData;
  // Call 2 result (NEW)
  critique?: EvaluationCritique;
  // Programmatic comparison
  comparison?: TranscriptComparison;
  error?: string;
  // Track which call failed
  failedAt?: 'transcription' | 'critique';
}
```

**File: `src/types/template.types.ts`** (NEW)

```typescript
export type TemplateVariableType = 'text' | 'file' | 'computed';

export interface TemplateVariable {
  key: string;           // e.g., '{{audio}}'
  type: TemplateVariableType;
  description: string;
  availableIn: ('transcription' | 'evaluation' | 'extraction')[];
}

export interface TemplateVariableStatus {
  key: string;
  available: boolean;
  reason?: string;       // Why unavailable
  value?: string | Blob; // Resolved value if available
}

export interface PromptValidationResult {
  isValid: boolean;
  variables: TemplateVariableStatus[];
  missingRequired: string[];
  unknownVariables: string[];
}
```

---

### 1.2 Template Variable System

**File: `src/services/templates/variableRegistry.ts`** (NEW)

```typescript
// Central registry of all template variables
export const TEMPLATE_VARIABLES: Record<string, TemplateVariable> = {
  '{{audio}}': {
    key: '{{audio}}',
    type: 'file',
    description: 'Audio file for transcription/evaluation',
    availableIn: ['transcription', 'evaluation'],
  },
  '{{transcript}}': {
    key: '{{transcript}}',
    type: 'text',
    description: 'Original transcript text',
    availableIn: ['evaluation', 'extraction'],
  },
  '{{llm_transcript}}': {
    key: '{{llm_transcript}}',
    type: 'computed',
    description: 'AI-generated transcript (from Call 1)',
    availableIn: ['evaluation'],
  },
  // Extensible: add more variables here
};

export function getAvailableVariables(promptType: string): TemplateVariable[];
export function validatePrompt(prompt: string, context: VariableContext): PromptValidationResult;
export function resolveVariables(prompt: string, context: VariableContext): ResolvedPrompt;
```

**File: `src/services/templates/variableResolver.ts`** (NEW)

```typescript
// Resolves variables from listing/evaluation context
export interface VariableContext {
  listing: Listing;
  aiEval?: AIEvaluation;
  audioBlob?: Blob;
}

export function resolveVariable(
  key: string, 
  context: VariableContext
): TemplateVariableStatus;

export function resolveAllVariables(
  prompt: string,
  context: VariableContext
): Map<string, TemplateVariableStatus>;
```

**File: `src/services/templates/index.ts`** (NEW)

```typescript
export * from './variableRegistry';
export * from './variableResolver';
```

---

### 1.3 Settings Schema Update

**File: `src/features/settings/schema/settingsSchema.ts`** (modify)

```typescript
// Add evaluationPrompt to LLM settings
llm: {
  apiKey: string;
  selectedModel: string;
  transcriptionPrompt: string;  // existing
  evaluationPrompt: string;     // NEW - for Call 2
  extractionPrompt: string;     // existing
}
```

**Default Evaluation Prompt:**
```
You are evaluating a medical transcription for accuracy.

ORIGINAL TRANSCRIPT:
{{transcript}}

AI-GENERATED TRANSCRIPT:
{{llm_transcript}}

AUDIO REFERENCE: {{audio}}

For each segment, compare the original with the AI-generated version.
Provide a JSON response with:
{
  "segments": [
    {
      "segmentIndex": 0,
      "critique": "Description of any differences or issues",
      "severity": "none|minor|moderate|critical",
      "category": "optional category like 'dosage', 'speaker-id', 'medical-term'"
    }
  ],
  "overallAssessment": "Summary of transcription quality"
}
```

---

### 1.4 Evaluation Service Refactor

**File: `src/services/llm/evaluationService.ts`** (NEW - extract from hook)

```typescript
export interface TranscriptionResult {
  transcript: TranscriptData;
  rawResponse: string;
}

export interface CritiqueResult {
  critique: EvaluationCritique;
  rawResponse: string;
}

export interface EvaluationProgress {
  stage: 'preparing' | 'transcribing' | 'critiquing' | 'comparing' | 'complete' | 'failed';
  message: string;
  callNumber?: 1 | 2;
}

export class EvaluationService {
  // Call 1: Transcription
  async transcribe(
    audioBlob: Blob,
    mimeType: string,
    prompt: string,
    onProgress: (progress: EvaluationProgress) => void
  ): Promise<TranscriptionResult>;

  // Call 2: Critique
  async critique(
    context: {
      audioBlob: Blob;
      mimeType: string;
      originalTranscript: TranscriptData;
      llmTranscript: TranscriptData;
    },
    prompt: string,
    onProgress: (progress: EvaluationProgress) => void
  ): Promise<CritiqueResult>;

  // Full evaluation (both calls + metrics)
  async evaluate(
    listing: Listing,
    prompts: { transcription: string; evaluation: string },
    onProgress: (progress: EvaluationProgress) => void
  ): Promise<AIEvaluation>;
}
```

---

### 1.5 State Management Updates

**File: `src/stores/taskQueueStore.ts`** (modify)

```typescript
// Update task type to track call number
export interface LLMTask {
  // ... existing fields
  callNumber?: 1 | 2;  // NEW: which call in evaluation flow
  stage?: string;      // NEW: current stage
}
```

---

### 1.6 Debug Panel Integration

**File: `src/services/logger/evaluationLogger.ts`** (NEW)

```typescript
// Specialized logging for evaluation flow
export function logEvaluationStart(listingId: string, prompts: { transcription: string; evaluation: string });
export function logCall1Start(listingId: string);
export function logCall1Complete(listingId: string, segmentCount: number);
export function logCall1Failed(listingId: string, error: string);
export function logCall2Start(listingId: string);
export function logCall2Complete(listingId: string, critiqueCount: number);
export function logCall2Failed(listingId: string, error: string);
export function logEvaluationComplete(listingId: string, metrics: { wer: number; cer: number });
```

---

### Phase 1 Checklist

- [ ] 1.1 Add type definitions (`SegmentCritique`, `EvaluationCritique`, update `AIEvaluation`)
- [ ] 1.2 Create template types (`TemplateVariable`, `TemplateVariableStatus`, etc.)
- [ ] 1.3 Create `src/services/templates/` folder with registry and resolver
- [ ] 1.4 Update settings schema with `evaluationPrompt`
- [ ] 1.5 Update settings store with default evaluation prompt
- [ ] 1.6 Create `EvaluationService` class (extract from hook)
- [ ] 1.7 Update task queue store for call tracking
- [ ] 1.8 Create evaluation logger utilities
- [ ] 1.9 Build and test types compile correctly

---

## Phase 2: Implementation & UI

### 2.1 Settings UI Update

**File: `src/features/settings/components/SettingsPage.tsx`** (modify)

Add Evaluation Prompt section in Prompts tab:
- Textarea for evaluation prompt
- Show available variables: `{{audio}}`, `{{transcript}}`, `{{llm_transcript}}`
- Variable chip/badge UI showing which are available

**File: `src/features/settings/components/VariableChips.tsx`** (NEW)

```typescript
// Reusable component showing available variables for a prompt type
interface VariableChipsProps {
  promptType: 'transcription' | 'evaluation' | 'extraction';
  onInsert?: (variable: string) => void;
}
```

---

### 2.2 Evaluation Modal

**File: `src/features/evals/components/EvaluationModal.tsx`** (NEW)

```
┌─────────────────────────────────────────────────────────────────────┐
│ AI Evaluation                                               [X]     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Step 1: Transcription Prompt                      [Reset to Default]│
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ [editable textarea with prompt]                                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ Variables: ✓ {{audio}}                                              │
│                                                                     │
│ Step 2: Evaluation Prompt                         [Reset to Default]│
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ [editable textarea with prompt]                                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ Variables: ✓ {{audio}}  ✓ {{transcript}}  ⏳ {{llm_transcript}}     │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ ⚠️ {{unknown_var}} is not a recognized variable                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│                                         [Cancel]  [Run Evaluation]  │
└─────────────────────────────────────────────────────────────────────┘
```

Features:
- Load defaults from settings
- Validate variables in real-time
- Show variable availability status
- Disable "Run" if required variables missing

---

### 2.3 Update AIEvalRequest Component

**File: `src/features/evals/components/AIEvalRequest.tsx`** (modify)

- "Request AI Evaluation" → Opens `EvaluationModal`
- "Rerun Evaluation" → Opens `EvaluationModal` (same)
- Show progress with call indication: "Call 1/2: Transcribing..." or "Call 2/2: Critiquing..."

---

### 2.4 Update useAIEvaluation Hook

**File: `src/features/evals/hooks/useAIEvaluation.ts`** (modify)

```typescript
export function useAIEvaluation() {
  // Update to use EvaluationService
  // Accept prompts parameter
  // Track call number in progress
  
  const evaluate = async (
    listing: Listing,
    prompts: { transcription: string; evaluation: string }
  ) => {
    // Call 1
    setProgress('Call 1/2: Transcribing audio...');
    logger.info('Starting Call 1: Transcription', { listingId: listing.id });
    const transcriptionResult = await service.transcribe(...);
    
    // Call 2
    setProgress('Call 2/2: Generating critique...');
    logger.info('Starting Call 2: Critique', { listingId: listing.id });
    const critiqueResult = await service.critique(...);
    
    // Compute metrics
    setProgress('Computing metrics...');
    const metrics = computeAllMetrics(...);
    
    // Save
    ...
  };
}
```

---

### 2.5 Update Human Review UI

**File: `src/features/evals/components/HumanEvalNotepad.tsx`** (modify)

Update `SegmentRow` component to show:

```
┌────────────────────┬─────────────────────────────────┬────────────────────┐
│     ORIGINAL       │         AI GENERATED            │  HUMAN CORRECTION  │
├────────────────────┼─────────────────────────────────┼────────────────────┤
│ [Speaker badge]    │ [Speaker badge]                 │                    │
│ "Original text"    │ "AI generated text"             │ Click to correct   │
│                    │                                 │                    │
│                    │ ┌─ Critique ──────────────────┐ │                    │
│                    │ │ 💬 LLM analysis of segment  │ │                    │
│                    │ │ Severity: [badge]           │ │                    │
│                    │ └─────────────────────────────┘ │                    │
│                    │                                 │                    │
│                    │ ┌─ Metrics ───────────────────┐ │                    │
│                    │ │ ED: 3 | 89% [Good]          │ │                    │
│                    │ └─────────────────────────────┘ │                    │
└────────────────────┴─────────────────────────────────┴────────────────────┘
```

**File: `src/features/evals/components/SegmentCritiqueCard.tsx`** (NEW)

```typescript
interface SegmentCritiqueCardProps {
  critique: SegmentCritique;
}
// Displays the LLM critique with severity badge and category
```

---

### 2.6 Debug Panel Updates

**File: `src/features/debug/components/DebugPanel.tsx`** (modify)

Tasks tab should show:
- Task type: `ai_eval`
- Stage indicator: `Call 1/2` or `Call 2/2`
- Clear call progression in task details

Logs tab should capture:
- Evaluation start with prompts used
- Call 1 start/complete/fail
- Call 2 start/complete/fail
- Metrics computed
- Full flow completion

---

### 2.7 Progress Indicator Enhancement

**File: `src/features/evals/components/EvaluationProgress.tsx`** (NEW)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Evaluation in Progress                                              │
│                                                                     │
│  ●────────●────────○────────○                                       │
│  Prepare  Call 1   Call 2   Done                                    │
│           ▲                                                         │
│           └─ Transcribing audio... (42%)                            │
│                                                                     │
│                                                    [Cancel]         │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Phase 2 Checklist

- [ ] 2.1 Update SettingsPage with evaluation prompt textarea
- [ ] 2.2 Create `VariableChips` component for variable display/insertion
- [ ] 2.3 Create `EvaluationModal` component
- [ ] 2.4 Update `AIEvalRequest` to open modal
- [ ] 2.5 Refactor `useAIEvaluation` hook for two-call flow
- [ ] 2.6 Create `SegmentCritiqueCard` component
- [ ] 2.7 Update `HumanEvalNotepad` to show critique + metrics per segment
- [ ] 2.8 Create `EvaluationProgress` component with call stages
- [ ] 2.9 Update Debug Panel for call tracking
- [ ] 2.10 Add evaluation logging throughout flow
- [ ] 2.11 Test full flow: Modal → Call 1 → Call 2 → Display in Human Review
- [ ] 2.12 Test error states: missing variables, API failures, partial failures
- [ ] 2.13 Test rerun functionality

---

## Dependencies Graph

```
Phase 1 (Foundation)
├── 1.1 Types ──────────────────┐
├── 1.2 Template Types ─────────┤
│                               ▼
├── 1.3 Template Service ◄──────┤
│       │                       │
│       ▼                       │
├── 1.4 Settings Schema ◄───────┤
│       │                       │
│       ▼                       │
├── 1.5 Settings Store ─────────┤
│                               │
├── 1.6 EvaluationService ◄─────┤
│       │                       │
│       ▼                       │
├── 1.7 Task Queue Store ───────┤
│                               │
└── 1.8 Evaluation Logger ──────┘

Phase 2 (Implementation)
├── 2.1 Settings UI ◄─────────── Phase 1.4, 1.5
│       │
├── 2.2 VariableChips ◄───────── Phase 1.3
│       │
├── 2.3 EvaluationModal ◄─────── 2.1, 2.2, Phase 1.3
│       │
├── 2.4 AIEvalRequest ◄───────── 2.3
│       │
├── 2.5 useAIEvaluation ◄─────── Phase 1.6, 1.7, 1.8
│       │
├── 2.6 SegmentCritiqueCard ◄─── Phase 1.1
│       │
├── 2.7 HumanEvalNotepad ◄────── 2.6, existing EditDistanceBadge
│       │
├── 2.8 EvaluationProgress ◄──── Phase 1.6
│       │
└── 2.9 Debug Panel ◄─────────── Phase 1.7, 1.8
```

---

## Data Flow

```
User clicks "Request AI Evaluation"
            │
            ▼
┌─────────────────────────┐
│   EvaluationModal       │
│   - Load prompts        │
│   - Validate variables  │
│   - User edits/confirms │
└───────────┬─────────────┘
            │ [Run Evaluation]
            ▼
┌─────────────────────────┐
│   useAIEvaluation       │──────▶ Logger: "Evaluation started"
│   - Resolve variables   │──────▶ TaskQueue: Add task (stage: preparing)
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   CALL 1: Transcribe    │──────▶ Logger: "Call 1 started"
│   - Send audio + prompt │──────▶ TaskQueue: Update (stage: transcribing, call: 1)
│   - Parse response      │
└───────────┬─────────────┘
            │ Success
            ▼
┌─────────────────────────┐
│   CALL 2: Critique      │──────▶ Logger: "Call 2 started"
│   - Send all context    │──────▶ TaskQueue: Update (stage: critiquing, call: 2)
│   - Parse critique      │
└───────────┬─────────────┘
            │ Success
            ▼
┌─────────────────────────┐
│   Compute Metrics       │──────▶ Logger: "Metrics computed"
│   - WER, CER, Match     │
│   - Per-segment ED      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Save to Listing       │──────▶ Logger: "Evaluation complete"
│   - llmTranscript       │──────▶ TaskQueue: Complete task
│   - critique            │
│   - comparison          │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   UI Updates            │
│   - MetricsBar          │
│   - HumanEvalNotepad    │
│   - EvalsView           │
└─────────────────────────┘
```

---

## Error Handling

| Error Point | Handling |
|-------------|----------|
| Missing {{audio}} | Modal shows error, disable Run button |
| Missing {{transcript}} | Modal shows warning (for eval prompt) |
| Unknown variable | Modal shows warning, allow proceed |
| Call 1 API failure | Save partial state, show error, allow retry |
| Call 1 parse failure | Log raw response, show error with details |
| Call 2 API failure | Keep Call 1 result, show error, allow retry Call 2 only |
| Call 2 parse failure | Keep Call 1 result, log raw response |
| Network offline | Show offline warning before starting |

---

## Files Summary

### Phase 1 - New Files
- `src/types/template.types.ts`
- `src/services/templates/variableRegistry.ts`
- `src/services/templates/variableResolver.ts`
- `src/services/templates/index.ts`
- `src/services/llm/evaluationService.ts`
- `src/services/logger/evaluationLogger.ts`

### Phase 1 - Modified Files
- `src/types/eval.types.ts`
- `src/features/settings/schema/settingsSchema.ts`
- `src/stores/settingsStore.ts`
- `src/stores/taskQueueStore.ts`

### Phase 2 - New Files
- `src/features/settings/components/VariableChips.tsx`
- `src/features/evals/components/EvaluationModal.tsx`
- `src/features/evals/components/SegmentCritiqueCard.tsx`
- `src/features/evals/components/EvaluationProgress.tsx`

### Phase 2 - Modified Files
- `src/features/settings/components/SettingsPage.tsx`
- `src/features/evals/components/AIEvalRequest.tsx`
- `src/features/evals/hooks/useAIEvaluation.ts`
- `src/features/evals/components/HumanEvalNotepad.tsx`
- `src/features/debug/components/DebugPanel.tsx`
