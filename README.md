# AI Evals Platform

AI Evals Platform is a full-stack evaluation system for AI outputs used in real workflows.
It supports two active workspaces: `voice-rx` and `kaira-bot`.

## 🎯 Product Philosophy

- Evidence over intuition: every evaluation should be reproducible and auditable.
- Structured by default: prompts + schemas + versioning are first-class.
- Async by design: long-running runs execute as jobs with progress and cancellation.
- Human-usable outcomes: results should support QA decisions, not just model diagnostics.

## 🧩 What This Product Covers

### Voice Rx (`voice-rx`)

- Evaluates medical audio/transcript quality with a two-call pipeline:
  - Call 1: transcription
  - Call 2: critique against reference transcript
- Supports upload and API-fed assets, multilingual handling, and schema-constrained output.

### Kaira Bot (`kaira-bot`)

- Supports live chat QA and evaluator runs on conversation data.
- Includes single custom evaluator runs, batch thread evaluations, and adversarial testing.

## 🔄 Universal 4-Step Evaluation Pattern

Based on the guide workflow (`docs/guide/index.html`):

1. **Bring Assets** - upload audio/transcripts/CSV, or connect an API source.
2. **Review Setup** - configure prompts, schemas, model/provider settings.
3. **Run Evaluators** - execute standalone custom evaluators.
4. **Run Full Evals** - launch complete, multi-step evaluation pipelines.

## 🧪 AI Evaluation Flows Available

1. **Voice Rx Full Evaluation** (`evaluate-voice-rx`)
   - Upload or import listing assets.
   - Run transcription + critique as one background job.
   - Review segment-level findings and aggregate stats.

2. **Custom Evaluator Run** (`evaluate-custom`)
   - Create/select evaluator with prompt + schema.
   - Run against a listing or chat session.
   - Store output in `eval_runs` with structured fields.

3. **Batch Thread Evaluation** (`evaluate-batch`)
   - Upload thread CSV data.
   - Run built-in and custom evaluators across rows.
   - Get run-level summaries and per-thread records.

4. **Adversarial Evaluation** (`evaluate-adversarial`)
   - Configure target Kaira API + test parameters.
   - Generate adversarial cases, simulate conversations, score safety/compliance.
   - Persist case-level outcomes for replay and trend tracking.

## 🏗️ Architecture (At a Glance)

- Frontend: React 19 + TypeScript strict + Vite 7 + Tailwind v4 + Zustand.
- Backend: FastAPI + async SQLAlchemy + asyncpg + Python 3.12.
- Database: PostgreSQL 16 with JSON/JSONB-heavy schema.
- Job execution: background worker dispatching to evaluator runners.
- API surface: 14 routers in `backend/app/main.py`.
- ORM surface: 15 tables including `eval_runs`, `jobs`, `thread_evaluations`, `adversarial_evaluations`, and `api_logs`.

## 🚀 Baseline Setup (Local)

```bash
cp .env.backend.example .env.backend
# Add at least one API key: GEMINI_API_KEY or OPENAI_API_KEY

touch service-account.json
docker compose up --build
```

Open:

- Frontend: http://localhost:5173
- Backend health: http://localhost:8721/api/health

For full setup details (including Azure), see `docs/SETUP.md`.

## 📚 Developer References

- Agent rules: `AGENTS.md`
- Claude guidance: `CLAUDE.md`
- Copilot guidance: `.github/copilot-instructions.md`
- Interactive architecture/workflow guide: `docs/guide/index.html`

## License

Proprietary - All rights reserved.

Built by TatvaCare.
