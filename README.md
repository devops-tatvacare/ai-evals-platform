# AI Evals Platform

A full-stack LLM-as-judge evaluation platform for assessing AI-generated outputs across multiple domains. Built for medical audio transcription quality (Voice Rx) and conversational AI quality (Kaira Bot).

## Platform Apps

The platform hosts three interconnected apps, each scoped by `appId`:

### Voice Rx (`voice-rx`)
Medical audio transcription evaluation with a **two-call LLM pipeline**:
1. **Transcription** — Audio is transcribed into time-aligned segments by an LLM.
2. **Critique** — A judge LLM compares the AI transcript against the original, producing per-segment severity ratings, confidence scores, and correction suggestions.

Supports upload-based and API-based source types, multilingual transcription with normalization, and structured output enforcement via JSON Schema.

### Kaira Bot (`kaira-bot`)
Chat interface for testing a health-focused conversational AI (MyTatva Kaira API). Features session management, SSE streaming, and speech-to-text input.

### Kaira Evals (`kaira-evals`)
Batch evaluation of Kaira Bot conversations with built-in and custom evaluators:
- **Intent Accuracy** — Was the user's intent correctly classified?
- **Response Correctness** — Is the AI response factually and contextually correct?
- **Conversation Efficiency** — Did the bot resolve the query without unnecessary turns?
- **Custom Evaluators** — User-defined evaluators with field-based output schemas.
- **Adversarial Testing** — Automated stress-testing of the live Kaira API with synthetic adversarial cases.

## Evaluation Workflows

### Single Listing Evaluation (Voice Rx)
1. Upload audio (WAV/MP3/WebM) and optional transcript.
2. Select transcription prompt + schema, then critique prompt + schema.
3. Submit — a background job runs the two-call pipeline.
4. Review per-segment results, severity ratings, and export reports (JSON/CSV/PDF).

### Batch Thread Evaluation (Kaira Evals)
1. Upload a CSV with conversation thread data.
2. Client-side CSV parsing validates headers and maps fields.
3. Select evaluators (intent, correctness, efficiency, custom).
4. Submit — a background job evaluates each thread.
5. Dashboard shows aggregate stats, distributions, and per-thread drill-down.

### Custom Evaluator Workflow
1. Create an evaluator with a prompt and field-based output schema.
2. Run it on any listing or chat session.
3. The field-based schema is converted to JSON Schema at runtime for structured LLM output.
4. Results rendered dynamically based on the evaluator's schema definition.

### Adversarial Testing (Kaira Evals)
1. Configure Kaira API credentials and test parameters.
2. Submit — generates synthetic adversarial cases and runs them against the live API.
3. Results scored on goal achievement, safety, and recovery quality.

## Architecture

### Stack
- **Frontend**: React 19 + Vite 7 + TypeScript + Zustand + Tailwind CSS v4
- **Backend**: FastAPI + async SQLAlchemy + asyncpg (Python 3.12)
- **Database**: PostgreSQL 16 with JSONB columns
- **LLM Providers**: Google Gemini (with audio support) and OpenAI
- **Dev Environment**: Docker Compose (PostgreSQL + FastAPI + Vite)

### Backend Services
- **Job Worker** — Polls a `jobs` table for queued work, dispatches to typed runners, tracks progress, and recovers from crashes.
- **Evaluator Runners** — `voice_rx_runner`, `batch_runner`, `adversarial_runner`, `custom_evaluator_runner`, `voice_rx_batch_custom_runner`.
- **LLM Base** — Provider abstraction with retry, timeout tiers (60s-240s), and token counting.
- **Seed Defaults** — Auto-creates default prompts, schemas, and evaluators on startup.

### Data Model
- **EvalRun** — Unified source of truth for all evaluation results (`eval_type`: custom, full_evaluation, batch_thread, batch_adversarial).
- **Job** — Background job queue with progress tracking and cancellation.
- **Listing** — Voice Rx recordings with audio/transcript file references.
- **ChatSession / ChatMessage** — Kaira Bot conversation state.
- **Prompt / Schema** — Versioned, scoped by app and prompt type.
- **Evaluator** — Custom evaluator definitions with field-based output schemas.
- **ApiLog** — LLM call audit trail linked to eval runs.

### API Endpoints (13 routers)
`/api/listings`, `/api/files`, `/api/prompts`, `/api/schemas`, `/api/evaluators`, `/api/chat`, `/api/history`, `/api/settings`, `/api/tags`, `/api/jobs`, `/api/eval-runs`, `/api/threads`, `/api/llm`

## Project Structure

```
backend/
  app/
    models/          # SQLAlchemy models (11 tables)
    schemas/         # Pydantic request/response schemas
    routes/          # FastAPI routers
    services/
      evaluators/    # LLM runners, evaluators, response parsers
      job_worker.py  # Background job polling and dispatch
      seed_defaults.py
    config.py        # Environment-based settings
    main.py          # App entry, lifespan, router registration

src/
  app/               # App shell, routing, providers
  features/          # Feature modules
    evalRuns/        # Unified eval results (dashboard, detail, logs)
    voiceRx/         # Voice Rx upload and review
    kaira/           # Kaira Bot chat interface
    kairaBotSettings/
    listings/        # Listing management
    transcript/      # Transcript display
    upload/          # File upload flow
    export/          # JSON/CSV/PDF export
    settings/        # App settings
    structured-output/
  services/          # API client, LLM providers, templates, errors
  stores/            # Zustand stores (12 stores)
  components/        # Shared UI components
  types/             # TypeScript type definitions
  constants/         # Default prompts, schemas, routes
```

## Quick Start

See [docs/SETUP.md](docs/SETUP.md) for full local and production setup instructions.

```bash
cp .env.backend.example .env.backend   # Add your GEMINI_API_KEY or OPENAI_API_KEY
docker compose up --build               # Start all services
# Open http://localhost:5173
```

## Ports

| Service    | Port | URL                              |
|------------|------|----------------------------------|
| Frontend   | 5173 | http://localhost:5173             |
| Backend    | 8721 | http://localhost:8721/api/health  |
| PostgreSQL | 5432 | —                                |

## License

Proprietary - All rights reserved
