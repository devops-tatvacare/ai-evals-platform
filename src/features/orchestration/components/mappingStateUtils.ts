export type MappingSourceKind = 'payload' | 'static';

export interface SourceKindMappingRow {
  source_kind: MappingSourceKind;
  payload_field?: string;
  static_value?: string;
}

export interface VariableMappingLike extends SourceKindMappingRow {
  agent_variable: string;
}

export function normalizeSourceKindMappingRow<T extends SourceKindMappingRow>(
  row: T,
  nextSourceKind: MappingSourceKind,
): T {
  const nextRow = {
    ...row,
    source_kind: nextSourceKind,
  } as T & { payload_field?: string; static_value?: string };

  if (nextSourceKind === 'payload') {
    nextRow.payload_field = typeof row.payload_field === 'string' ? row.payload_field : '';
    delete nextRow.static_value;
    return nextRow as T;
  }

  nextRow.static_value = typeof row.static_value === 'string' ? row.static_value : '';
  delete nextRow.payload_field;
  return nextRow as T;
}

export function reconcileVariableMappingsToParameters<T extends VariableMappingLike>(
  rows: T[],
  parameters: string[],
): T[] {
  const existingByVariable = new Map(rows.map((row) => [row.agent_variable, row]));
  return parameters.map((parameter) => {
    const existing = existingByVariable.get(parameter);
    if (!existing) {
      return {
        agent_variable: parameter,
        source_kind: 'payload',
        payload_field: '',
      } as T;
    }
    return normalizeSourceKindMappingRow(
      existing,
      existing.source_kind === 'static' ? 'static' : 'payload',
    );
  });
}

export function variableMappingsEqual(
  left: VariableMappingLike[],
  right: VariableMappingLike[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index];
    return (
      row.agent_variable === other.agent_variable &&
      row.source_kind === other.source_kind &&
      row.payload_field === other.payload_field &&
      row.static_value === other.static_value
    );
  });
}
