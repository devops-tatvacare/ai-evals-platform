import type { Run } from '@/types';
import type { KairaBotSettings } from '@/stores/appSettingsStore';

interface GlobalTimeouts {
  textOnly: number;
  withSchema: number;
  withAudio: number;
  withAudioAndSchema: number;
}

export function buildAdversarialRetryParams(args: {
  run: Run;
  kairaSettings: KairaBotSettings;
  timeouts: GlobalTimeouts;
  retryEvalIds: number[];
  sourceRunId: string;
  nameSuffix?: string;
}): Record<string, unknown> {
  const { run, kairaSettings, timeouts, retryEvalIds, sourceRunId, nameSuffix } = args;
  const batchMetadata = run.batch_metadata ?? {};
  const credentialPool = resolveAdversarialCredentialPool(run, kairaSettings);
  const primaryCredential = credentialPool[0];

  return {
    name: `${run.name || 'Adversarial Stress Test'}${nameSuffix ? ` ${nameSuffix}` : ' Retry'}`,
    description: run.description || null,
    kaira_chat_user_id: primaryCredential?.userId ?? '',
    kaira_api_url: (batchMetadata.kaira_api_url as string | undefined) ?? kairaSettings.kairaApiUrl,
    kaira_auth_token: primaryCredential?.authToken || null,
    kaira_credential_pool: credentialPool.map((credential) => ({
      user_id: credential.userId,
      auth_token: credential.authToken,
    })),
    kaira_timeout: (batchMetadata.kaira_timeout as number | undefined) ?? 120,
    test_count: 0,
    turn_delay: (batchMetadata.turn_delay as number | undefined) ?? 1.5,
    case_delay: (batchMetadata.case_delay as number | undefined) ?? 0,
    llm_provider: run.llm_provider,
    llm_model: run.llm_model,
    temperature: run.eval_temperature ?? 0.1,
    thinking: (batchMetadata.thinking as string | undefined) ?? 'low',
    parallel_cases: (batchMetadata.parallel_cases as boolean | undefined) || undefined,
    case_workers: (batchMetadata.case_workers as number | undefined) || undefined,
    selected_personas: (batchMetadata.selected_personas as string[] | undefined) || undefined,
    selected_rule_ids: (batchMetadata.selected_rule_ids as string[] | undefined) || undefined,
    persona_mixing_mode: (batchMetadata.persona_mixing_mode as string | undefined) || undefined,
    flow_mode: (batchMetadata.flow_mode as string | undefined) || undefined,
    case_mode: 'saved',
    retry_eval_ids: retryEvalIds,
    source_run_id: sourceRunId,
    timeouts: {
      text_only: timeouts.textOnly,
      with_schema: timeouts.withSchema,
      with_audio: timeouts.withAudio,
      with_audio_and_schema: timeouts.withAudioAndSchema,
    },
  };
}

function normalizeCredentialPool(value: unknown): Array<{ userId: string; authToken: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const row = item as Record<string, unknown>;
      const userId = String(row.user_id ?? row.userId ?? '').trim();
      const authToken = String(row.auth_token ?? row.authToken ?? '').trim();
      if (!userId || !authToken) {
        return null;
      }
      return { userId, authToken };
    })
    .filter((item): item is { userId: string; authToken: string } => item != null);
}

export function resolveAdversarialCredentialPool(
  run: Run | null | undefined,
  kairaSettings: KairaBotSettings,
): Array<{ userId: string; authToken: string }> {
  const runConfig = (run?.config as Record<string, unknown> | undefined) ?? {};
  const runPool = normalizeCredentialPool(runConfig.kaira_credential_pool);
  if (runPool.length > 0) {
    return runPool;
  }

  if (kairaSettings.kairaChatUserId.trim() && kairaSettings.kairaAuthToken.trim()) {
    return [{
      userId: kairaSettings.kairaChatUserId.trim(),
      authToken: kairaSettings.kairaAuthToken.trim(),
    }];
  }

  return [];
}

export function canSubmitAdversarialRun(kairaSettings: KairaBotSettings, run?: Run | null): boolean {
  const batchMetadata = run?.batch_metadata ?? {};
  const apiUrl = ((batchMetadata.kaira_api_url as string | undefined) ?? kairaSettings.kairaApiUrl).trim();
  return Boolean(
    apiUrl &&
      resolveAdversarialCredentialPool(run, kairaSettings).length > 0,
  );
}
