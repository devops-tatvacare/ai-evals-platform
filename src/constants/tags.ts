/**
 * Tag System Constants
 */

export const TAG_LIMITS = {
  MAX_TAG_LENGTH: 50,
  MAX_TAGS_PER_MESSAGE: 10,
  MAX_TAG_NAME_DISPLAY_LENGTH: 30,
} as const;

export const TAG_VALIDATION = {
  PATTERN: /^[a-z0-9\s-]+$/i,
  MIN_LENGTH: 1,
} as const;
