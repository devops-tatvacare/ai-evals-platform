import { useMemo } from 'react';

import { Combobox } from '@/components/ui/Combobox';
import { Select } from '@/components/ui/Select';
import {
  InspectorEmptyState,
  InspectorField,
  InspectorSection,
} from '@/features/orchestration/components/inspector/InspectorPrimitives';
import { useCohort, useCohorts } from '@/features/orchestration/queries/cohorts';
import { useCurrentAppId } from '@/hooks';

interface Props {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

interface SavedCohortConfig {
  cohort_definition_version_id?: string;
}

export function SavedCohortPicker({ value, onChange }: Props) {
  const appId = useCurrentAppId();
  const cfg = value as SavedCohortConfig;
  const { data: cohorts = [] } = useCohorts(appId);

  // Reverse-lookup the cohort that owns the currently-pinned version. The
  // list response now carries `versionIds` (every version id this cohort
  // owns), so a workflow pinned to an older version still pre-selects
  // correctly — D9 version-pinning case.
  const resolvedCohortId = useMemo(() => {
    if (!cfg.cohort_definition_version_id) return '';
    for (const c of cohorts) {
      if (c.versionIds?.includes(cfg.cohort_definition_version_id)) return c.id;
    }
    return '';
  }, [cfg.cohort_definition_version_id, cohorts]);

  const { data: detail } = useCohort(resolvedCohortId || null);

  const cohortOptions = useMemo(
    () =>
      cohorts.map((c) => ({
        value: c.id,
        label: c.name,
        description: c.latestVersion?.sourceRef,
      })),
    [cohorts],
  );

  const versionOptions = useMemo(() => {
    if (!detail) return [];
    return detail.versions.map((v) => ({
      value: v.id,
      label: `v${v.version} — ${v.status}`,
    }));
  }, [detail]);

  function setCohort(cohortId: string) {
    const cohort = cohorts.find((c) => c.id === cohortId);
    const versionId =
      cohort?.currentPublishedVersionId ?? cohort?.latestVersion?.id ?? '';
    onChange({
      ...value,
      cohort_definition_version_id: versionId,
    });
  }

  function setVersion(versionId: string) {
    onChange({
      ...value,
      cohort_definition_version_id: versionId,
    });
  }

  if (cohorts.length === 0) {
    return (
      <InspectorSection title="Cohort">
        <InspectorEmptyState>
          No saved cohorts yet. Create one from Campaigns → Cohorts.
        </InspectorEmptyState>
      </InspectorSection>
    );
  }

  return (
    <InspectorSection title="Cohort">
      <InspectorField
        label="Cohort"
        description="Editing a saved cohort affects every workflow that uses it on the next run."
      >
        <Combobox
          value={resolvedCohortId}
          onChange={setCohort}
          options={cohortOptions}
          placeholder="Pick a saved cohort…"
        />
      </InspectorField>
      {resolvedCohortId ? (
        <InspectorField
          label="Version"
          description="Republish this workflow to use newer cohort versions."
        >
          <Select
            value={cfg.cohort_definition_version_id ?? ''}
            onChange={setVersion}
            options={versionOptions}
            placeholder="Pick a version…"
          />
        </InspectorField>
      ) : null}
    </InspectorSection>
  );
}
