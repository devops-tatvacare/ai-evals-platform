// Radix forbids `<Select.Item value="">`, so Select swaps '' for this sentinel
// at the Radix boundary and back on change — callers keep using '' for "All/Any".
export const EMPTY_OPTION_VALUE = '__select_empty_option__';

export const toRadixValue = (value: string): string =>
  value === '' ? EMPTY_OPTION_VALUE : value;

export const fromRadixValue = (value: string): string =>
  value === EMPTY_OPTION_VALUE ? '' : value;

// Only remap '' to the sentinel when an empty option exists; otherwise '' must
// reach Radix unchanged so the placeholder (nothing-selected) state still shows.
export const selectRootValue = (value: string, hasEmptyOption: boolean): string =>
  hasEmptyOption ? toRadixValue(value) : value;
