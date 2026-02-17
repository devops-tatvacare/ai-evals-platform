import { useState, useCallback, useRef, useEffect } from 'react';
import { notificationService } from '@/services/notifications';
import type { HumanEvaluation, TranscriptCorrection } from '@/types';
import { generateId } from '@/utils';

interface UseHumanEvaluationOptions {
  listingId: string;
  /** Pre-existing human evaluation (e.g. fetched from eval_runs API) */
  initialHumanEval?: HumanEvaluation | null;
}

interface UseHumanEvaluationReturn {
  evaluation: HumanEvaluation | null;
  isSaving: boolean;
  lastSaved: Date | null;
  updateNotes: (notes: string) => void;
  updateScore: (score: number) => void;
  addCorrection: (correction: Omit<TranscriptCorrection, 'segmentIndex'> & { segmentIndex: number }) => void;
  updateCorrection: (segmentIndex: number, correctedText: string) => void;
  removeCorrection: (segmentIndex: number) => void;
  markComplete: () => Promise<void>;
}

/**
 * Manages human evaluation state locally.
 * TODO: Persist via eval_runs API with eval_type='human' once backend support is ready.
 */
export function useHumanEvaluation({ listingId, initialHumanEval }: UseHumanEvaluationOptions): UseHumanEvaluationReturn {
  const [evaluation, setEvaluation] = useState<HumanEvaluation | null>(
    initialHumanEval || null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChangesRef = useRef<Partial<HumanEvaluation> | null>(null);

  // Initialize evaluation if it doesn't exist
  useEffect(() => {
    if (!evaluation && listingId) {
      const newEval: HumanEvaluation = {
        id: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: '',
        corrections: [],
        status: 'in_progress',
      };
      setEvaluation(newEval);
    }
  }, [evaluation, listingId]);

  // Local-only save simulation (state is already updated; mark as "saved")
  // TODO: Replace with actual eval_runs API persistence
  const saveToStorage = useCallback(async (_updatedEval: HumanEvaluation) => {
    setIsSaving(true);
    try {
      // State is already updated in-memory; just mark the save timestamp
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to save human evaluation:', err);
      notificationService.error('Failed to save changes.', 'Save Error');
    } finally {
      setIsSaving(false);
    }
  }, []);

  const debouncedSave = useCallback((updatedEval: HumanEvaluation) => {
    pendingChangesRef.current = updatedEval;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      if (pendingChangesRef.current) {
        saveToStorage(pendingChangesRef.current as HumanEvaluation);
        pendingChangesRef.current = null;
      }
    }, 500);
  }, [saveToStorage]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const updateNotes = useCallback((notes: string) => {
    setEvaluation((prev) => {
      if (!prev) return prev;
      const updated: HumanEvaluation = {
        ...prev,
        notes,
        updatedAt: new Date(),
      };
      debouncedSave(updated);
      return updated;
    });
  }, [debouncedSave]);

  const updateScore = useCallback((overallScore: number) => {
    setEvaluation((prev) => {
      if (!prev) return prev;
      const updated: HumanEvaluation = {
        ...prev,
        overallScore,
        updatedAt: new Date(),
      };
      debouncedSave(updated);
      return updated;
    });
  }, [debouncedSave]);

  const addCorrection = useCallback((correction: TranscriptCorrection) => {
    setEvaluation((prev) => {
      if (!prev) return prev;
      
      // Check if correction for this segment already exists
      const existingIndex = prev.corrections.findIndex(
        (c) => c.segmentIndex === correction.segmentIndex
      );
      
      let newCorrections: TranscriptCorrection[];
      if (existingIndex >= 0) {
        // Update existing
        newCorrections = [...prev.corrections];
        newCorrections[existingIndex] = correction;
      } else {
        // Add new
        newCorrections = [...prev.corrections, correction];
      }
      
      const updated: HumanEvaluation = {
        ...prev,
        corrections: newCorrections,
        updatedAt: new Date(),
      };
      debouncedSave(updated);
      return updated;
    });
  }, [debouncedSave]);

  const updateCorrection = useCallback((segmentIndex: number, correctedText: string) => {
    setEvaluation((prev) => {
      if (!prev) return prev;
      
      const newCorrections = prev.corrections.map((c) =>
        c.segmentIndex === segmentIndex
          ? { ...c, correctedText }
          : c
      );
      
      const updated: HumanEvaluation = {
        ...prev,
        corrections: newCorrections,
        updatedAt: new Date(),
      };
      debouncedSave(updated);
      return updated;
    });
  }, [debouncedSave]);

  const removeCorrection = useCallback((segmentIndex: number) => {
    setEvaluation((prev) => {
      if (!prev) return prev;
      
      const updated: HumanEvaluation = {
        ...prev,
        corrections: prev.corrections.filter((c) => c.segmentIndex !== segmentIndex),
        updatedAt: new Date(),
      };
      debouncedSave(updated);
      return updated;
    });
  }, [debouncedSave]);

  const markComplete = useCallback(async () => {
    if (!evaluation) return;
    
    const updated: HumanEvaluation = {
      ...evaluation,
      status: 'completed',
      updatedAt: new Date(),
    };
    
    setEvaluation(updated);
    await saveToStorage(updated);
    notificationService.success('Human evaluation marked as complete');
  }, [evaluation, saveToStorage]);

  return {
    evaluation,
    isSaving,
    lastSaved,
    updateNotes,
    updateScore,
    addCorrection,
    updateCorrection,
    removeCorrection,
    markComplete,
  };
}
