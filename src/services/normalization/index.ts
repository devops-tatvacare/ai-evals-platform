/**
 * Normalization Service
 * Exports script detection and transliteration functions
 */

export { detectTranscriptScript, detectSegmentScript, scriptsMatch } from './scriptDetector';
export { NormalizationService, createNormalizationService } from './normalizationService';
