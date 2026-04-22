export type LaunchSource = 'canonical_run' | 'canonical_config' | 'explicit_params';

export interface Schedule {
  id: string;
  tenantId: string;
  appId: string;
  jobType: string;
  scheduleKey: string;
  name: string;
  description: string | null;
  cron: string;
  params: Record<string, unknown>;
  override: ScheduleOverride;
  enabled: boolean;
  nextCheckAt: string | null;
  currentCycleStartedAt: string | null;
  currentCycleAttempts: number;
  lastFireAt: string | null;
  lastFireJobId: string | null;
  lastSkipReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleOverride {
  skipCriteria?: SkipCriterion[];
  retryCount?: number;
  retryIntervalMinutes?: number;
  onExhaust?: 'wait_next_tick';
  [key: string]: unknown;
}

export interface SkipCriterion {
  type: string;
  scope?: string;
  [key: string]: unknown;
}

export interface ScheduleFireSummary {
  id: string;
  jobType: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface ScheduleDetailResponse {
  schedule: Schedule;
  recentFires: ScheduleFireSummary[];
}

export interface RegisteredPredicate {
  id: string;
  label: string;
  description: string;
  defaultScope: string | null;
  supportedScopes: string[];
}

export interface RegisteredWorkload {
  appId: string;
  jobType: string;
  label: string;
  description: string;
  launchSource: LaunchSource;
  sourceListEndpoint: string | null;
  defaultParams: Record<string, unknown>;
}

export interface ScheduleRegistryResponse {
  predicates: RegisteredPredicate[];
  workloads: RegisteredWorkload[];
  apps: string[];
  onExhaustModes: string[];
}

export interface ScheduleCreateInput {
  appId: string;
  jobType: string;
  scheduleKey: string;
  name: string;
  description?: string | null;
  cron: string;
  params?: Record<string, unknown>;
  override?: ScheduleOverride;
  enabled?: boolean;
}

export interface ScheduleUpdateInput {
  name?: string;
  description?: string | null;
  cron?: string;
  params?: Record<string, unknown>;
  override?: ScheduleOverride;
  enabled?: boolean;
}
