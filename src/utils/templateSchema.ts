import type {
  EvaluatorOutputField,
  EvaluatorFieldType,
  EvaluatorDisplayMode,
  FieldRole,
  EvaluatorThresholds,
} from '@/types';

type JsonObject = Record<string, unknown>;

interface PropSchema extends JsonObject {
  type?: string;
  description?: string;
  enum?: unknown;
  items?: unknown;
}

const PRIMITIVE_TYPES = new Set(['string', 'number', 'boolean', 'integer', 'array']);

const DISALLOWED_KEYS = ['oneOf', 'anyOf', 'allOf', '$ref', 'not', 'patternProperties'];

function fieldTypeToJsonType(t: EvaluatorFieldType): { type: string; extra?: JsonObject } {
  switch (t) {
    case 'number':
      return { type: 'number' };
    case 'text':
      return { type: 'string' };
    case 'boolean':
      return { type: 'boolean' };
    case 'array':
      return { type: 'array', extra: { items: { type: 'string' } } };
    case 'enum':
      return { type: 'string' };
  }
}

function jsonTypeToFieldType(prop: PropSchema): EvaluatorFieldType | null {
  const t = prop.type;
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'array') return 'array';
  if (t === 'string') {
    return Array.isArray(prop.enum) && prop.enum.length > 0 ? 'enum' : 'text';
  }
  return null;
}

export function outputFieldsToJsonSchema(fields: EvaluatorOutputField[]): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];

  for (const f of fields) {
    if (!f.key) continue;
    const { type, extra } = fieldTypeToJsonType(f.type);
    const prop: JsonObject = { type };
    if (f.description) prop.description = f.description;
    if (extra) Object.assign(prop, extra);
    if (f.type === 'enum' && f.enumValues?.length) prop.enum = [...f.enumValues];
    if (f.type === 'array' && f.arrayItemSchema) {
      const itemType = f.arrayItemSchema.itemType;
      if (itemType === 'object' && f.arrayItemSchema.properties?.length) {
        const itemProps: JsonObject = {};
        for (const ip of f.arrayItemSchema.properties) {
          itemProps[ip.key] = ip.description
            ? { type: ip.type, description: ip.description }
            : { type: ip.type };
        }
        prop.items = { type: 'object', properties: itemProps };
      } else {
        prop.items = { type: itemType };
      }
    }
    if (f.thresholds) prop['x-thresholds'] = { ...f.thresholds };
    prop['x-displayMode'] = f.displayMode;
    if (f.role) prop['x-role'] = f.role;
    if (f.isMainMetric) prop['x-isMainMetric'] = true;
    properties[f.key] = prop;
    required.push(f.key);
  }

  return {
    type: 'object',
    properties,
    required,
  };
}

export type ConversionResult =
  | { ok: true; fields: EvaluatorOutputField[] }
  | { ok: false; reason: string };

export function jsonSchemaToOutputFields(input: unknown): ConversionResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'Schema must be a JSON object.' };
  }
  const schema = input as JsonObject;

  for (const key of DISALLOWED_KEYS) {
    if (key in schema) {
      return { ok: false, reason: `Builder does not support \`${key}\` at the schema root.` };
    }
  }

  if (schema.type !== 'object') {
    return { ok: false, reason: 'Top-level `type` must be `"object"`.' };
  }

  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return { ok: false, reason: '`properties` is missing or not an object.' };
  }

  const requiredList = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const fields: EvaluatorOutputField[] = [];

  for (const [key, rawProp] of Object.entries(properties)) {
    if (!rawProp || typeof rawProp !== 'object' || Array.isArray(rawProp)) {
      return { ok: false, reason: `Property "${key}" is not an object.` };
    }
    const prop = rawProp as PropSchema;

    for (const k of DISALLOWED_KEYS) {
      if (k in prop) {
        return { ok: false, reason: `Property "${key}" uses \`${k}\` which the builder cannot edit.` };
      }
    }

    if ('properties' in prop) {
      return { ok: false, reason: `Property "${key}" has nested object properties.` };
    }

    if (prop.type === undefined || typeof prop.type !== 'string' || !PRIMITIVE_TYPES.has(prop.type)) {
      return { ok: false, reason: `Property "${key}" has unsupported type \`${String(prop.type)}\`.` };
    }

    const fieldType = jsonTypeToFieldType(prop);
    if (!fieldType) {
      return { ok: false, reason: `Property "${key}" type \`${prop.type}\` is not supported.` };
    }

    const xDisplay = prop['x-displayMode'] as EvaluatorDisplayMode | undefined;
    const xRole = prop['x-role'] as FieldRole | undefined;
    const xIsMain = prop['x-isMainMetric'] === true;
    const xThresholds = prop['x-thresholds'] as EvaluatorThresholds | undefined;

    const field: EvaluatorOutputField = {
      key,
      type: fieldType,
      description: typeof prop.description === 'string' ? prop.description : '',
      displayMode: xDisplay && ['header', 'card', 'hidden'].includes(xDisplay) ? xDisplay : 'card',
    };
    if (xRole && ['metric', 'reasoning', 'detail'].includes(xRole)) field.role = xRole;
    if (xIsMain) field.isMainMetric = true;
    if (xThresholds && typeof xThresholds === 'object') field.thresholds = xThresholds;

    if (fieldType === 'enum' && Array.isArray(prop.enum)) {
      field.enumValues = prop.enum.filter((v): v is string => typeof v === 'string');
    }

    if (fieldType === 'array') {
      const items = prop.items as JsonObject | undefined;
      if (items && typeof items === 'object') {
        const itemType = items.type;
        if (itemType === 'object') {
          const itemProperties = items.properties as JsonObject | undefined;
          if (itemProperties && typeof itemProperties === 'object') {
            const objectProps = Object.entries(itemProperties).map(([ik, ip]) => {
              const p = ip as PropSchema;
              const t = p.type;
              if (t !== 'string' && t !== 'number' && t !== 'boolean') {
                return null;
              }
              return {
                key: ik,
                type: t,
                description: typeof p.description === 'string' ? p.description : '',
              };
            });
            if (objectProps.some((p) => p === null)) {
              return { ok: false, reason: `Array "${key}" has an object item with unsupported field types.` };
            }
            field.arrayItemSchema = { itemType: 'object', properties: objectProps as Array<{ key: string; type: 'string' | 'number' | 'boolean'; description: string }> };
          } else {
            field.arrayItemSchema = { itemType: 'object' };
          }
        } else if (itemType === 'string' || itemType === 'number' || itemType === 'boolean') {
          field.arrayItemSchema = { itemType };
        }
      }
    }

    void requiredList; // required-list is informational; builder treats all fields as required

    fields.push(field);
  }

  if (fields.length === 0) {
    return { ok: false, reason: 'Schema has no properties.' };
  }

  return { ok: true, fields };
}

export function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}
