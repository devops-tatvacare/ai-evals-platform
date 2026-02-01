export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ErrorCode =
  // Storage errors (1xx)
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_MIGRATION_FAILED'
  // LLM errors (2xx)
  | 'LLM_API_KEY_MISSING'
  | 'LLM_API_KEY_INVALID'
  | 'LLM_RATE_LIMITED'
  | 'LLM_NETWORK_ERROR'
  | 'LLM_RESPONSE_INVALID'
  | 'LLM_TIMEOUT'
  | 'LLM_QUOTA_EXCEEDED'
  // File errors (3xx)
  | 'FILE_TYPE_UNSUPPORTED'
  | 'FILE_SIZE_EXCEEDED'
  | 'FILE_CORRUPTED'
  | 'FILE_UPLOAD_FAILED'
  // Audio errors (4xx)
  | 'AUDIO_DECODE_FAILED'
  | 'AUDIO_PLAYBACK_FAILED'
  // Transcript errors (5xx)
  | 'TRANSCRIPT_PARSE_FAILED'
  | 'TRANSCRIPT_FORMAT_INVALID'
  // General errors (9xx)
  | 'UNKNOWN_ERROR';

export interface ErrorAction {
  label: string;
  handler: () => void;
}

export interface AppError {
  id: string;
  code: ErrorCode;
  message: string;
  severity: ErrorSeverity;
  timestamp: Date;
  context?: Record<string, unknown>;
  recoverable: boolean;
  action?: ErrorAction;
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  STORAGE_QUOTA_EXCEEDED: 'Storage quota exceeded. Please delete some items.',
  STORAGE_READ_FAILED: 'Failed to read from storage.',
  STORAGE_WRITE_FAILED: 'Failed to save data.',
  STORAGE_MIGRATION_FAILED: 'Database migration failed.',
  LLM_API_KEY_MISSING: 'API key is not configured.',
  LLM_API_KEY_INVALID: 'Invalid API key.',
  LLM_RATE_LIMITED: 'Rate limit exceeded. Please try again later.',
  LLM_NETWORK_ERROR: 'Network error. Check your connection.',
  LLM_RESPONSE_INVALID: 'Invalid response from AI service.',
  LLM_TIMEOUT: 'Request timed out.',
  LLM_QUOTA_EXCEEDED: 'API quota exceeded.',
  FILE_TYPE_UNSUPPORTED: 'File type not supported.',
  FILE_SIZE_EXCEEDED: 'File size exceeds limit.',
  FILE_CORRUPTED: 'File appears to be corrupted.',
  FILE_UPLOAD_FAILED: 'Failed to upload file.',
  AUDIO_DECODE_FAILED: 'Failed to decode audio file.',
  AUDIO_PLAYBACK_FAILED: 'Audio playback failed.',
  TRANSCRIPT_PARSE_FAILED: 'Failed to parse transcript.',
  TRANSCRIPT_FORMAT_INVALID: 'Invalid transcript format.',
  UNKNOWN_ERROR: 'An unexpected error occurred.',
};
