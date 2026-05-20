import { describe, expect, it } from 'vitest';
import { EMPTY_OPTION_VALUE, fromRadixValue, selectRootValue, toRadixValue } from '../selectValue';

describe('Select empty-value contract', () => {
  it('never hands Radix an empty-string Item value', () => {
    expect(EMPTY_OPTION_VALUE).not.toBe('');
    expect(toRadixValue('')).toBe(EMPTY_OPTION_VALUE);
  });

  it('passes non-empty values through unchanged in both directions', () => {
    expect(toRadixValue('sent')).toBe('sent');
    expect(fromRadixValue('sent')).toBe('sent');
  });

  it('maps the sentinel back to the empty string callers expect', () => {
    expect(fromRadixValue(EMPTY_OPTION_VALUE)).toBe('');
  });

  it('selects the empty option when one exists, but preserves the placeholder otherwise', () => {
    // '' with an "All" option present → must resolve to the sentinel so the option shows selected.
    expect(selectRootValue('', true)).toBe(EMPTY_OPTION_VALUE);
    // '' with no empty option → must stay '' so Radix shows the placeholder (nothing selected).
    expect(selectRootValue('', false)).toBe('');
    // Real values pass through regardless.
    expect(selectRootValue('sent', true)).toBe('sent');
    expect(selectRootValue('sent', false)).toBe('sent');
  });
});
