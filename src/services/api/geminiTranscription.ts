const GEMINI_API_URL = 'https://pm-voice-rx-openai-prod.tatvacare.in/gemini-transcribe';
const GEMINI_API_KEY = '8X4jLpN2qKV47S4LfA9yRmZbTcUeHv3wWsG6Yx';

export interface GeminiTranscriptionRequest {
  file: File;
  doctorSpecialty?: string;
}

export interface GeminiTranscriptionResponse {
  // Add response type based on actual API response
  [key: string]: unknown;
}

export async function transcribeWithGemini(
  request: GeminiTranscriptionRequest
): Promise<GeminiTranscriptionResponse> {
  const formData = new FormData();
  formData.append('file', request.file);
  formData.append('doctor_specialty', request.doctorSpecialty || 'Orthopaedics');

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

  return response.json();
}
