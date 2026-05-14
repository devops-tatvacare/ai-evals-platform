import type { ConnectionProvider } from '@/services/api/orchestrationConnections';

export const CONNECTION_PROVIDER_OPTIONS: Array<{
  value: ConnectionProvider;
  label: string;
}> = [
  { value: 'bolna', label: 'Bolna (AI Voice)' },
  { value: 'wati', label: 'WATI (WhatsApp)' },
  { value: 'aisensy', label: 'AiSensy (WhatsApp)' },
  { value: 'lsq', label: 'LeadSquared' },
  { value: 'msg91', label: 'MSG91 (SMS)' },
  { value: 'webhook', label: 'Generic Webhook' },
];

const PROVIDER_LABELS = new Map(
  CONNECTION_PROVIDER_OPTIONS.map((option) => [option.value, option.label]),
);

function fallbackLabel(provider: string): string {
  return provider
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getConnectionProviderLabel(provider: string): string {
  return PROVIDER_LABELS.get(provider as ConnectionProvider) ?? fallbackLabel(provider);
}
