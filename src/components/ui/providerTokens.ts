export const PROVIDER_TOKENS: Record<string, string> = {
  openai: '--color-provider-openai',
  anthropic: '--color-provider-anthropic',
  gemini: '--color-provider-gemini',
  google: '--color-provider-gemini',
  azure: '--color-provider-azure',
  azure_openai: '--color-provider-azure',
  vertex: '--color-provider-gemini',
  bedrock: '--color-provider-bedrock',
};

export const APP_TOKENS: Record<string, string> = {
  'voice-rx': '--color-app-voicerx',
  voicerx: '--color-app-voicerx',
  'kaira-bot': '--color-app-kaira',
  kaira: '--color-app-kaira',
  'inside-sales': '--color-app-insidesales',
  insidesales: '--color-app-insidesales',
  report: '--color-app-report',
  'report-builder': '--color-app-report',
  system: '--color-app-system',
};

export function tokenFor(registry: Record<string, string>, key: string): string | null {
  const normalized = key.toLowerCase().replace(/\s+/g, '-');
  return registry[normalized] ?? null;
}

export function providerToneFor(value: string): string | null {
  return tokenFor(PROVIDER_TOKENS, value);
}

export function appToneFor(value: string): string | null {
  return tokenFor(APP_TOKENS, value);
}
