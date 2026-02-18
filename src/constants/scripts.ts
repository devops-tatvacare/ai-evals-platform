/**
 * Writing system registry with Unicode detection ranges.
 * Used by script detector, EvaluationOverlay selectors, and settings UI.
 */

import { findLanguage } from './languages';

export interface ScriptEntry {
  id: string;             // Lowercase key (e.g., "devanagari")
  name: string;           // Display name with native sample
  unicodeRanges: RegExp[];  // For character-level detection
  sample: string;         // Brief sample text for UI hint
}

export const SCRIPTS: ScriptEntry[] = [
  { id: "auto", name: "Auto-detect", unicodeRanges: [], sample: "" },
  { id: "latin", name: "Latin (Roman)", unicodeRanges: [/[a-zA-Z]/], sample: "ABC abc" },
  { id: "devanagari", name: "Devanagari (देवनागरी)", unicodeRanges: [/[\u0900-\u097F]/], sample: "अ आ इ" },
  { id: "arabic", name: "Arabic (العربية)", unicodeRanges: [/[\u0600-\u06FF]/], sample: "ا ب ت" },
  { id: "bengali", name: "Bengali (বাংলা)", unicodeRanges: [/[\u0980-\u09FF]/], sample: "অ আ ই" },
  { id: "tamil", name: "Tamil (தமிழ்)", unicodeRanges: [/[\u0B80-\u0BFF]/], sample: "அ ஆ இ" },
  { id: "telugu", name: "Telugu (తెలుగు)", unicodeRanges: [/[\u0C00-\u0C7F]/], sample: "అ ఆ ఇ" },
  { id: "kannada", name: "Kannada (ಕನ್ನಡ)", unicodeRanges: [/[\u0C80-\u0CFF]/], sample: "ಅ ಆ ಇ" },
  { id: "malayalam", name: "Malayalam (മലയാളം)", unicodeRanges: [/[\u0D00-\u0D7F]/], sample: "അ ആ ഇ" },
  { id: "gujarati", name: "Gujarati (ગુજરાતી)", unicodeRanges: [/[\u0A80-\u0AFF]/], sample: "અ આ ઇ" },
  { id: "gurmukhi", name: "Gurmukhi (ਗੁਰਮੁਖੀ)", unicodeRanges: [/[\u0A00-\u0A7F]/], sample: "ਅ ਆ ਇ" },
  { id: "odia", name: "Odia (ଓଡ଼ିଆ)", unicodeRanges: [/[\u0B00-\u0B7F]/], sample: "ଅ ଆ ଇ" },
  { id: "sinhala", name: "Sinhala (සිංහල)", unicodeRanges: [/[\u0D80-\u0DFF]/], sample: "අ ආ ඇ" },
  { id: "cjk", name: "CJK (Chinese/Japanese)", unicodeRanges: [/[\u4E00-\u9FFF]/], sample: "中文字" },
  { id: "hangul", name: "Hangul (한글)", unicodeRanges: [/[\uAC00-\uD7AF]/], sample: "가 나 다" },
  { id: "hiragana", name: "Hiragana (ひらがな)", unicodeRanges: [/[\u3040-\u309F]/], sample: "あ い う" },
  { id: "katakana", name: "Katakana (カタカナ)", unicodeRanges: [/[\u30A0-\u30FF]/], sample: "ア イ ウ" },
  { id: "cyrillic", name: "Cyrillic (Кириллица)", unicodeRanges: [/[\u0400-\u04FF]/], sample: "А Б В" },
  { id: "thai", name: "Thai (ไทย)", unicodeRanges: [/[\u0E00-\u0E7F]/], sample: "ก ข ค" },
  { id: "hebrew", name: "Hebrew (עברית)", unicodeRanges: [/[\u0590-\u05FF]/], sample: "א ב ג" },
  { id: "greek", name: "Greek (Ελληνικά)", unicodeRanges: [/[\u0370-\u03FF]/], sample: "Α Β Γ" },
  { id: "myanmar", name: "Myanmar (မြန်မာ)", unicodeRanges: [/[\u1000-\u109F]/], sample: "က ခ ဂ" },
  { id: "ethiopic", name: "Ethiopic (ግዕዝ)", unicodeRanges: [/[\u1200-\u137F]/], sample: "ሀ ሁ ሂ" },
  { id: "khmer", name: "Khmer (ខ្មែរ)", unicodeRanges: [/[\u1780-\u17FF]/], sample: "ក ខ គ" },
  { id: "georgian", name: "Georgian (ქართული)", unicodeRanges: [/[\u10A0-\u10FF]/], sample: "ა ბ გ" },
];

/** Get scripts associated with a language code via the languages registry */
export function getScriptsForLanguage(languageCode: string): ScriptEntry[] {
  const lang = findLanguage(languageCode);
  if (!lang || lang.defaultScripts.length === 0) return SCRIPTS.filter((s) => s.id !== "auto");
  return lang.defaultScripts
    .map((id) => SCRIPTS.find((s) => s.id === id))
    .filter((s): s is ScriptEntry => !!s);
}

/** Find a script entry by its ID */
export function findScript(id: string): ScriptEntry | undefined {
  return SCRIPTS.find((s) => s.id === id);
}

/** Get all script entries excluding "auto" (for target script selection) */
export function getTargetScripts(): ScriptEntry[] {
  return SCRIPTS.filter((s) => s.id !== "auto");
}

/** Get script options suitable for <select> / SearchableSelect */
export function getScriptOptions(): Array<{ value: string; label: string }> {
  return SCRIPTS.map((s) => ({ value: s.id, label: s.name }));
}
