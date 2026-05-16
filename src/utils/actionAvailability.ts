import { getAppSettingDefinition } from '@/features/settings/schemas/appSettingsSchema';
import type {
  AppConfig,
  AppId,
  AppActionRequirementConfig,
  AppActionRequirementValidation,
} from '@/types';

type ActionRequirementSources = {
  appSettings?: object;
  globalSettings?: object;
  tenantProviders?: object;
};

export interface ActionAvailabilityBlocker {
  key: string;
  kind: 'missing-requirement' | 'runtime';
  title: string;
  description: string;
}

export interface ActionRuntimeBlocker {
  key: string;
  isActive: boolean;
  title: string;
  description: string;
}

interface EvaluateActionAvailabilityOptions {
  appId: AppId;
  action: AppConfig['actions']['primaryNew'];
  sources: ActionRequirementSources;
  runtimeBlockers?: ActionRuntimeBlocker[];
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getRequirementValue(
  requirement: AppActionRequirementConfig,
  sources: ActionRequirementSources,
): unknown {
  const source = sources[requirement.source];
  if (!source || typeof source !== 'object') return undefined;
  return Reflect.get(source, requirement.key);
}

function isRequirementSatisfied(value: unknown, validation: AppActionRequirementValidation): boolean {
  if (validation === 'truthy') {
    return Boolean(value);
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return value !== null && value !== undefined;
}

function describeRequirement(appId: AppId, requirement: AppActionRequirementConfig): ActionAvailabilityBlocker {
  const settingDefinition =
    requirement.source === 'appSettings'
      ? getAppSettingDefinition(appId, requirement.key)
      : undefined;
  const label = requirement.label ?? settingDefinition?.label ?? humanizeKey(requirement.key);

  return {
    key: requirement.key,
    kind: 'missing-requirement',
    title: `${label} is missing`,
    description: `Configure ${label} in settings to continue.`,
  };
}

export function evaluateActionAvailability({
  appId,
  action,
  sources,
  runtimeBlockers = [],
}: EvaluateActionAvailabilityOptions): {
  disabled: boolean;
  blockers: ActionAvailabilityBlocker[];
} {
  const missingRequirementBlockers = action.requirements
    .filter((requirement) => {
      const value = getRequirementValue(requirement, sources);
      return !isRequirementSatisfied(value, requirement.validation ?? 'nonEmpty');
    })
    .map((requirement) => describeRequirement(appId, requirement));

  const activeRuntimeBlockers: ActionAvailabilityBlocker[] = runtimeBlockers
    .filter((blocker) => blocker.isActive)
    .map((blocker) => ({
      key: blocker.key,
      kind: 'runtime',
      title: blocker.title,
      description: blocker.description,
    }));

  const blockers = [...missingRequirementBlockers, ...activeRuntimeBlockers];
  return {
    disabled: blockers.length > 0,
    blockers,
  };
}
