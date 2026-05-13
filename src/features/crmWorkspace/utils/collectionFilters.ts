import type { AppCollectionDatasetConfig, AppCollectionFilterConfig } from '@/types';

type CollectionFilterValue = string | boolean | string[] | undefined;
export type CollectionFilterState = Record<string, CollectionFilterValue>;

export interface CollectionFilterPill {
  key: string;
  label: string;
  clearPatch: Record<string, string | boolean | string[]>;
}

function getFields(filter: AppCollectionFilterConfig): string[] {
  return filter.fields ?? [filter.key];
}

function getValue(state: object, field: string): CollectionFilterValue {
  return Reflect.get(state, field) as CollectionFilterValue;
}

function getOptionLabel(filter: AppCollectionFilterConfig, value: string): string {
  return filter.options?.find((option) => option.value === value)?.label ?? value;
}

function summarizeString(value: string): string {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return `${parts.length} selected`;
  }

  if (value.length > 24) {
    return `${value.slice(0, 21)}...`;
  }

  return value;
}

function isActiveValue(value: CollectionFilterValue): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return Boolean(value && value.trim());
}

function formatFilterValue(filter: AppCollectionFilterConfig, state: object): string | null {
  const [firstField, secondField] = getFields(filter);
  const primaryValue = getValue(state, firstField);

  switch (filter.control) {
    case 'multi-select':
      if (!Array.isArray(primaryValue) || primaryValue.length === 0) {
        return null;
      }
      if (primaryValue.length === 1) {
        return getOptionLabel(filter, primaryValue[0]);
      }
      return `${primaryValue.length} selected`;
    case 'segmented':
      if (typeof primaryValue !== 'string' || !primaryValue) {
        return null;
      }
      return getOptionLabel(filter, primaryValue);
    case 'number-range': {
      const minValue = typeof primaryValue === 'string' ? primaryValue.trim() : '';
      const maxValue = typeof getValue(state, secondField) === 'string'
        ? (getValue(state, secondField) as string).trim()
        : '';
      if (minValue && maxValue) {
        return `${minValue}-${maxValue}s`;
      }
      if (minValue) {
        return `>= ${minValue}s`;
      }
      if (maxValue) {
        return `<= ${maxValue}s`;
      }
      return null;
    }
    case 'toggle':
      return typeof primaryValue === 'boolean' && primaryValue ? filter.label : null;
    case 'text':
      if (typeof primaryValue !== 'string' || !primaryValue.trim()) {
        return null;
      }
      return summarizeString(primaryValue.trim());
    default:
      return null;
  }
}

export function getFilterClearPatch(filter: AppCollectionFilterConfig): Record<string, string | boolean | string[]> {
  const fields = getFields(filter);

  switch (filter.control) {
    case 'multi-select':
      return { [fields[0]]: [] };
    case 'toggle':
      return { [fields[0]]: false };
    case 'number-range':
      return Object.fromEntries(fields.map((field) => [field, '']));
    case 'segmented':
    case 'text':
      return { [fields[0]]: '' };
    default:
      return {};
  }
}

export function isCollectionFilterActive(
  filter: AppCollectionFilterConfig,
  state: object,
): boolean {
  return getFields(filter).some((field) => isActiveValue(getValue(state, field)));
}

export function countActiveCollectionFilters(
  datasetConfig: AppCollectionDatasetConfig | undefined,
  state: object,
): number {
  if (!datasetConfig) {
    return 0;
  }

  return datasetConfig.filters.filter((filter) => isCollectionFilterActive(filter, state)).length;
}

export function buildCollectionFilterPills(
  datasetConfig: AppCollectionDatasetConfig | undefined,
  state: object,
): CollectionFilterPill[] {
  if (!datasetConfig) {
    return [];
  }

  return datasetConfig.filters.flatMap((filter) => {
    const formattedValue = formatFilterValue(filter, state);
    if (!formattedValue) {
      return [];
    }

    return [{
      key: filter.key,
      label: filter.control === 'toggle'
        ? (filter.pillLabel ?? filter.label)
        : `${filter.pillLabel ?? filter.label}: ${formattedValue}`,
      clearPatch: getFilterClearPatch(filter),
    }];
  });
}
