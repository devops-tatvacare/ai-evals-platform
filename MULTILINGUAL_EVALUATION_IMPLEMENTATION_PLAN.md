# Implementation Plan: Multilingual Transcript Evaluation System

## **Phase 1: Foundation - User Control & Script Normalization** (Estimated: 1-2 days)

### **Conceptual Overview**

Phase 1 establishes the foundation for language-aware evaluations by giving users explicit control over transcription preferences and implementing the core normalization infrastructure. This phase makes the system "aware" that multilingual content exists and needs special handling.

---

### **1.1 Settings Store Extension**

**Where:** `src/stores/settingsStore.ts`

**Add New Settings:**

```
Transcription Preferences:
├── scriptPreference: 'auto' | 'devanagari' | 'romanized' | 'original'
│   └── Default: 'auto'
├── languageHint: string (optional, e.g., "Hindi", "English", "Hinglish")
├── preserveCodeSwitching: boolean (default: true)
├── segmentAlignmentMode: 'strict' | 'flexible' | 'semantic'
│   └── Default: 'flexible'
└── normalizationStrategy: 'phonetic' | 'script' | 'semantic' | 'none'
    └── Default: 'script'
```

**Why Each Setting:**
- **scriptPreference**: User declares desired output script (Devanagari vs Romanized)
- **languageHint**: Helps LLM understand audio context ("This is a Hindi medical consultation")
- **preserveCodeSwitching**: Whether to maintain English words in Hindi speech (BP, CPR, etc.)
- **segmentAlignmentMode**: How strictly to enforce segment boundaries
- **normalizationStrategy**: Which comparison method to use

**Migration Strategy:**
- Increment `SETTINGS_VERSION` from current version to version + 1
- Add migration function that sets defaults for existing users
- Show a one-time notification: "New multilingual evaluation settings available - review in Settings"

---

### **1.2 New Service: Script Normalization Service**

**Where:** `src/services/normalization/` (new folder)

**File Structure:**
```
src/services/normalization/
├── index.ts (exports)
├── scriptNormalizer.ts (main service)
├── transliterator.ts (Devanagari ↔ Romanized)
├── scriptDetector.ts (auto-detect script from text)
└── phoneticNormalizer.ts (phonetic equivalence)
```

**scriptNormalizer.ts - Core Responsibilities:**

1. **Detect Script Type**
   - Input: Transcript text
   - Output: 'devanagari' | 'romanized' | 'mixed' | 'english'
   - Logic: Analyze Unicode ranges (Devanagari: U+0900-U+097F, Latin: U+0000-U+007F)
   - Handle mixed scripts (code-switching detection)

2. **Normalize Transcript to Target Script**
   - Input: TranscriptData, targetScript
   - Output: Normalized TranscriptData
   - Logic:
     - If scripts match → return as-is
     - If different → transliterate segment-by-segment
     - Preserve English words when `preserveCodeSwitching: true`
     - Store original in metadata for reference

3. **Transliteration Strategy**
   - Option A: Use external library (`@sanskrit-coders/sanscript` for Indic scripts)
   - Option B: Use LLM-based transliteration (call Gemini with "transliterate this to [script]")
   - Option C (Recommended): Hybrid - library for common words, LLM for medical terms

**transliterator.ts - Transliteration Logic:**

```
DevanagariToRomanized:
- Input: "तो ये टेस्ट free नहीं है"
- Process:
  1. Identify Devanagari words: ["तो", "ये", "टेस्ट", "नहीं", "है"]
  2. Keep English words: ["free"]
  3. Transliterate: ["to", "ye", "test", "nahi", "hai"]
  4. Preserve spacing/punctuation
- Output: "to ye test free nahi hai"

RomanizedToDevanagari:
- Input: "to ye test free nahi hai"
- Process:
  1. Detect English words (dictionary lookup or language model)
  2. Keep: ["free", "test"] (medical/English terms)
  3. Transliterate Hindi romanized: ["to"→"तो", "ye"→"ये", "nahi"→"नहीं", "hai"→"है"]
- Output: "तो ये test free नहीं है"
```

**scriptDetector.ts - Auto-Detection:**

```
Function: detectTranscriptScript(transcript: TranscriptData)
Returns: {
  primaryScript: 'devanagari' | 'romanized' | 'mixed',
  confidence: number (0-1),
  segmentBreakdown: Array<{segmentIndex, detectedScript}>
}

Logic:
1. Iterate through all segments
2. Count Unicode ranges per segment
3. Determine majority script across transcript
4. If >30% mixed segments → flag as 'mixed'
5. Return confidence based on consistency
```

---

### **1.3 Update Template Variable System**

**Where:** `src/services/templates/variableRegistry.ts`

**Add New Variables:**

```
New template variables available in prompts:

{{script_preference}} → "devanagari" | "romanized" | "auto"
{{language_hint}} → "Hindi", "Hinglish", etc.
{{preserve_code_switching}} → "yes" | "no"
{{original_script}} → Detected script of original transcript
{{segment_count}} → Number of segments expected
{{speaker_list}} → Comma-separated speaker labels
```

**Where:** `src/services/templates/variableResolver.ts`

**Extend resolveVariable() function:**

```
Add cases for new variables:
- Read from settingsStore.transcription preferences
- For {{original_script}}, call scriptDetector.detectTranscriptScript()
- For {{segment_count}} and {{speaker_list}}, extract from context.listing.transcript
```

---

### **1.4 Update Default Prompts**

**Where:** `src/constants/prompts.ts`

**DEFAULT_TRANSCRIPTION_PROMPT - Enhanced Version:**

```
Structure (pseudo-prompt):

You are a medical transcription expert specializing in {{language_hint}} language audio.

CRITICAL TRANSCRIPTION RULES:
1. SCRIPT & LANGUAGE:
   - Target script: {{script_preference}}
   - If "auto": Use the most natural script for the spoken language
   - If "devanagari": Use Devanagari script (Hindi: देवनागरी)
   - If "romanized": Use romanized/Latin script (Hindi: Devanagari → Roman)
   
2. CODE-SWITCHING HANDLING:
   - Preserve code-switching: {{preserve_code_switching}}
   - Keep English medical terms as-is (BP, CPR, ECG, etc.)
   - Example: "मेरे को BP है" or "mere ko BP hai" (depending on script)

3. SEGMENTATION:
   - Create clear speaker-turn boundaries
   - Each segment = one speaker's continuous speech
   - Do NOT merge multiple speaker turns into one segment
   - Expected speakers: Doctor, Patient (identify accurately)

4. OUTPUT FORMAT:
   [Keep existing JSON structure requirements]

REFERENCE CONTEXT (if available):
- Original transcript uses: {{original_script}} script
- Expected segments: approximately {{segment_count}}
- Speakers in recording: {{speaker_list}}

[Rest of prompt remains same]
```

**DEFAULT_EVALUATION_PROMPT - Enhanced Version:**

```
Structure (pseudo-prompt):

You are an expert medical transcription auditor.

CRITICAL: SCRIPT-AWARE COMPARISON
═══════════════════════════════════════════

The two transcripts may use DIFFERENT SCRIPTS or WRITING SYSTEMS:
- Original Transcript Script: {{original_script}}
- Judge Transcript Script: [will be detected automatically]

When comparing:
1. DO NOT flag differences due to script/romanization alone
2. Recognize semantic equivalence:
   - "तो ये टेस्ट" (Devanagari) = "to ye test" (Romanized) → SAME MEANING
   - "नहीं" (Devanagari) = "nahi" (Romanized) → SAME MEANING
   - "BP" = "blood pressure" = "ब्लड प्रेशर" → SAME MEANING

3. SEGMENT ALIGNMENT STRATEGY:
   - Transcripts may have different segment counts
   - Align by TEMPORAL POSITION and SPEAKER, not by array index
   - Example:
     * Original segment 1: "Doctor: Hello how are you"
     * Judge segments 1-2: "Doctor: Hello" + "Doctor: how are you"
     * → These should be MERGED for comparison as ONE semantic unit

4. WHAT TO ACTUALLY FLAG:
   ✓ Medical term errors (Celebrex vs Cerebyx)
   ✓ Dosage errors (10mg vs 100mg)
   ✓ Missing critical info (omitted symptoms)
   ✓ Speaker misattribution (Doctor said it, but marked as Patient)
   ✗ Script differences (Devanagari vs Romanized)
   ✗ Filler words (um, uh, you know)
   ✗ Minor paraphrasing with same clinical meaning

[Rest of evaluation methodology remains...]

REFERENCE MATERIALS:
Original Transcript ({{original_script}} script):
{{transcript}}

Judge Transcript (may differ in script):
{{llm_transcript}}

Audio for verification:
{{audio}}

[Rest of prompt remains same]
```

---

### **1.5 Comparison Logic Update**

**Where:** `src/features/evals/utils/compareTranscripts.ts`

**High-Level Changes:**

**Current Flow:**
```
compareTranscripts(original, llm) {
  1. Normalize text (lowercase, trim whitespace)
  2. Calculate Levenshtein distance
  3. Return differences
}
```

**New Flow:**
```
compareTranscripts(original, llm, options?) {
  1. Detect script of both transcripts
  2. If scripts differ:
     a. Normalize both to common script (use scriptNormalizer service)
     b. Store normalized versions for comparison
     c. Keep originals for display
  3. For each segment:
     a. Normalize text (existing logic)
     b. If normalizationStrategy = 'phonetic': 
        → Apply phonetic comparison (Soundex/Metaphone)
     c. If normalizationStrategy = 'semantic':
        → [Phase 2] Use embedding similarity
     d. Else: Use Levenshtein (existing)
  4. Calculate similarity with script-awareness
  5. Return comparison with metadata:
     - scriptsMatched: boolean
     - normalizationApplied: 'none' | 'script' | 'phonetic'
     - originalScripts: { original: string, llm: string }
}
```

**New Function: normalizeForComparison()**

```
Purpose: Prepare transcripts for fair comparison

Input:
- original: TranscriptData
- llm: TranscriptData
- strategy: NormalizationStrategy from settings

Output:
- normalizedOriginal: TranscriptData
- normalizedLLM: TranscriptData
- appliedTransformations: Array<string> (for transparency)

Logic:
1. Detect scripts
2. If different:
   - Choose target script (prefer 'romanized' for comparison simplicity)
   - Transliterate both to target
3. If preserveCodeSwitching=false:
   - Normalize English words to consistent form ("BP" vs "blood pressure")
4. Return normalized versions + transformation log
```

---

### **1.6 Evaluation Flow Integration**

**Where:** `src/features/evals/hooks/useAIEvaluation.ts`

**Current Flow:**
```
Line 176: const comparison = compareTranscripts(listing.transcript, transcriptionResult.transcript);
```

**New Flow:**
```
Insert BEFORE line 176:

Step 1: Detect scripts
const originalScript = scriptDetector.detectTranscriptScript(listing.transcript);
const llmScript = scriptDetector.detectTranscriptScript(transcriptionResult.transcript);

Step 2: Normalize if needed
let normalizedOriginal = listing.transcript;
let normalizedLLM = transcriptionResult.transcript;

if (originalScript.primaryScript !== llmScript.primaryScript) {
  const normalizationResult = await scriptNormalizer.normalize({
    original: listing.transcript,
    llm: transcriptionResult.transcript,
    targetScript: settingsStore.transcription.scriptPreference,
    strategy: settingsStore.transcription.normalizationStrategy
  });
  
  normalizedOriginal = normalizationResult.normalizedOriginal;
  normalizedLLM = normalizationResult.normalizedLLM;
  
  // Log normalization for transparency
  evaluation.normalization = {
    applied: true,
    originalScript: originalScript.primaryScript,
    llmScript: llmScript.primaryScript,
    targetScript: normalizationResult.targetScript,
    transformations: normalizationResult.transformations
  };
}

Step 3: Compare normalized versions
const comparison = compareTranscripts(
  normalizedOriginal, 
  normalizedLLM,
  { strategy: settingsStore.transcription.normalizationStrategy }
);

Step 4: Store both original and normalized in evaluation
evaluation.comparison = comparison;
evaluation.llmTranscript = transcriptionResult.transcript; // Keep original
evaluation.llmTranscriptNormalized = normalizedLLM; // Store normalized for reference
```

**Add to progress updates:**
```
After Call 1 completes, before Call 2:
onProgress({
  stage: 'normalizing',
  message: 'Normalizing transcripts for comparison...',
  progress: 45
});
```

---

### **1.7 Type Definitions Update**

**Where:** `src/types/index.ts`

**Add New Types:**

```typescript
// Transcription preferences
export interface TranscriptionPreferences {
  scriptPreference: 'auto' | 'devanagari' | 'romanized' | 'original';
  languageHint?: string;
  preserveCodeSwitching: boolean;
  segmentAlignmentMode: 'strict' | 'flexible' | 'semantic';
  normalizationStrategy: 'phonetic' | 'script' | 'semantic' | 'none';
}

// Script detection result
export interface ScriptDetectionResult {
  primaryScript: 'devanagari' | 'romanized' | 'mixed' | 'english' | 'unknown';
  confidence: number;
  segmentBreakdown?: Array<{ segmentIndex: number; detectedScript: string }>;
}

// Normalization metadata
export interface NormalizationMetadata {
  applied: boolean;
  originalScript: string;
  llmScript: string;
  targetScript: string;
  transformations: string[];
}

// Extended AIEvaluation type
export interface AIEvaluation {
  // ... existing fields ...
  normalization?: NormalizationMetadata;
  llmTranscriptNormalized?: TranscriptData; // Store normalized version
}
```

---

### **1.8 UI/UX Changes for Phase 1**

#### **Settings Page (`src/features/settings/`)**

**New Section: "Transcription & Language Settings"**

```
Location: After "LLM Provider" section, before "Prompts"

Visual Layout (Card-based):

┌─────────────────────────────────────────────────────┐
│ 📝 Transcription & Language Settings                │
├─────────────────────────────────────────────────────┤
│                                                      │
│ Script Preference                                    │
│ ┌─────────────────────────────────────────────┐    │
│ │ ⚪ Auto (detect from audio)                  │    │
│ │ ⚪ Devanagari (देवनागरी)                     │    │
│ │ ⚪ Romanized (Latin script)                  │    │
│ │ ⚪ Match original transcript                 │    │
│ └─────────────────────────────────────────────┘    │
│ ℹ️  Controls which script the AI judge uses for     │
│    transcription. Choose "Auto" for best results.   │
│                                                      │
│ Language Hint (optional)                             │
│ ┌─────────────────────────────────────────────┐    │
│ │ [Hindi                                    ▼]│    │
│ └─────────────────────────────────────────────┘    │
│ Suggestions: Hindi, English, Hinglish, Tamil, etc.  │
│                                                      │
│ ☑️ Preserve code-switching (mix of languages)       │
│ ℹ️  Keeps English words like "BP", "CPR" in Hindi   │
│    transcripts                                       │
│                                                      │
│ Segment Alignment Mode                               │
│ ┌─────────────────────────────────────────────┐    │
│ │ ⚪ Strict (match segment boundaries exactly) │    │
│ │ ⚪ Flexible (allow minor variations) ✓       │    │
│ │ ⚪ Semantic (merge based on meaning)         │    │
│ └─────────────────────────────────────────────┘    │
│                                                      │
│ Comparison Strategy                                  │
│ ┌─────────────────────────────────────────────┐    │
│ │ ⚪ Script normalization (Recommended) ✓      │    │
│ │ ⚪ Phonetic matching                         │    │
│ │ ⚪ Semantic similarity [Phase 2]             │    │
│ │ ⚪ None (exact text match)                   │    │
│ └─────────────────────────────────────────────┘    │
│ ℹ️  Script normalization handles Devanagari vs      │
│    Romanized differences automatically               │
│                                                      │
│                            [Reset to Defaults]       │
└─────────────────────────────────────────────────────┘
```

**Interaction Details:**
- Show tooltips on hover for each option explaining when to use
- "Language Hint" dropdown with common languages + free-text option
- Real-time preview: Show example text transformation when changing script preference
- Validation: If user selects "Match original" but no original exists, show warning

---

#### **Evaluation Results View (`src/features/evals/components/`)**

**Add Normalization Badge/Info Section**

```
Location: Above "Transcript Comparison" component

When normalization was applied:

┌─────────────────────────────────────────────────────┐
│ ℹ️  Script Normalization Applied                     │
├─────────────────────────────────────────────────────┤
│ Original Transcript: Devanagari (Hindi)              │
│ AI Transcript: Romanized (Hinglish)                  │
│ Comparison Mode: Both normalized to Romanized        │
│                                                       │
│ [View Original Scripts] [View Normalized Versions]   │
└─────────────────────────────────────────────────────┘
```

**Transcript Comparison View Enhancement:**

```
Current: Shows only Original vs AI Generated

New: Add toggle to view normalized versions

┌─────────────────────────────────────────────────────┐
│ Transcript Comparison              [65 differences]  │
│                                                       │
│ View: ⚪ Original Scripts  ⚪ Normalized (for compare)│
│                                                       │
│ [Comparison display based on selected view]          │
└─────────────────────────────────────────────────────┘

When "Normalized" is selected:
- Show side-by-side comparison of NORMALIZED versions
- Add subtle badge on each segment: "🔄 Normalized from Devanagari"
- Hover over badge shows original text

When "Original Scripts" is selected:
- Show exactly what was generated (current behavior)
- Add note: "⚠️ Differences may include script variations"
```

---

#### **Evaluation Progress Indicator**

**Add new stage to progress bar:**

```
Current stages:
[Preparing] → [Transcribing] → [Critiquing] → [Comparing] → [Complete]

New stages:
[Preparing] → [Transcribing] → [Normalizing] → [Critiquing] → [Comparing] → [Complete]
                                   ↑
                              New stage

Progress message examples:
- "Detecting script types..."
- "Normalizing transcripts to Romanized..."
- "Preparing script-aware comparison..."
```

---

#### **Debug Panel Integration**

**Log normalization operations:**

```
Add log entries in src/services/logger/:

[EVALUATION] Script detection started
[NORMALIZATION] Original: Devanagari (95% confidence)
[NORMALIZATION] LLM: Romanized (98% confidence)
[NORMALIZATION] Transliterating 43 segments to Romanized
[NORMALIZATION] Complete - ready for comparison
[COMPARISON] Using script-normalized inputs
```

---

## **Phase 2: Segment Alignment & Advanced Comparison** (Estimated: 1-2 days)

### **Conceptual Overview**

Phase 2 addresses the segment alignment problem (Q4, Solution 2) where the LLM judge creates a different number of segments than the original. This phase makes comparisons "smart" by aligning segments based on timing and speaker rather than array index, and optionally adds semantic comparison capabilities.

---

### **2.1 New Service: Segment Alignment Service**

**Where:** `src/services/alignment/` (new folder)

**File Structure:**
```
src/services/alignment/
├── index.ts
├── segmentAligner.ts (main alignment logic)
├── temporalMatcher.ts (time-based matching)
└── semanticMatcher.ts (content-based matching)
```

**segmentAligner.ts - Core Concept:**

**Problem Example:**
```
Original:
  Segment 1: [Doctor, 0-5s]: "तो ये टेस्ट free नहीं है"
  Segment 2: [Doctor, 7-11s]: "जी बताइए मतलब ये सब टेस्ट..."
  
LLM Judge:
  Segment 1: [Doctor, 0-3s]: "Haan ji bataiye"
  Segment 2: [Doctor, 3-5s]: "matlab ye sab tests"
  Segment 3: [Doctor, 5-7s]: "aapne kyu karaye?"
```

**Solution Approach:**

```
Alignment Algorithm:

1. Build Timeline
   - Create unified timeline with all segment boundaries
   - Mark segments from both transcripts on timeline
   
2. Find Overlaps
   - For each original segment:
     → Find all LLM segments that overlap temporally
     → Group them as "alignment cluster"
   
3. Merge Strategy (based on segmentAlignmentMode):
   
   STRICT mode:
   - Expect 1:1 mapping
   - Flag any segment count mismatch as error
   
   FLEXIBLE mode (Recommended):
   - Allow 1:many or many:1 mapping
   - Merge multiple LLM segments into one for comparison
   - Example: LLM segments 1+2+3 → compare against Original segment 2
   
   SEMANTIC mode:
   - Ignore boundaries completely
   - Group by speaker + semantic similarity
   - More forgiving but computationally expensive

4. Create Alignment Map
   Output: Array<AlignmentPair>
   Where AlignmentPair = {
     originalSegments: number[] (indices),
     llmSegments: number[] (indices),
     mergedOriginalText: string,
     mergedLLMText: string,
     alignmentConfidence: number
   }
```

**temporalMatcher.ts - Time-Based Logic:**

```
Function: findTemporalOverlap(originalSeg, llmSegs)

Logic:
1. Convert start/end times to seconds (if not already)
2. Calculate overlap percentage:
   overlap = (min(orig.end, llm.end) - max(orig.start, llm.start)) 
             / (orig.end - orig.start)
3. If overlap > threshold (e.g., 30%) → consider it a match
4. Return all matching LLM segments

Handle edge cases:
- Missing timestamps → fall back to sequential matching
- Overlapping segments from same transcript → flag as warning
```

**semanticMatcher.ts - Content-Based Matching:**

```
Function: findSemanticMatches(originalSeg, llmSegs)

Logic (Phase 2):
1. Extract keywords from original segment
2. Compare with keywords in each LLM segment
3. Calculate similarity score (TF-IDF or simple keyword overlap)
4. Return best matches above threshold

Phase 2 Enhancement (optional):
- Use embeddings for similarity (if semantic comparison enabled)
- More robust for paraphrasing
```

---

### **2.2 Update Comparison Logic with Alignment**

**Where:** `src/features/evals/utils/compareTranscripts.ts`

**Current Logic:**
```
for (let i = 0; i < maxLength; i++) {
  originalSegment = original.segments[i];
  generatedSegment = llmGenerated.segments[i];
  compare(originalSegment, generatedSegment);
}
```

**New Logic:**
```
Step 1: Align segments
const alignmentMap = segmentAligner.align({
  original: original.segments,
  llm: llmGenerated.segments,
  mode: settings.segmentAlignmentMode
});

Step 2: Compare aligned pairs
for (const pair of alignmentMap) {
  // pair contains merged text from potentially multiple segments
  const diff = compareSegments(
    pair.mergedOriginalText,
    pair.mergedLLMText,
    pair // pass full pair for context
  );
  
  if (diff) {
    diff.alignmentInfo = {
      originalSegmentIndices: pair.originalSegments,
      llmSegmentIndices: pair.llmSegments,
      confidence: pair.alignmentConfidence
    };
    differences.push(diff);
  }
}

Step 3: Flag unmatched segments
const unmatchedOriginal = findUnmatchedSegments(original, alignmentMap);
const unmatchedLLM = findUnmatchedSegments(llmGenerated, alignmentMap);

if (unmatchedOriginal.length > 0) {
  // These are segments in original but not in LLM (omissions)
  differences.push(...markAsOmissions(unmatchedOriginal));
}

if (unmatchedLLM.length > 0) {
  // These are segments in LLM but not in original (hallucinations)
  differences.push(...markAsInsertions(unmatchedLLM));
}
```

**Enhanced TranscriptDiff Type:**

```typescript
export interface TranscriptDiff {
  // ... existing fields ...
  
  // New fields for alignment
  alignmentInfo?: {
    originalSegmentIndices: number[];
    llmSegmentIndices: number[];
    alignmentType: '1:1' | '1:many' | 'many:1' | 'unmatched';
    confidence: number;
  };
  
  // Flag special cases
  isOmission?: boolean; // In original, not in LLM
  isInsertion?: boolean; // In LLM, not in original
  isMerged?: boolean; // Multiple segments merged for comparison
}
```

---

### **2.3 Call 2 Prompt Enhancement for Alignment**

**Where:** `src/constants/prompts.ts` - DEFAULT_EVALUATION_PROMPT

**Add to SEGMENT ALIGNMENT section:**

```
SEGMENT ALIGNMENT STRATEGY (ENHANCED):

The original and judge transcripts may have DIFFERENT SEGMENT COUNTS.
This is NORMAL and not an error. Follow this process:

1. TEMPORAL ALIGNMENT:
   - Match segments by time overlap, not by index
   - If Original Segment 5 (10-15s) corresponds to Judge Segments 8+9 (10-15s):
     → Treat Judge 8+9 as ONE unit for comparison against Original 5
   
2. SPEAKER CONTINUITY:
   - If the same speaker has multiple consecutive segments in one transcript:
     → Merge them conceptually before comparing
   - Example:
     Original: [Doctor]: "Hello. How are you today?"
     Judge: [Doctor]: "Hello." + [Doctor]: "How are you today?"
     → Judge segments should be MERGED: "Hello. How are you today?"
     → Then compare against original → MATCH

3. WHAT TO REPORT IN JSON:
   - In "segmentIndex" field, use the ORIGINAL transcript's index
   - In "judgeText", merge multiple judge segments if needed
   - Add a note in "discrepancy" if merging was applied:
     "Judge segments 8-9 merged for comparison"

4. FLAG ONLY THESE:
   ✓ Content actually differs after temporal alignment
   ✓ Speaker misattribution
   ✓ Omitted content (in original, missing in judge)
   ✓ Hallucinated content (in judge, not in original)
   
   ✗ Different segment boundaries (NOT an error)
   ✗ Same content split differently (NOT an error)
```

---

### **2.4 Evaluation Flow Update**

**Where:** `src/features/evals/hooks/useAIEvaluation.ts`

**Enhanced Flow (building on Phase 1):**

```
Current Phase 1 flow:
1. Call 1: Transcription
2. Normalization (script)
3. Call 2: Critique
4. Comparison
5. Complete

New Phase 2 flow:
1. Call 1: Transcription
2. Script Detection & Normalization
3. Segment Alignment ← NEW
4. Call 2: Critique (with alignment context)
5. Comparison (using aligned segments)
6. Complete

Insert between normalization and Call 2:

onProgress({
  stage: 'aligning',
  message: 'Aligning segment boundaries...',
  progress: 50
});

const alignmentResult = await segmentAligner.align({
  original: normalizedOriginal.segments,
  llm: normalizedLLM.segments,
  mode: settings.transcription.segmentAlignmentMode,
  useTemporalInfo: true
});

// Store alignment for context in Call 2
evaluation.segmentAlignment = {
  alignmentMap: alignmentResult.alignmentMap,
  unmatchedOriginal: alignmentResult.unmatchedOriginal,
  unmatchedLLM: alignmentResult.unmatchedLLM,
  mode: settings.transcription.segmentAlignmentMode
};

// Pass alignment info to Call 2 (optional - for context)
// This helps the LLM judge understand the alignment
```

---

### **2.5 UI/UX Changes for Phase 2**

#### **Transcript Comparison View Enhancement**

**Current View Issues:**
- Shows segment-by-segment diff
- Assumes 1:1 mapping
- Confusing when segment counts differ

**New View:**

```
┌─────────────────────────────────────────────────────────┐
│ Transcript Comparison                  [View: Aligned ▼] │
├─────────────────────────────────────────────────────────┤
│                                                           │
│ Alignment Mode: Flexible                                  │
│ 📊 Segments: Original (43) → Aligned to LLM (57)          │
│ ℹ️  Some segments were merged for comparison              │
│                                                           │
│ ┌───────────────────────────┬───────────────────────────┐│
│ │ Original (Devanagari)     │ AI Generated (Romanized)  ││
│ ├───────────────────────────┼───────────────────────────┤│
│ │                           │                           ││
│ │ 1  Doctor: तो ये टेस्ट... │ 1  Doctor: Haan ji...    ││
│ │                           │ +2 Doctor: matlab...     ││
│ │                           │ +3 Doctor: koi reason?   ││
│ │                           │                           ││
│ │    [1:3 alignment] ───────┼──────────────────────▶   ││
│ │                           │                           ││
│ │    ☑️ Match (normalized)   │                           ││
│ │                           │                           ││
│ ├───────────────────────────┼───────────────────────────┤│
│ │                           │                           ││
│ │ 2  Patient: तो सर ये...   │ 4  Patient: Sir, ye...   ││
│ │                           │                           ││
│ │    [1:1 alignment] ───────┼──────────────────────▶   ││
│ │                           │                           ││
│ │    ⚠️ Minor difference     │                           ││
│ │                           │                           ││
│ └───────────────────────────┴───────────────────────────┘│
│                                                           │
│ Legend:                                                   │
│ [1:3] = Original segment 1 aligned to LLM segments 1-3    │
│ +2 = Additional segment merged into comparison            │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**Key Visual Elements:**

1. **Alignment Indicator:**
   - Show visual connection between aligned segments
   - Use connecting arrows or brackets to show 1:many mappings
   - Badge showing alignment ratio (e.g., "1:3")

2. **Merged Segment Display:**
   - When multiple segments are merged, show them stacked with "+" prefix
   - Subtle background color to indicate grouping
   - Hover shows timing info: "Segments 1-3 merged (0-11s)"

3. **Alignment Confidence:**
   - Show confidence badge: 🟢 High (>80%) | 🟡 Medium (50-80%) | 🔴 Low (<50%)
   - Low confidence segments are flagged for human review

4. **View Modes Dropdown:**
   - "Aligned View" (default): Shows aligned + merged segments
   - "Raw Segments": Shows exact original segmentation (debugging)
   - "Side-by-Side": Traditional line-by-line view

---

#### **Settings Page Addition**

**Add explanation section:**

```
┌─────────────────────────────────────────────────────┐
│ Segment Alignment                                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│ Mode: ⚪ Strict  ⚪ Flexible ✓  ⚪ Semantic           │
│                                                      │
│ [?] What does this mean?                            │
│                                                      │
│ When expanded:                                       │
│ ┌─────────────────────────────────────────────┐    │
│ │ Different AI models segment speech           │    │
│ │ differently. Flexible mode handles this by   │    │
│ │ aligning segments based on timing and        │    │
│ │ speaker, not just position.                  │    │
│ │                                              │    │
│ │ Example:                                     │    │
│ │ Original: "Hello. How are you?" (1 segment)  │    │
│ │ AI: "Hello." + "How are you?" (2 segments)   │    │
│ │ → Flexible mode merges AI segments for      │    │
│ │   fair comparison                            │    │
│ └─────────────────────────────────────────────┘    │
│                                                      │
│ Recommended: Use Flexible for most cases             │
└─────────────────────────────────────────────────────┘
```

---

#### **Evaluation Results Summary Card**

**Add alignment statistics:**

```
┌─────────────────────────────────────────────────────┐
│ 📊 Evaluation Summary                                │
├─────────────────────────────────────────────────────┤
│                                                      │
│ Match Percentage: 87.3%  [↑ After normalization]    │
│                                                      │
│ Segments:                                            │
│   Original: 43 segments                              │
│   AI Generated: 57 segments                          │
│   Aligned Pairs: 45                                  │
│                                                      │
│ Alignment Quality:                                   │
│   🟢 High Confidence: 38 pairs (84%)                 │
│   🟡 Medium Confidence: 5 pairs (11%)                │
│   🔴 Low Confidence: 2 pairs (4%)                    │
│                                                      │
│ Differences:                                         │
│   ✅ Matches: 35                                     │
│   ⚠️ Minor: 8                                        │
│   🟠 Moderate: 2                                     │
│   🔴 Critical: 0                                     │
│                                                      │
│ [View Detailed Comparison]                           │
└─────────────────────────────────────────────────────┘
```

---

#### **Debug Panel Enhancements**

**Add alignment logging:**

```
[ALIGNMENT] Segment alignment started (mode: flexible)
[ALIGNMENT] Original: 43 segments, LLM: 57 segments
[ALIGNMENT] Temporal matching...
[ALIGNMENT] Found 45 aligned pairs:
  - 38 (1:1 mappings)
  - 5 (1:many) - original segment matched to multiple LLM
  - 2 (many:1) - multiple original segments to one LLM
[ALIGNMENT] Unmatched: 2 original, 0 LLM
[ALIGNMENT] Average confidence: 91.2%
[ALIGNMENT] Complete - ready for comparison
```

---

### **2.6 Optional: Semantic Comparison (Advanced)**

**Where:** `src/services/comparison/semanticComparator.ts` (new file)

**High-Level Concept:**

```
When normalizationStrategy = 'semantic':

1. Generate embeddings for segment pairs
   - Use Gemini embedding-001 or similar
   - Batch requests for efficiency (embed all segments at once)

2. Calculate cosine similarity
   - Similarity > 0.9 → Match (semantic equivalence)
   - Similarity 0.7-0.9 → Minor difference
   - Similarity 0.5-0.7 → Moderate difference
   - Similarity < 0.5 → Major difference

3. Fallback to Levenshtein for very low similarity
   - Embeddings may fail for nonsense text or hallucinations

Benefits:
- Handles "BP" vs "blood pressure" automatically
- Works across scripts without transliteration
- Catches paraphrasing

Drawbacks:
- Requires API calls (cost/latency)
- Need to cache embeddings to avoid re-computing
- May be too lenient for medical accuracy requirements
```

**UI Toggle:**

```
Settings > Comparison Strategy:
⚪ Script normalization (Fast, recommended)
⚪ Semantic similarity (Slower, more accurate)

When semantic is selected:
ℹ️ Note: This will make additional API calls to generate
   text embeddings. Estimated cost: ~$0.0001 per evaluation.
```

---

## **Implementation Order & Dependencies**

### **Phase 1 Implementation Sequence:**

```
Week 1, Day 1-2:
1. Update types (30 min)
2. Create settings store extensions (1 hour)
3. Create scriptDetector service (2-3 hours)
4. Create transliterator service (3-4 hours)
5. Create scriptNormalizer service (2-3 hours)
6. Unit tests for normalization (2 hours)

Week 1, Day 3-4:
7. Update template variable registry/resolver (1-2 hours)
8. Update default prompts (2 hours)
9. Integrate normalization into evaluation flow (2-3 hours)
10. Update compareTranscripts to use normalized inputs (2 hours)
11. Integration tests (2-3 hours)

Week 1, Day 5:
12. Build Settings UI (3-4 hours)
13. Build normalization info display in results (2-3 hours)
14. Add progress indicator for normalization stage (1 hour)
15. Update debug panel logging (1 hour)
16. End-to-end testing (2-3 hours)
```

### **Phase 2 Implementation Sequence:**

```
Week 2, Day 1-2:
1. Create segmentAligner service (4-5 hours)
2. Create temporalMatcher (2-3 hours)
3. Create semanticMatcher basics (2 hours)
4. Unit tests for alignment (2-3 hours)

Week 2, Day 3-4:
5. Update compareTranscripts with alignment (3-4 hours)
6. Update Call 2 prompt for alignment awareness (1-2 hours)
7. Integrate alignment into evaluation flow (2-3 hours)
8. Integration tests (2-3 hours)

Week 2, Day 5:
9. Build aligned comparison view UI (4-5 hours)
10. Add alignment statistics to summary (2 hours)
11. Update settings UI with alignment explanations (1-2 hours)
12. Update debug panel for alignment (1 hour)
13. End-to-end testing with various alignments (3-4 hours)
```

---

## **Testing Strategy**

### **Phase 1 Testing:**

**Test Cases:**

1. **Same Script (Baseline)**
   - Original: Devanagari → LLM: Devanagari
   - Expected: No normalization, direct comparison

2. **Different Scripts (Core Case)**
   - Original: Devanagari → LLM: Romanized
   - Expected: Both normalized to Romanized, comparison succeeds

3. **Code-Switching**
   - Original: "मेरे को BP है" → LLM: "mere ko blood pressure hai"
   - Expected: Normalization handles medical terms, flags as match

4. **Mixed Scripts**
   - Original: Mix of Devanagari + English → LLM: Full Romanized
   - Expected: Intelligent handling, preserves English terms

5. **Settings Variations**
   - Test each scriptPreference option
   - Test preserveCodeSwitching on/off
   - Test normalizationStrategy options

**Test Data:**
- Use your existing transcript (ambient-voice-rx-recording...)
- Create synthetic examples for edge cases
- Test with 100% Devanagari, 100% English, and mixed content

---

### **Phase 2 Testing:**

**Test Cases:**

1. **Perfect Alignment (1:1)**
   - Original: 10 segments → LLM: 10 segments, same boundaries
   - Expected: 10 pairs, all high confidence

2. **Split Segments (1:many)**
   - Original: 1 segment → LLM: 3 segments (same content split)
   - Expected: 1 pair merging LLM 1-3, high confidence, marked as match

3. **Merged Segments (many:1)**
   - Original: 3 segments → LLM: 1 segment (merged)
   - Expected: 1 pair merging Original 1-3, high confidence

4. **Unmatched Segments (Omissions)**
   - Original: has segment X → LLM: missing X
   - Expected: Flagged as omission, marked for review

5. **Unmatched Segments (Insertions)**
   - Original: no segment → LLM: has extra segment Y
   - Expected: Flagged as insertion/hallucination

6. **Complex Mixed Alignment**
   - Combination of 1:1, 1:many, many:1 in same transcript
   - Expected: Correct alignment with varying confidence levels

7. **Missing Timestamps**
   - Segments without time info
   - Expected: Falls back to sequential matching

**Alignment Mode Testing:**
- Run same test cases in Strict, Flexible, Semantic modes
- Verify appropriate behavior for each

---

## **Rollout Strategy**

### **Phase 1 Rollout:**

**Step 1: Feature Flag (Optional)**
```
Add setting: enableScriptNormalization: boolean (default: true)
Allows quick disable if issues arise in production
```

**Step 2: Soft Launch**
```
1. Release to beta testers with multilingual content
2. Monitor debug logs for normalization accuracy
3. Collect feedback on UI clarity
4. Iterate on prompts/transliteration
```

**Step 3: Full Release**
```
1. Enable for all users
2. Show one-time notification about new features
3. Add "What's New" guide in settings
4. Monitor support tickets for confusion
```

---

### **Phase 2 Rollout:**

**Step 1: Gradual Activation**
```
1. Release with segmentAlignmentMode default: 'flexible'
2. Add UI hint: "New: Smart segment alignment!"
3. Allow users to switch to 'strict' if preferred (for testing)
```

**Step 2: Feedback Collection**
```
1. Add "Rate this evaluation" button
2. Collect data on alignment confidence vs user satisfaction
3. Use feedback to tune alignment thresholds
```

**Step 3: Optimization**
```
1. Analyze most common alignment patterns
2. Optimize for speed (cache temporal calculations)
3. Improve UI based on user behavior (which views they use most)
```

---

## **Success Metrics**

### **Phase 1 Metrics:**

- **Reduction in False Differences:** Target 70-90% reduction in script-related diffs
- **User Satisfaction:** Survey users - "Are script differences handled correctly?"
- **Normalization Accuracy:** Manual review of 50 evaluations - normalization quality score
- **Performance:** Normalization adds < 2 seconds to evaluation time

### **Phase 2 Metrics:**

- **Alignment Accuracy:** % of alignments with High confidence (target: >80%)
- **User Comprehension:** Users understand alignment UI (measured by reduced support tickets)
- **Comparison Accuracy:** Reduction in false positives from segmentation differences (target: 60-80%)
- **Human Review Time:** Reduced time spent on segment-level review

---

## **Risk Mitigation**

### **Phase 1 Risks:**

**Risk 1: Transliteration Inaccuracies**
- Medical terms may be transliterated incorrectly
- Mitigation: Build medical term dictionary, fallback to LLM transliteration

**Risk 2: Performance Overhead**
- Normalization adds latency
- Mitigation: Cache transliterations, use efficient libraries, async processing

**Risk 3: User Confusion**
- Too many settings overwhelm users
- Mitigation: Smart defaults, progressive disclosure, good tooltips

### **Phase 2 Risks:**

**Risk 1: Alignment Errors**
- Incorrect temporal matching produces wrong pairs
- Mitigation: Show confidence scores, allow manual override

**Risk 2: UI Complexity**
- Aligned view may confuse users
- Mitigation: Multiple view modes, default to simplest, good documentation

**Risk 3: Edge Cases**
- Unusual segment patterns break alignment logic
- Mitigation: Comprehensive testing, fallback to sequential matching

---

## **Documentation Needs**

1. **User Guide:**
   - "Understanding Script Normalization"
   - "Working with Multilingual Transcripts"
   - "Segment Alignment Explained"

2. **Developer Docs:**
   - Architecture diagram of normalization pipeline
   - API docs for scriptNormalizer service
   - Alignment algorithm explanation

3. **Settings Help:**
   - Inline help text for each new setting
   - Link to comprehensive guide

4. **Release Notes:**
   - "What's New" highlighting multilingual support
   - Migration guide for existing evaluations

---

## **Summary: What Changes in Your Workflow**

### **Before (Current State):**
```
1. Upload Hindi audio + Devanagari transcript
2. Run evaluation
3. Get 65 differences (mostly script mismatches)
4. Manual review to find real issues
5. Frustration 😞
```

### **After Phase 1:**
```
1. Upload Hindi audio + Devanagari transcript
2. Set language hint: "Hindi" (optional - auto-detected)
3. Set script preference: "Auto" (recommended)
4. Run evaluation
5. System auto-normalizes to Romanized for comparison
6. Get 5-10 real differences (semantic/medical errors)
7. Review only meaningful issues
8. Success! 🎉
```

### **After Phase 2:**
```
1. Upload Hindi audio + Devanagari transcript
2. Settings auto-configured from previous eval
3. Run evaluation
4. System normalizes + aligns segments intelligently
5. Get aligned comparison view showing merged segments
6. See clear indication of 1:3 mappings, high confidence
7. Focus only on critical medical errors
8. Export clean evaluation report
9. Deploy with confidence 🚀
```

---

This plan provides you with complete user control (Approach 4), robust normalization (Approach 1), improved prompts (Approach 3), and smart alignment (Q4 Solution 2) while maintaining your existing two-call architecture with normalization between calls (Q3 Option A). 

**Ready for your review and feedback before implementation!**
