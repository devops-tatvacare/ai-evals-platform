"""Evaluation constants for the voice-rx pipeline.

All hardcoded prompts, schemas, display names, and normalization templates
for both upload and API flows. Separated from voice_rx_runner.py for
maintainability.
"""

# ═══════════════════════════════════════════════════════════════
# SCRIPT DISPLAY NAMES
# ═══════════════════════════════════════════════════════════════

SCRIPT_DISPLAY_NAMES = {
    "latin": "Latin (Roman/English alphabet)",
    "devanagari": "Devanagari",
    "arabic": "Arabic",
    "bengali": "Bengali",
    "tamil": "Tamil",
    "telugu": "Telugu",
    "kannada": "Kannada",
    "malayalam": "Malayalam",
    "gujarati": "Gujarati",
    "gurmukhi": "Gurmukhi",
    "odia": "Odia",
    "sinhala": "Sinhala",
    "cjk": "CJK (Chinese/Japanese)",
    "hangul": "Hangul (Korean)",
    "hiragana": "Hiragana",
    "katakana": "Katakana",
    "cyrillic": "Cyrillic",
    "thai": "Thai",
    "hebrew": "Hebrew",
    "greek": "Greek",
    "myanmar": "Myanmar",
    "ethiopic": "Ethiopic",
    "khmer": "Khmer",
    "georgian": "Georgian",
}


def resolve_script_name(script_id: str) -> str:
    """Convert a script ID to a human-readable name for use in prompts."""
    if not script_id or script_id == "auto":
        return ""  # Caller handles auto case
    return SCRIPT_DISPLAY_NAMES.get(script_id, script_id.title())


# ═══════════════════════════════════════════════════════════════
# NORMALIZATION PROMPTS & SCHEMAS
# ═══════════════════════════════════════════════════════════════

# {source_instruction} is either "from X script" or "auto-detect the source script"
# {target_script} is always a concrete script name (never "auto")
NORMALIZATION_PROMPT = """You are an expert multilingual transliteration specialist.

TASK: Transliterate the following transcript into {target_script} script.
{source_instruction}
Source language: {language}

CRITICAL: Every "text" field in your output MUST be written in {target_script} characters. Do NOT return text in the original script.

RULES:
1. Convert ALL text into {target_script} script using standard transliteration conventions for {language}
2. Preserve proper nouns, technical/medical terminology, and widely-known abbreviations in their original form
3. Keep speaker labels unchanged
4. Keep timestamps unchanged (startTime, endTime, startSeconds, endSeconds)
5. For code-switched content (multiple languages mixed), transliterate the {language} portions while keeping other language portions intact
6. Return EXACT same JSON structure with same number of segments
7. If the text is already in {target_script} script, return it unchanged

INPUT TRANSCRIPT:
{transcript_json}

OUTPUT: Return the transliterated transcript in JSON format. ALL text MUST be in {target_script} script."""

NORMALIZATION_PROMPT_PLAIN = """You are an expert multilingual transliteration specialist.

TASK: Transliterate the following transcript text into {target_script} script.
{source_instruction}
Source language: {language}

CRITICAL: Your output MUST be written entirely in {target_script} characters. Do NOT return text in the original script.

RULES:
1. Convert ALL text into {target_script} script using standard transliteration conventions for {language}
2. Preserve proper nouns, technical/medical terminology, and widely-known abbreviations in their original form
3. Keep speaker labels (e.g., [Doctor]:, [Patient]:) unchanged
4. For code-switched content (multiple languages mixed), transliterate the {language} portions while keeping other language portions intact
5. If the text is already in {target_script} script, return it unchanged
6. Preserve line breaks and formatting

INPUT TRANSCRIPT:
{transcript_text}

OUTPUT: Return the transliterated transcript text. ALL text MUST be in {target_script} script."""


def build_normalization_schema(target_script: str) -> dict:
    """Build normalization schema with target script constraint in text description."""
    return {
        "type": "object",
        "properties": {
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "speaker": {"type": "string"},
                        "text": {"type": "string", "description": f"Transliterated text — MUST be in {target_script} script"},
                        "startTime": {"type": "string", "description": "Exact start time in HH:MM:SS format — must match the original transcript time window exactly, do not modify or approximate"},
                        "endTime": {"type": "string", "description": "Exact end time in HH:MM:SS format — must match the original transcript time window exactly, do not modify or approximate"},
                    },
                    "required": ["speaker", "text", "startTime", "endTime"],
                },
            },
        },
        "required": ["segments"],
    }


def build_normalization_schema_plain(target_script: str) -> dict:
    """Build plain-text normalization schema with target script constraint."""
    return {
        "type": "object",
        "properties": {
            "normalized_text": {
                "type": "string",
                "description": f"The full transcript text transliterated into {target_script} script"
            },
        },
        "required": ["normalized_text"],
    }


# ═══════════════════════════════════════════════════════════════
# UPLOAD FLOW — EVALUATION PROMPT & SCHEMA
# ═══════════════════════════════════════════════════════════════

UPLOAD_EVALUATION_PROMPT = """You are an expert medical transcription auditor acting as a JUDGE.

═══════════════════════════════════════════════════════════════════════════════
TASK: SEGMENT-BY-SEGMENT TRANSCRIPT COMPARISON
═══════════════════════════════════════════════════════════════════════════════

Below is a pre-built comparison table with {segment_count} segments. Each row pairs the ORIGINAL transcript segment (system under test) with the JUDGE transcript segment (your reference from Call 1). Both cover the EXACT same time window.

Your job: For each segment, determine if there is a meaningful discrepancy. If the segments essentially match, do NOT include that segment in your output — only report segments with actual discrepancies.

═══════════════════════════════════════════════════════════════════════════════
SEGMENT COMPARISON TABLE
═══════════════════════════════════════════════════════════════════════════════

{comparison_table}

═══════════════════════════════════════════════════════════════════════════════
SEVERITY CLASSIFICATION
═══════════════════════════════════════════════════════════════════════════════

CRITICAL (Patient safety risk):
  - Medication dosage errors (10mg vs 100mg)
  - Wrong drug names (Celebrex vs Cerebyx)
  - Missed allergies or contraindications
  - Incorrect procedure/diagnosis

MODERATE (Clinical meaning affected):
  - Speaker misattribution affecting context
  - Missing medical history elements
  - Incomplete symptom descriptions

MINOR (No clinical impact):
  - Filler words (um, uh, you know)
  - Minor punctuation differences
  - Paraphrasing with same meaning

═══════════════════════════════════════════════════════════════════════════════
OUTPUT RULES
═══════════════════════════════════════════════════════════════════════════════

- ONLY output segments that have a discrepancy (severity != none)
- Segments not in your output are assumed to be matches
- For each discrepancy segment, provide: segmentIndex, severity, discrepancy description, likelyCorrect (original/judge/both/unclear), confidence, and category
- Provide an overallAssessment summarizing transcript quality
- Output structure is controlled by the schema — just provide the data"""

UPLOAD_EVALUATION_SCHEMA = {
    "type": "object",
    "properties": {
        "segments": {
            "type": "array",
            "description": "ONLY segments with discrepancies — omit matching segments",
            "items": {
                "type": "object",
                "properties": {
                    "segmentIndex": {"type": "number", "description": "Zero-based index of segment"},
                    "severity": {
                        "type": "string",
                        "enum": ["minor", "moderate", "critical"],
                        "description": "Clinical impact severity",
                    },
                    "discrepancy": {"type": "string", "description": "Description of the difference"},
                    "likelyCorrect": {
                        "type": "string",
                        "enum": ["original", "judge", "both", "unclear"],
                        "description": "Which transcript is likely correct",
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "Confidence in the determination",
                    },
                    "category": {"type": "string", "description": "Error category (e.g., dosage, speaker, terminology)"},
                },
                "required": ["segmentIndex", "severity", "discrepancy", "likelyCorrect"],
            },
        },
        "overallAssessment": {"type": "string", "description": "Summary of overall transcript quality"},
    },
    "required": ["segments", "overallAssessment"],
}

# ═══════════════════════════════════════════════════════════════
# API FLOW — EVALUATION PROMPT & SCHEMA
# ═══════════════════════════════════════════════════════════════

API_EVALUATION_PROMPT = """You are an expert Medical Informatics Auditor evaluating rx JSON accuracy.

═══════════════════════════════════════════════════════════════════════════════
TASK: JUDGE PRE-ALIGNED FIELD COMPARISONS
═══════════════════════════════════════════════════════════════════════════════

Below is a server-built comparison. Section 1 compares transcripts. Section 2
lists individual structured-data fields, already matched and aligned for you.

{comparison}

═══════════════════════════════════════════════════════════════════════════════
YOUR JOB
═══════════════════════════════════════════════════════════════════════════════

For EACH field entry in the structured data section:
1. Judge whether the API value and Judge value agree in CLINICAL MEANING
   (not exact string match — "500mg" and "500 mg" are the same)
2. Classify severity:
   - none: Semantically equivalent
   - minor: Cosmetic only (formatting, abbreviation, casing)
   - moderate: Clinically meaningful difference, not dangerous
   - critical: Patient safety concern (wrong dosage, wrong drug, missed allergy)
3. Write a brief critique explaining your reasoning
4. Assign confidence (low/medium/high)
5. If possible, quote a short snippet from the API TRANSCRIPT as evidence

For the TRANSCRIPT section:
- Summarize whether transcripts are semantically equivalent
- List significant discrepancies with severity

═══════════════════════════════════════════════════════════════════════════════
OUTPUT RULES
═══════════════════════════════════════════════════════════════════════════════

- Output ONE entry per field in structuredComparison.fields
- Use the EXACT fieldPath string from the comparison data
- Copy apiValue and judgeValue as-is from the comparison
- Provide an overallAssessment summarizing API quality
- Output structure is controlled by the schema — just provide the data"""

API_EVALUATION_SCHEMA = {
    "type": "object",
    "properties": {
        "transcriptComparison": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Summary of transcript comparison"},
                "discrepancies": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "severity": {"type": "string", "enum": ["minor", "moderate", "critical"]},
                        },
                        "required": ["description", "severity"],
                    },
                },
            },
            "required": ["summary"],
        },
        "structuredComparison": {
            "type": "object",
            "properties": {
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "fieldPath": {"type": "string", "description": "JSON path to the field"},
                            "apiValue": {"type": "string", "description": "Exact string value from the comparison data above"},
                            "judgeValue": {"type": "string", "description": "Exact string value from the comparison data above"},
                            "match": {"type": "boolean", "description": "Whether values match"},
                            "critique": {"type": "string", "description": "Explanation of difference or match"},
                            "severity": {
                                "type": "string",
                                "enum": ["none", "minor", "moderate", "critical"],
                            },
                            "confidence": {
                                "type": "string",
                                "enum": ["low", "medium", "high"],
                            },
                            "evidenceSnippet": {"type": "string", "description": "Short quote from the API transcript supporting this verdict"},
                        },
                        "required": ["fieldPath", "apiValue", "judgeValue", "match", "critique", "severity"],
                    },
                },
            },
            "required": ["fields"],
        },
        "overallAssessment": {"type": "string", "description": "Overall assessment of API system quality"},
    },
    "required": ["transcriptComparison", "structuredComparison", "overallAssessment"],
}
