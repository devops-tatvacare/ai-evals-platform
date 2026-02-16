import type { GeminiApiResponse } from '@/types';
import { useAppSettingsStore } from '@/stores/appSettingsStore';

export interface GeminiTranscriptionRequest {
  file: File;
  doctorSpecialty?: string;
}

export async function transcribeWithGemini(
  request: GeminiTranscriptionRequest
): Promise<GeminiApiResponse> {
  const { voiceRxApiUrl, voiceRxApiKey } = useAppSettingsStore.getState().settings['voice-rx'];

  if (!voiceRxApiUrl) {
    throw new Error('Voice RX API URL is not configured. Go to Settings > AI Configuration to set it.');
  }
  if (!voiceRxApiKey) {
    throw new Error('Voice RX API Key is not configured. Go to Settings > AI Configuration to set it.');
  }

  const formData = new FormData();
  formData.append('file', request.file);
  formData.append('doctor_specialty', request.doctorSpecialty || 'General');

  const response = await fetch(voiceRxApiUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'X-API-Key': voiceRxApiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`API call failed: ${response.statusText}`);
  }

  const data = await response.json();

  return {
    ...data,
    fetchedAt: new Date(),
  };
}
