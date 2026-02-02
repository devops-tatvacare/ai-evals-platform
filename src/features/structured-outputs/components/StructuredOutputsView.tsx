import { useState, useCallback } from 'react';
import { Sparkles, FileText, Upload } from 'lucide-react';
import { Card, Button, ModelBadge } from '@/components/ui';
import { FeatureErrorBoundary } from '@/components/feedback';
import { ExtractionModal } from './ExtractionModal';
import { OutputCard } from './OutputCard';
import { ReferenceUploadModal } from './ReferenceUploadModal';
import { ReferenceCard } from './ReferenceCard';
import { RegenerateConfirmDialog } from './RegenerateConfirmDialog';
import { StructuredOutputComparison } from './StructuredOutputComparison';
import { useStructuredExtraction } from '../hooks/useStructuredExtraction';
import { listingsRepository, filesRepository } from '@/services/storage';
import { createReference } from '@/services/structured-outputs';
import { useSettingsStore } from '@/stores';
import { useCurrentAppId } from '@/hooks';
import type { Listing } from '@/types';

interface StructuredOutputsViewProps {
  listing: Listing;
  onUpdate: (listing: Listing) => void;
}

export function StructuredOutputsView({ listing, onUpdate }: StructuredOutputsViewProps) {
  const appId = useCurrentAppId();
  const [isExtractionModalOpen, setIsExtractionModalOpen] = useState(false);
  const [isReferenceUploadModalOpen, setIsReferenceUploadModalOpen] = useState(false);
  const [regenerateOutputId, setRegenerateOutputId] = useState<string | null>(null);
  const [comparisonData, setComparisonData] = useState<{
    referenceId: string;
    outputId: string;
  } | null>(null);
  
  const { isExtracting, error, extract, regenerate, cancel } = useStructuredExtraction();
  const { llm } = useSettingsStore();

  const hasTranscript = !!listing.transcript;
  const hasAudio = !!listing.audioFile;
  const references = listing.structuredOutputReferences || [];

  const handleExtract = useCallback(async (data: {
    prompt: string;
    promptType: 'freeform' | 'schema';
    inputSource: 'transcript' | 'audio' | 'both';
    referenceId?: string;
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
      referenceId: data.referenceId,
    });

    if (result) {
      // Refresh listing data
      const updatedListing = await listingsRepository.getById(appId, listing.id);
      if (updatedListing) {
        onUpdate(updatedListing);
      }
      setIsExtractionModalOpen(false);
    }
  }, [appId, listing, extract, onUpdate]);

  const handleUploadReference = useCallback(async (
    content: object,
    fileName: string,
    fileSize: number,
    description?: string
  ) => {
    const reference = createReference(content, fileName, fileSize, description);
    
    await listingsRepository.update(appId, listing.id, {
      structuredOutputReferences: [...references, reference],
    });

    const updatedListing = await listingsRepository.getById(appId, listing.id);
    if (updatedListing) {
      onUpdate(updatedListing);
    }
    setIsReferenceUploadModalOpen(false);
  }, [appId, listing.id, references, onUpdate]);

  const handleDeleteReference = useCallback(async (referenceId: string) => {
    const updatedReferences = references.filter((r) => r.id !== referenceId);
    
    // Unlink any outputs that reference this
    const updatedOutputs = listing.structuredOutputs.map(output => {
      if (output.referenceId === referenceId) {
        return { ...output, referenceId: undefined };
      }
      return output;
    });
    
    await listingsRepository.update(appId, listing.id, {
      structuredOutputReferences: updatedReferences,
      structuredOutputs: updatedOutputs,
    });

    const updatedListing = await listingsRepository.getById(appId, listing.id);
    if (updatedListing) {
      onUpdate(updatedListing);
    }
  }, [appId, listing, references, onUpdate]);

  const handleDelete = useCallback(async (outputId: string) => {
    const updatedOutputs = listing.structuredOutputs.filter((o) => o.id !== outputId);
    await listingsRepository.update(appId, listing.id, {
      structuredOutputs: updatedOutputs,
    });
    const updatedListing = await listingsRepository.getById(appId, listing.id);
    if (updatedListing) {
      onUpdate(updatedListing);
    }
  }, [appId, listing, onUpdate]);

  const handleRegenerateConfirm = useCallback(async () => {
    if (!regenerateOutputId) return;

    const output = listing.structuredOutputs.find(o => o.id === regenerateOutputId);
    if (!output) return;

    // Build same params as original extraction
    let transcriptText: string | undefined;
    if (output.inputSource === 'transcript' || output.inputSource === 'both') {
      if (listing.transcript) {
        transcriptText = listing.transcript.segments
          .map((s) => `[${s.speaker}]: ${s.text}`)
          .join('\n');
      }
    }

    let audioBlob: Blob | undefined;
    let audioMimeType: string | undefined;
    if (output.inputSource === 'audio' || output.inputSource === 'both') {
      if (listing.audioFile) {
        const file = await filesRepository.getById(listing.audioFile.id);
        if (file) {
          audioBlob = file.data;
          audioMimeType = listing.audioFile.mimeType;
        }
      }
    }

    const result = await regenerate(regenerateOutputId, {
      listingId: listing.id,
      prompt: output.prompt,
      promptType: output.promptType,
      inputSource: output.inputSource,
      transcript: transcriptText,
      audioBlob,
      audioMimeType,
    });

    if (result) {
      const updatedListing = await listingsRepository.getById(appId, listing.id);
      if (updatedListing) {
        onUpdate(updatedListing);
      }
      setRegenerateOutputId(null);
    }
  }, [appId, regenerateOutputId, listing, regenerate, onUpdate]);

  const handleCompareFromReference = useCallback((referenceId: string) => {
    // Find first output linked to this reference
    const linkedOutput = listing.structuredOutputs.find(o => o.referenceId === referenceId);
    if (linkedOutput) {
      setComparisonData({ referenceId, outputId: linkedOutput.id });
    }
  }, [listing.structuredOutputs]);

  const handleCompareFromOutput = useCallback((outputId: string) => {
    const output = listing.structuredOutputs.find(o => o.id === outputId);
    if (output?.referenceId) {
      setComparisonData({ referenceId: output.referenceId, outputId });
    }
  }, [listing.structuredOutputs]);

  const handleCloseExtractionModal = useCallback(() => {
    if (isExtracting) {
      cancel();
    }
    setIsExtractionModalOpen(false);
  }, [isExtracting, cancel]);

  // Find reference for comparison
  const comparisonReference = comparisonData
    ? references.find(r => r.id === comparisonData.referenceId)
    : undefined;
  
  const comparisonOutput = comparisonData
    ? listing.structuredOutputs.find(o => o.id === comparisonData.outputId)
    : undefined;

  return (
    <FeatureErrorBoundary featureName="Structured Outputs">
      <div className="space-y-4">
        {/* Comparison view (fullscreen when active) */}
        {comparisonData && comparisonReference && comparisonOutput && (
          <div className="mb-4">
            <StructuredOutputComparison
              reference={comparisonReference}
              llmOutput={comparisonOutput}
              onClose={() => setComparisonData(null)}
            />
          </div>
        )}

        {/* Reference outputs section */}
        {references.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--text-primary)]">
                Reference Outputs (Ground Truth)
              </h3>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsReferenceUploadModalOpen(true)}
                  >
                    <Upload className="h-4 w-4" />
                    Upload Reference
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setIsExtractionModalOpen(true)}
                    disabled={!hasTranscript && !hasAudio}
                  >
                    <Sparkles className="h-4 w-4" />
                    Generate with LLM
                  </Button>
                </div>
                {llm.apiKey && (
                  <ModelBadge
                    modelName={llm.selectedModel}
                    variant="compact"
                    showPoweredBy
                  />
                )}
              </div>
            </div>
            <div className="space-y-2">
              {references.map((reference) => {
                const hasLinkedOutputs = listing.structuredOutputs.some(
                  o => o.referenceId === reference.id
                );
                return (
                  <ReferenceCard
                    key={reference.id}
                    reference={reference}
                    onDelete={handleDeleteReference}
                    onCompare={handleCompareFromReference}
                    hasLinkedOutputs={hasLinkedOutputs}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* LLM outputs section */}
        {listing.structuredOutputs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--text-primary)]">
                LLM Extracted Outputs
              </h3>
              {references.length === 0 && (
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsReferenceUploadModalOpen(true)}
                    >
                      <Upload className="h-4 w-4" />
                      Upload Reference
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setIsExtractionModalOpen(true)}
                      disabled={!hasTranscript && !hasAudio}
                    >
                      <Sparkles className="h-4 w-4" />
                      Generate with LLM
                    </Button>
                  </div>
                  {llm.apiKey && (
                    <ModelBadge
                      modelName={llm.selectedModel}
                      variant="compact"
                      showPoweredBy
                    />
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {[...listing.structuredOutputs].reverse().map((output) => {
                const linkedRef = output.referenceId
                  ? references.find(r => r.id === output.referenceId)
                  : undefined;
                return (
                  <OutputCard
                    key={output.id}
                    output={output}
                    linkedReference={linkedRef}
                    onDelete={handleDelete}
                    onRegenerate={(id) => setRegenerateOutputId(id)}
                    onCompare={handleCompareFromOutput}
                    isRegenerating={regenerateOutputId === output.id && isExtracting}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {references.length === 0 && listing.structuredOutputs.length === 0 && (
          <Card className="border-dashed">
            <div className="text-center">
              <div className="mb-4 inline-flex rounded-full bg-[var(--color-brand-accent)]/10 p-3">
                <Sparkles className="h-8 w-8 text-[var(--color-brand-accent)]" />
              </div>
              <h3 className="mb-2 font-medium text-[var(--text-primary)]">
                No structured outputs yet
              </h3>
              <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
                Upload reference outputs from your external system, then generate LLM extractions to compare accuracy.
              </p>

              <div className="flex flex-col items-center gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setIsReferenceUploadModalOpen(true)}
                  >
                    <Upload className="h-4 w-4" />
                    Upload Reference
                  </Button>
                  <Button
                    onClick={() => setIsExtractionModalOpen(true)}
                    disabled={!hasTranscript && !hasAudio}
                  >
                    <Sparkles className="h-4 w-4" />
                    Generate with LLM
                  </Button>
                </div>
                {llm.apiKey && (
                  <ModelBadge
                    modelName={llm.selectedModel}
                    variant="compact"
                    showPoweredBy
                  />
                )}
              </div>

              <p className="mt-4 text-[12px] text-[var(--text-muted)]">
                Reference outputs serve as ground truth for evaluating LLM extraction accuracy.
              </p>
            </div>
          </Card>
        )}

        {/* No data warning */}
        {!hasTranscript && !hasAudio && (
          <Card className="flex items-center gap-3 bg-[var(--color-warning-light)] p-4">
            <FileText className="h-5 w-5 text-[var(--color-warning)]" />
            <div>
              <p className="text-sm font-medium text-[var(--color-warning)]">
                No data available
              </p>
              <p className="text-xs text-[var(--color-warning)]/80">
                Upload a transcript or audio file to enable structured data extraction.
              </p>
            </div>
          </Card>
        )}

        {/* Modals */}
        <ExtractionModal
          isOpen={isExtractionModalOpen}
          onClose={handleCloseExtractionModal}
          onSubmit={handleExtract}
          isLoading={isExtracting}
          error={error}
          hasTranscript={hasTranscript}
          hasAudio={hasAudio}
          references={references}
        />

        <ReferenceUploadModal
          isOpen={isReferenceUploadModalOpen}
          onClose={() => setIsReferenceUploadModalOpen(false)}
          onSubmit={handleUploadReference}
        />

        <RegenerateConfirmDialog
          isOpen={!!regenerateOutputId}
          onClose={() => setRegenerateOutputId(null)}
          onConfirm={handleRegenerateConfirm}
          isLoading={isExtracting}
        />
      </div>
    </FeatureErrorBoundary>
  );
}
