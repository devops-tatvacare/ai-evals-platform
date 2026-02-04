import { useState, useCallback } from 'react';
import { transcribeWithGemini } from '@/services/api/geminiTranscription';
import type { GeminiApiResponse } from '@/types';
import { notificationService } from '@/services/notifications';

export function useGeminiTranscription() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [result, setResult] = useState<GeminiApiResponse | null>(null);

  const selectAndTranscribe = useCallback(async (file?: File) => {
    if (file) {
      // File provided directly
      setIsTranscribing(true);
      setResult(null);

      try {
        const response = await transcribeWithGemini({
          file,
          doctorSpecialty: 'Orthopaedics',
        });

        setResult(response);
        notificationService.success('Transcription completed');
        console.log('Gemini API Response:', response);
      } catch (error) {
        console.error('Transcription error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        notificationService.error(errorMessage, 'Transcription failed');
      } finally {
        setIsTranscribing(false);
      }
    } else {
      // Trigger file picker
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      
      input.onchange = async (e) => {
        const selectedFile = (e.target as HTMLInputElement).files?.[0];
        if (selectedFile) {
          selectAndTranscribe(selectedFile);
        }
      };

      input.click();
    }
  }, []);

  return {
    selectAndTranscribe,
    isTranscribing,
    result,
  };
}
