export type RunType = 'batch' | 'adversarial' | 'thread' | 'custom';

export const RUN_TYPE_CONFIG: Record<RunType, { color: string; label: string }> = {
  batch:       { color: 'var(--color-type-batch)',       label: 'BATCH' },
  adversarial: { color: 'var(--color-type-adversarial)', label: 'ADVERSARIAL' },
  thread:      { color: 'var(--color-type-thread)',      label: 'THREAD' },
  custom:      { color: 'var(--color-type-custom)',      label: 'CUSTOM' },
};
