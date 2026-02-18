/**
 * Curated language registry with ISO 639-1 codes, native names, flags, and default scripts.
 * Used by EvaluationOverlay and settings UI for data-driven language selection.
 */

export interface LanguageEntry {
  code: string;          // ISO 639-1 (e.g., "hi")
  name: string;          // English name (e.g., "Hindi")
  nativeName: string;    // Native name (e.g., "हिन्दी")
  flag: string;          // Country flag emoji (e.g., "🇮🇳")
  defaultScripts: string[];  // Default writing systems (e.g., ["devanagari", "latin"])
}

export const LANGUAGES: LanguageEntry[] = [
  // Special entries
  { code: "auto", name: "Auto-detect", nativeName: "", flag: "🔍", defaultScripts: [] },

  // Indian languages (primary use case)
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳", defaultScripts: ["devanagari", "latin"] },
  { code: "hi-en", name: "Hinglish", nativeName: "Hinglish", flag: "🇮🇳", defaultScripts: ["devanagari", "latin"] },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", flag: "🇮🇳", defaultScripts: ["tamil", "latin"] },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", flag: "🇮🇳", defaultScripts: ["telugu", "latin"] },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", flag: "🇮🇳", defaultScripts: ["kannada", "latin"] },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം", flag: "🇮🇳", defaultScripts: ["malayalam", "latin"] },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", flag: "🇮🇳", defaultScripts: ["bengali", "latin"] },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", flag: "🇮🇳", defaultScripts: ["gujarati", "latin"] },
  { code: "mr", name: "Marathi", nativeName: "मराठी", flag: "🇮🇳", defaultScripts: ["devanagari", "latin"] },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", flag: "🇮🇳", defaultScripts: ["gurmukhi", "latin"] },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", flag: "🇮🇳", defaultScripts: ["odia", "latin"] },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া", flag: "🇮🇳", defaultScripts: ["bengali", "latin"] },
  { code: "ur", name: "Urdu", nativeName: "اردو", flag: "🇵🇰", defaultScripts: ["arabic", "latin"] },
  { code: "sa", name: "Sanskrit", nativeName: "संस्कृतम्", flag: "🇮🇳", defaultScripts: ["devanagari", "latin"] },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", flag: "🇳🇵", defaultScripts: ["devanagari", "latin"] },
  { code: "si", name: "Sinhala", nativeName: "සිංහල", flag: "🇱🇰", defaultScripts: ["sinhala", "latin"] },

  // Major world languages
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", defaultScripts: ["latin"] },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", defaultScripts: ["latin"] },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", defaultScripts: ["latin"] },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", defaultScripts: ["latin"] },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇧🇷", defaultScripts: ["latin"] },
  { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹", defaultScripts: ["latin"] },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱", defaultScripts: ["latin"] },
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", defaultScripts: ["cyrillic", "latin"] },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦", defaultScripts: ["cyrillic", "latin"] },
  { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱", defaultScripts: ["latin"] },
  { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", defaultScripts: ["latin"] },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina", flag: "🇸🇰", defaultScripts: ["latin"] },
  { code: "bg", name: "Bulgarian", nativeName: "Български", flag: "🇧🇬", defaultScripts: ["cyrillic", "latin"] },
  { code: "sr", name: "Serbian", nativeName: "Српски", flag: "🇷🇸", defaultScripts: ["cyrillic", "latin"] },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski", flag: "🇭🇷", defaultScripts: ["latin"] },
  { code: "ro", name: "Romanian", nativeName: "Română", flag: "🇷🇴", defaultScripts: ["latin"] },
  { code: "hu", name: "Hungarian", nativeName: "Magyar", flag: "🇭🇺", defaultScripts: ["latin"] },
  { code: "el", name: "Greek", nativeName: "Ελληνικά", flag: "🇬🇷", defaultScripts: ["greek", "latin"] },
  { code: "da", name: "Danish", nativeName: "Dansk", flag: "🇩🇰", defaultScripts: ["latin"] },
  { code: "sv", name: "Swedish", nativeName: "Svenska", flag: "🇸🇪", defaultScripts: ["latin"] },
  { code: "no", name: "Norwegian", nativeName: "Norsk", flag: "🇳🇴", defaultScripts: ["latin"] },
  { code: "fi", name: "Finnish", nativeName: "Suomi", flag: "🇫🇮", defaultScripts: ["latin"] },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių", flag: "🇱🇹", defaultScripts: ["latin"] },
  { code: "lv", name: "Latvian", nativeName: "Latviešu", flag: "🇱🇻", defaultScripts: ["latin"] },
  { code: "et", name: "Estonian", nativeName: "Eesti", flag: "🇪🇪", defaultScripts: ["latin"] },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina", flag: "🇸🇮", defaultScripts: ["latin"] },
  { code: "sq", name: "Albanian", nativeName: "Shqip", flag: "🇦🇱", defaultScripts: ["latin"] },
  { code: "mk", name: "Macedonian", nativeName: "Македонски", flag: "🇲🇰", defaultScripts: ["cyrillic", "latin"] },
  { code: "bs", name: "Bosnian", nativeName: "Bosanski", flag: "🇧🇦", defaultScripts: ["latin"] },
  { code: "is", name: "Icelandic", nativeName: "Íslenska", flag: "🇮🇸", defaultScripts: ["latin"] },
  { code: "ga", name: "Irish", nativeName: "Gaeilge", flag: "🇮🇪", defaultScripts: ["latin"] },
  { code: "cy", name: "Welsh", nativeName: "Cymraeg", flag: "🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}", defaultScripts: ["latin"] },
  { code: "mt", name: "Maltese", nativeName: "Malti", flag: "🇲🇹", defaultScripts: ["latin"] },
  { code: "ca", name: "Catalan", nativeName: "Català", flag: "🇪🇸", defaultScripts: ["latin"] },
  { code: "eu", name: "Basque", nativeName: "Euskara", flag: "🇪🇸", defaultScripts: ["latin"] },
  { code: "gl", name: "Galician", nativeName: "Galego", flag: "🇪🇸", defaultScripts: ["latin"] },

  // Middle Eastern / North African
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦", defaultScripts: ["arabic", "latin"] },
  { code: "he", name: "Hebrew", nativeName: "עברית", flag: "🇮🇱", defaultScripts: ["hebrew", "latin"] },
  { code: "fa", name: "Persian", nativeName: "فارسی", flag: "🇮🇷", defaultScripts: ["arabic", "latin"] },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷", defaultScripts: ["latin"] },
  { code: "ku", name: "Kurdish", nativeName: "Kurdî", flag: "🇮🇶", defaultScripts: ["arabic", "latin"] },
  { code: "ps", name: "Pashto", nativeName: "پښتو", flag: "🇦🇫", defaultScripts: ["arabic", "latin"] },

  // East Asian
  { code: "zh", name: "Chinese (Mandarin)", nativeName: "中文", flag: "🇨🇳", defaultScripts: ["cjk", "latin"] },
  { code: "zh-TW", name: "Chinese (Traditional)", nativeName: "繁體中文", flag: "🇹🇼", defaultScripts: ["cjk", "latin"] },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵", defaultScripts: ["cjk", "hiragana", "katakana", "latin"] },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷", defaultScripts: ["hangul", "latin"] },
  { code: "mn", name: "Mongolian", nativeName: "Монгол", flag: "🇲🇳", defaultScripts: ["cyrillic", "latin"] },

  // Southeast Asian
  { code: "th", name: "Thai", nativeName: "ไทย", flag: "🇹🇭", defaultScripts: ["thai", "latin"] },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳", defaultScripts: ["latin"] },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "🇮🇩", defaultScripts: ["latin"] },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu", flag: "🇲🇾", defaultScripts: ["latin"] },
  { code: "tl", name: "Filipino", nativeName: "Filipino", flag: "🇵🇭", defaultScripts: ["latin"] },
  { code: "my", name: "Burmese", nativeName: "မြန်မာဘာသာ", flag: "🇲🇲", defaultScripts: ["myanmar", "latin"] },
  { code: "km", name: "Khmer", nativeName: "ភាសាខ្មែរ", flag: "🇰🇭", defaultScripts: ["khmer", "latin"] },
  { code: "lo", name: "Lao", nativeName: "ລາວ", flag: "🇱🇦", defaultScripts: ["thai", "latin"] },

  // Central Asian
  { code: "kk", name: "Kazakh", nativeName: "Қазақша", flag: "🇰🇿", defaultScripts: ["cyrillic", "latin"] },
  { code: "uz", name: "Uzbek", nativeName: "Oʻzbekcha", flag: "🇺🇿", defaultScripts: ["latin", "cyrillic"] },
  { code: "ky", name: "Kyrgyz", nativeName: "Кыргызча", flag: "🇰🇬", defaultScripts: ["cyrillic", "latin"] },
  { code: "tg", name: "Tajik", nativeName: "Тоҷикӣ", flag: "🇹🇯", defaultScripts: ["cyrillic", "latin"] },
  { code: "tk", name: "Turkmen", nativeName: "Türkmençe", flag: "🇹🇲", defaultScripts: ["latin"] },

  // Caucasian
  { code: "ka", name: "Georgian", nativeName: "ქართული", flag: "🇬🇪", defaultScripts: ["georgian", "latin"] },
  { code: "hy", name: "Armenian", nativeName: "Հայերեն", flag: "🇦🇲", defaultScripts: ["latin"] },
  { code: "az", name: "Azerbaijani", nativeName: "Azərbaycanca", flag: "🇦🇿", defaultScripts: ["latin"] },

  // African
  { code: "sw", name: "Swahili", nativeName: "Kiswahili", flag: "🇰🇪", defaultScripts: ["latin"] },
  { code: "am", name: "Amharic", nativeName: "አማርኛ", flag: "🇪🇹", defaultScripts: ["ethiopic", "latin"] },
  { code: "ha", name: "Hausa", nativeName: "Hausa", flag: "🇳🇬", defaultScripts: ["latin", "arabic"] },
  { code: "yo", name: "Yoruba", nativeName: "Yorùbá", flag: "🇳🇬", defaultScripts: ["latin"] },
  { code: "ig", name: "Igbo", nativeName: "Igbo", flag: "🇳🇬", defaultScripts: ["latin"] },
  { code: "zu", name: "Zulu", nativeName: "isiZulu", flag: "🇿🇦", defaultScripts: ["latin"] },
  { code: "xh", name: "Xhosa", nativeName: "isiXhosa", flag: "🇿🇦", defaultScripts: ["latin"] },
  { code: "af", name: "Afrikaans", nativeName: "Afrikaans", flag: "🇿🇦", defaultScripts: ["latin"] },
  { code: "so", name: "Somali", nativeName: "Soomaali", flag: "🇸🇴", defaultScripts: ["latin"] },
  { code: "rw", name: "Kinyarwanda", nativeName: "Ikinyarwanda", flag: "🇷🇼", defaultScripts: ["latin"] },
  { code: "mg", name: "Malagasy", nativeName: "Malagasy", flag: "🇲🇬", defaultScripts: ["latin"] },
  { code: "sn", name: "Shona", nativeName: "chiShona", flag: "🇿🇼", defaultScripts: ["latin"] },
  { code: "ny", name: "Chichewa", nativeName: "Chicheŵa", flag: "🇲🇼", defaultScripts: ["latin"] },
  { code: "ti", name: "Tigrinya", nativeName: "ትግርኛ", flag: "🇪🇷", defaultScripts: ["ethiopic", "latin"] },
  { code: "om", name: "Oromo", nativeName: "Afaan Oromoo", flag: "🇪🇹", defaultScripts: ["latin"] },
  { code: "ln", name: "Lingala", nativeName: "Lingála", flag: "🇨🇩", defaultScripts: ["latin"] },
  { code: "wo", name: "Wolof", nativeName: "Wolof", flag: "🇸🇳", defaultScripts: ["latin"] },

  // Other European
  { code: "be", name: "Belarusian", nativeName: "Беларуская", flag: "🇧🇾", defaultScripts: ["cyrillic", "latin"] },
  { code: "lb", name: "Luxembourgish", nativeName: "Lëtzebuergesch", flag: "🇱🇺", defaultScripts: ["latin"] },

  // Code-mixed varieties
  { code: "es-en", name: "Spanglish", nativeName: "Spanglish", flag: "🇺🇸", defaultScripts: ["latin"] },
  { code: "tl-en", name: "Taglish", nativeName: "Taglish", flag: "🇵🇭", defaultScripts: ["latin"] },

  // Additional languages
  { code: "eo", name: "Esperanto", nativeName: "Esperanto", flag: "🌐", defaultScripts: ["latin"] },
  { code: "la", name: "Latin", nativeName: "Latina", flag: "🏛️", defaultScripts: ["latin"] },
  { code: "jv", name: "Javanese", nativeName: "Basa Jawa", flag: "🇮🇩", defaultScripts: ["latin"] },
  { code: "su", name: "Sundanese", nativeName: "Basa Sunda", flag: "🇮🇩", defaultScripts: ["latin"] },
  { code: "ceb", name: "Cebuano", nativeName: "Cebuano", flag: "🇵🇭", defaultScripts: ["latin"] },
  { code: "ht", name: "Haitian Creole", nativeName: "Kreyòl Ayisyen", flag: "🇭🇹", defaultScripts: ["latin"] },
  { code: "mi", name: "Maori", nativeName: "Te Reo Māori", flag: "🇳🇿", defaultScripts: ["latin"] },
  { code: "haw", name: "Hawaiian", nativeName: "ʻŌlelo Hawaiʻi", flag: "🇺🇸", defaultScripts: ["latin"] },
  { code: "sm", name: "Samoan", nativeName: "Gagana Sāmoa", flag: "🇼🇸", defaultScripts: ["latin"] },
];

/** Find a language entry by its ISO code */
export function findLanguage(code: string): LanguageEntry | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/** Search languages by name, native name, or code */
export function searchLanguages(query: string): LanguageEntry[] {
  if (!query.trim()) return LANGUAGES;
  const q = query.toLowerCase().trim();
  return LANGUAGES.filter(
    (l) =>
      l.name.toLowerCase().includes(q) ||
      l.nativeName.toLowerCase().includes(q) ||
      l.code.toLowerCase().includes(q),
  );
}

/** Get display label for a language: "🇮🇳 Hindi (हिन्दी)" */
export function getLanguageLabel(entry: LanguageEntry): string {
  if (!entry.nativeName || entry.name === entry.nativeName) {
    return `${entry.flag} ${entry.name}`;
  }
  return `${entry.flag} ${entry.name} (${entry.nativeName})`;
}
