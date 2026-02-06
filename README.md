# AI Evals Platform

An offline-first web platform for building and running LLM-as-judge evaluation pipelines for audio transcription quality. It combines multi-step evaluators, schema-driven outputs, and repeatable prompt/version management.

## What you can do

- Build evaluator pipelines with a two-call flow: transcription, then critique.
- Enforce structured outputs with JSON Schema and field-based schema builders.
- Version prompts and schemas for reproducible evaluations.
- Review results with segment-level critiques, severity scoring, and metrics.
- Export evaluations as JSON, CSV, or PDF reports.
- Keep data local with IndexedDB and repository-based storage.

## Evaluators and pipelines

The core evaluation flow is a two-call pipeline:

1. **Transcription**: audio is transcribed into time-aligned segments.
2. **Critique**: the judge compares audio, original transcript, and AI transcript.

Pipelines are orchestrated in `src/features/evals/hooks/` and can be configured with different prompts and schemas per listing. You can re-run the critique step without re-transcribing by reusing an existing AI transcript.

## Schema builders and structured outputs

You can define and enforce output structure in two ways:

- **JSON Schema**: used by evaluation overlays for structured LLM output.
- **Field-based schema builder**: used by custom evaluators, converted to JSON Schema at runtime.

Schemas are versioned and stored in the entities table for reuse across listings.

## Prompt and template system

Prompts are versioned and support runtime variables such as:

- `{{audio}}`, `{{transcript}}`, `{{llm_transcript}}`
- `{{time_windows}}`, `{{segment_count}}`
- `{{language_hint}}`, `{{script_preference}}`, `{{preserve_code_switching}}`

Template resolution lives in `src/services/templates/`.

## Review and exports

- Segment-by-segment comparisons with severity ratings.
- Metrics for match percentage and issue counts.
- Export formats: JSON (full), CSV (segments), PDF (report).

## Example: run a two-call evaluation

1. Upload an audio file (WAV/MP3/WebM) and an optional transcript.
2. Open the listing and start **AI Evaluation**.
3. Select a transcription prompt + schema, then a critique prompt + schema.
4. Run the pipeline:
   - Call 1 produces time-aligned AI segments.
   - Call 2 outputs per-segment critique with severity and confidence.
5. Review results and export a report.

## Project structure (high-level)

```
src/
  app/         # App shell, routing, providers
  features/    # Feature modules (evals, settings, upload, transcript)
  services/    # Domain logic (llm, storage, errors, templates)
  stores/      # Zustand state
  components/  # Shared UI
  types/       # Shared types
```

## Build and run

```bash
npm install
npm run dev
```

## Documentation

- Storage architecture: `docs/storage-consolidation/`
- Entity schema notes: `src/services/storage/SCHEMA.md`

## License

Proprietary - All rights reserved
