import type { LLMProvider } from '@/services/api/aiSettingsApi';
import { LLM_PROVIDER_LABELS, LLM_PROVIDER_LOGOS } from '@/constants/llmProviders';
import { cn } from '@/utils';

interface LLMProviderLogoProps {
  provider: LLMProvider;
  size?: number;
  className?: string;
}

export function LLMProviderLogo({
  provider,
  size = 20,
  className,
}: LLMProviderLogoProps) {
  return (
    <img
      src={LLM_PROVIDER_LOGOS[provider]}
      alt={`${LLM_PROVIDER_LABELS[provider]} logo`}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-[4px] object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}
