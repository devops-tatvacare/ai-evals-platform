import type { GeminiApiResponse } from '@/types';

const GEMINI_API_URL = 'https://pm-voice-rx-openai-prod.tatvacare.in/gemini-transcribe';
const GEMINI_API_KEY = '8X4jLpN2qKV47S4LfA9yRmZbTcUeHv3wWsG6Yx';

export interface GeminiTranscriptionRequest {
  file: File;
  doctorSpecialty?: string;
}

export async function transcribeWithGemini(
  request: GeminiTranscriptionRequest
): Promise<GeminiApiResponse> {
  const formData = new FormData();
  formData.append('file', request.file);
  formData.append('doctor_specialty', request.doctorSpecialty || 'General');

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'X-API-Key': GEMINI_API_KEY,
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

