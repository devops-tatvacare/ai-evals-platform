import type { ReactNode } from 'react';
import type { AppFeaturesConfig } from '@/types';

// A tab's gating signals; resolveSettingsTabs reads the existing app-config + permission systems, never a parallel gate.
export interface SettingsTabSpec {
  id: string;
  label: string;
  content: ReactNode;
  /** App-config feature flag that must be true for the tab to exist. Omit = always present. */
  feature?: keyof AppFeaturesConfig;
  /** Permission action the user must hold. Omit = open to every signed-in user. */
  requires?: string;
}

export interface ResolvedSettingsTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface SettingsTabContext {
  features: AppFeaturesConfig;
  /** Reuse `userHasPermission(user, action)` — never a second permission store. */
  can: (action: string) => boolean;
}

export function resolveSettingsTabs(
  specs: SettingsTabSpec[],
  { features, can }: SettingsTabContext,
): ResolvedSettingsTab[] {
  return specs
    .filter((spec) => (spec.feature ? Boolean(features[spec.feature]) : true))
    .filter((spec) => (spec.requires ? can(spec.requires) : true))
    .map(({ id, label, content }) => ({ id, label, content }));
}
