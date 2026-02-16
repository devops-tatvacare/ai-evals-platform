import { useState, useCallback, useRef, useEffect } from 'react';
import { listingsRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import type { Listing, HumanEvaluation, TranscriptCorrection } from '@/types';
import { generateId } from '@/utils';
import { useCurrentAppId } from '@/hooks';

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

const SAVE_DEBOUNCE_MS = 1000;

export function useHumanEvaluation(listing: Listing): UseHumanEvaluationReturn {
  const appId = useCurrentAppId();
  const [evaluation, setEvaluation] = useState<HumanEvaluation | null>(
    listing.humanEval || null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChangesRef = useRef<Partial<HumanEvaluation> | null>(null);

  // Initialize evaluation if it doesn't exist
  useEffect(() => {
    if (!evaluation && listing.id) {
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
  }, [evaluation, listing.id]);

  // Persist changes with debounce
  const saveToStorage = useCallback(async (updatedEval: HumanEvaluation) => {
    setIsSaving(true);
    try {
      await listingsRepository.update(appId, listing.id, { humanEval: updatedEval });
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to save human evaluation:', err);
      notificationService.error('Failed to save changes. Will retry...', 'Save Error');
      
      // Retry after a delay
      setTimeout(() => {
        saveToStorage(updatedEval);
      }, 2000);
    } finally {
      setIsSaving(false);
    }
  }, [appId, listing.id]);

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
    }, SAVE_DEBOUNCE_MS);
  }, [saveToStorage]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Save any pending changes immediately
      if (pendingChangesRef.current) {
        saveToStorage(pendingChangesRef.current as HumanEvaluation);
      }
    };
  }, [saveToStorage]);

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
