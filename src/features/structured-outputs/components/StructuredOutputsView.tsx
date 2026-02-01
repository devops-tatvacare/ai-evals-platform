import { useState, useCallback } from 'react';
import { Plus, Sparkles, FileText } from 'lucide-react';
import { Card, Button, ModelBadge } from '@/components/ui';
import { FeatureErrorBoundary } from '@/components/feedback';
import { ExtractionModal } from './ExtractionModal';
import { OutputCard } from './OutputCard';
import { useStructuredExtraction } from '../hooks/useStructuredExtraction';
import { listingsRepository, filesRepository } from '@/services/storage';
import { useSettingsStore } from '@/stores';
import type { Listing } from '@/types';

interface StructuredOutputsViewProps {
  listing: Listing;
  onUpdate: (listing: Listing) => void;
}

export function StructuredOutputsView({ listing, onUpdate }: StructuredOutputsViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isExtracting, error, extract, cancel } = useStructuredExtraction();
  const { llm } = useSettingsStore();

  const hasTranscript = !!listing.transcript;
  const hasAudio = !!listing.audioFile;

  const handleExtract = useCallback(async (data: {
    prompt: string;
    promptType: 'freeform' | 'schema';
    inputSource: 'transcript' | 'audio' | 'both';
  }) => {
    // Build transcript text if needed
    let transcriptText: string | undefined;
    if (data.inputSource === 'transcript' || data.inputSource === 'both') {
      if (listing.transcript) {
        transcriptText = listing.transcript.segments
          .map((s) => `[${s.speaker}]: ${s.text}`)
          .join('\n');
      }
    }

    // Load audio blob if needed
    let audioBlob: Blob | undefined;
    let audioMimeType: string | undefined;
    if (data.inputSource === 'audio' || data.inputSource === 'both') {
      if (listing.audioFile) {
        const file = await filesRepository.getById(listing.audioFile.id);
        if (file) {
          audioBlob = file.data;
          audioMimeType = listing.audioFile.mimeType;
        }
      }
    }

    const result = await extract({
      listingId: listing.id,
      prompt: data.prompt,
      promptType: data.promptType,
      inputSource: data.inputSource,
      transcript: transcriptText,
      audioBlob,
      audioMimeType,
    });

    if (result) {
      // Refresh listing data
      const updatedListing = await listingsRepository.getById(listing.id);
      if (updatedListing) {
        onUpdate(updatedListing);
      }
      setIsModalOpen(false);
    }
  }, [listing, extract, onUpdate]);

  const handleDelete = useCallback(async (outputId: string) => {
    const updatedOutputs = listing.structuredOutputs.filter((o) => o.id !== outputId);
    await listingsRepository.update(listing.id, {
      structuredOutputs: updatedOutputs,
    });
    const updatedListing = await listingsRepository.getById(listing.id);
    if (updatedListing) {
      onUpdate(updatedListing);
    }
  }, [listing, onUpdate]);

  const handleCloseModal = useCallback(() => {
    if (isExtracting) {
      cancel();
    }
    setIsModalOpen(false);
  }, [isExtracting, cancel]);

  return (
    <FeatureErrorBoundary featureName="Structured Outputs">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Structured Outputs
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              Extract structured data from transcript or audio using AI
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setIsModalOpen(true)} disabled={!hasTranscript && !hasAudio}>
              <Plus className="h-4 w-4" />
              Extract Data
            </Button>
            {llm.apiKey && (
              <ModelBadge
                modelName={llm.selectedModel}
                variant="compact"
                showPoweredBy
              />
            )}
          </div>
        </div>

        {/* Empty state */}
        {listing.structuredOutputs.length === 0 && (
          <Card className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 rounded-full bg-[var(--color-brand-accent)]/10 p-3">
              <Sparkles className="h-8 w-8 text-[var(--color-brand-accent)]" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-[var(--text-primary)]">
              No extractions yet
            </h3>
            <p className="mb-4 max-w-sm text-center text-sm text-[var(--text-muted)]">
              Use AI to extract structured data like patient information, symptoms, diagnoses, and prescriptions from your transcript.
            </p>
            <Button onClick={() => setIsModalOpen(true)} disabled={!hasTranscript && !hasAudio}>
              <Sparkles className="h-4 w-4" />
              Extract Data
            </Button>
          </Card>
        )}

        {/* Output list */}
        {listing.structuredOutputs.length > 0 && (
          <div className="space-y-3">
            {[...listing.structuredOutputs].reverse().map((output) => (
              <OutputCard key={output.id} output={output} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {/* No data warning */}
        {!hasTranscript && !hasAudio && (
          <Card className="flex items-center gap-3 bg-amber-500/10 p-4">
            <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                No data available
              </p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                Upload a transcript or audio file to enable structured data extraction.
              </p>
            </div>
          </Card>
        )}

        {/* Modal */}
        <ExtractionModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onSubmit={handleExtract}
          isLoading={isExtracting}
          error={error}
          hasTranscript={hasTranscript}
          hasAudio={hasAudio}
        />
      </div>
    </FeatureErrorBoundary>
  );
}
