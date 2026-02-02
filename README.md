# AI Evals Platform

A modern, production-grade web application for evaluating AI-generated transcriptions using the LLM-as-Judge methodology. Built for healthcare and multilingual transcription quality assurance.

## Philosophy

This platform implements a rigorous **two-call LLM evaluation pattern**:
1. **Call 1 (Transcription)**: AI transcribes audio using time-aligned segments
2. **Call 2 (Critique)**: LLM-as-Judge compares original vs. AI transcript using audio as ground truth

### Key Design Principles
- **Zero-hallucination evaluation**: Audio is always available to the judge for verification
- **Structured outputs**: JSON schemas enforce consistent, parseable results
- **Version control**: Prompts and schemas are versioned for reproducibility
- **Offline-first**: All data persisted locally with IndexedDB
- **Multilingual support**: Hindi (Devanagari/Romanized), English, and code-switching
- **Production-ready**: Clean architecture, TypeScript, comprehensive error handling

## Core Features

### Evaluation Workflows
- **Voice-RX**: Medical transcription evaluation with severity classification
- **Kaira Bot**: Health chatbot conversation quality assessment
- **Structured Extraction**: Schema-driven data extraction from transcripts

### AI Capabilities
- **Time-aligned transcription**: Maintains 1:1 segment alignment for accurate comparison
- **LLM-as-Judge critique**: Per-segment evaluation with severity, confidence, and correctness determination
- **Schema enforcement**: Gemini structured outputs ensure consistent JSON responses
- **Prompt versioning**: Track and compare different prompt versions over time

### User Experience
- **Audio playback**: WaveSurfer.js with segment highlighting and keyboard shortcuts
- **Diff view**: Side-by-side transcript comparison with match percentage
- **Export options**: JSON, CSV, PDF with customizable formats
- **Dark/light themes**: Accessible UI with tailored color schemes
- **Background tasks**: Non-blocking AI evaluations with progress tracking

## Quick Start

### Prerequisites
- Node.js 18+
- Google Gemini API key ([Get one here](https://aistudio.google.com/app/apikey))

### Installation

```bash
# Clone and install
git clone <repository-url>
cd ai-evals-platform
npm install

# Start development server
npm run dev
```

### First-Time Setup

1. Open the app and navigate to **Settings**
2. Enter your **Google Gemini API key** in the AI Configuration tab
3. Review default **prompts** (transcription, evaluation, extraction)
4. Review default **schemas** (JSON structure for AI outputs)
5. Adjust **transcription preferences** (language, script, code-switching)

The platform automatically activates built-in prompts and schemas on first launch.

## Usage Guide

### 1. Upload Audio + Transcript

**Option A: Quick Upload**
1. Click **New** in the sidebar or home page
2. Drag & drop audio (WAV/MP3/WebM) + transcript (JSON/TXT)
3. Click **Create Evaluation**

**Option B: Audio Only**
- Upload just audio if you only need AI transcription
- Original transcript is optional but required for comparison

### 2. AI Evaluation (Two-Call Flow)

1. Open a listing → **Evals** tab
2. Click **Start AI Evaluation**
3. Configure prompts and schemas (or use defaults)
4. Run evaluation:
   - **Call 1**: AI transcribes audio (time-aligned segments)
   - **Call 2**: Judge compares original vs. AI transcript
5. View results:
   - Per-segment critique with severity ratings
   - Overall assessment with segment references
   - Statistics (critical/moderate/minor/match counts)

**Advanced Options:**
- **Skip Call 1**: Reuse existing AI transcript, only re-run critique
- **Custom prompts**: Edit prompts inline or select different versions
- **Custom schemas**: Generate new schemas or use existing versions

### 3. Review & Refine

**Transcript View**
- Play audio with segment highlighting
- Click segments to seek audio
- Export transcript as JSON/CSV

**Evals View**
- Segment-by-segment comparison table
- Color-coded severity (critical=red, moderate=yellow, minor=gray)
- Clickable assessment references
- Metrics bar with match percentage

**Human Evaluation (Optional)**
- Manual notepad for human reviewer feedback
- Not required for AI-only workflow

### 4. Export Results

Click **Export** dropdown:
- **JSON (Full Data)**: Complete evaluation with prompts, schemas, and results
- **CSV (Segments)**: Spreadsheet of transcript segments
- **PDF (Report)**: Formatted evaluation report
- **JSON (Corrections)**: Human review data only

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play/Pause audio |
| `←` | Seek backward 5 seconds |
| `→` | Seek forward 5 seconds |
| `⌘/Ctrl + S` | Save current work |
| `Escape` | Close modals |
| `Shift + ?` | Show shortcuts help |

## Supported File Formats

### Audio
- WAV (`.wav`)
- MP3 (`.mp3`)
- WebM (`.webm`)

### Transcript
- JSON (`.json`) - Structured format with segments
- Text (`.txt`) - Plain text transcript

### JSON Transcript Format

```json
{
  "formatVersion": "1.0",
  "generatedAt": "2024-01-01T00:00:00Z",
  "metadata": {
    "source": "manual",
    "language": "en"
  },
  "speakerMapping": {
    "S1": "Speaker 1",
    "S2": "Speaker 2"
  },
  "segments": [
    {
      "speaker": "S1",
      "startTime": "00:00:00",
      "endTime": "00:00:05",
      "text": "Hello, how are you?"
    }
  ],
  "fullTranscript": "..."
}
```

## Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| `LLM_API_ERROR` | LLM API request failed | Check API key, retry |
| `LLM_RATE_LIMITED` | Rate limit exceeded | Wait and retry |
| `FILE_TOO_LARGE` | File exceeds size limit | Use smaller file |
| `FILE_CORRUPTED` | File cannot be read | Re-upload file |
| `STORAGE_QUOTA_EXCEEDED` | Browser storage full | Clear old evaluations |
| `NETWORK_ERROR` | Connection lost | Check internet, retry |

## Extending the Platform

### Adding New LLM Providers

1. Create provider in `src/services/llm/`
2. Implement `ILLMProvider` interface:
```typescript
interface ILLMProvider {
  name: string;
  generateContent(prompt: string, options?: LLMGenerateOptions): Promise<LLMResponse>;
  generateContentWithAudio(prompt: string, audioBlob: Blob, mimeType: string, options?: LLMGenerateOptions): Promise<LLMResponse>;
  cancel(): void;
}
```
3. Register in `src/services/llm/providerRegistry.ts`

### Adding New Export Formats

1. Create exporter in `src/services/export/exporters/`
2. Implement `Exporter` interface:
```typescript
interface Exporter {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  export(data: ExportData): Promise<Blob>;
}
```
3. Register in `src/services/export/index.ts`

### Custom Prompt Templates

Prompts support template variables that are resolved at runtime:

**Available Variables:**
- `{{audio}}` - Audio file (handled specially as media)
- `{{transcript}}` - Original transcript text
- `{{llm_transcript}}` - AI-generated transcript
- `{{time_windows}}` - Formatted time windows for transcription
- `{{segment_count}}` - Number of segments
- `{{language_hint}}`, `{{script_preference}}`, `{{preserve_code_switching}}` - Transcription preferences

**Variable Registry:** `src/services/templates/variableRegistry.ts`
**Resolver:** `src/services/templates/variableResolver.ts`

## Architecture

### Tech Stack

- **Framework**: React 18 with TypeScript 5
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS v4 with CSS variables
- **State Management**: Zustand with persist middleware
- **Storage**: IndexedDB (Dexie) with entity-based schema
- **LLM Integration**: Google Gemini SDK (@google/genai)
- **Audio**: WaveSurfer.js with time-sync
- **Export**: jsPDF (PDF), PapaParse (CSV)
- **Diff View**: react-diff-viewer-continued

### Storage Architecture

**Database: `ai-evals-platform`**
- **listings** table: Evaluation listings (audio, transcript, results)
- **files** table: Binary blobs (audio files)
- **entities** table: Unified storage for prompts, schemas, settings, chat data

**Entity Discrimination Pattern:**
```typescript
type='prompt' | 'schema' | 'setting' | 'chatSession' | 'chatMessage'
```
This pattern enables flexible, schema-less storage with type safety via entity.data.

### Project Structure

```
src/
├── app/                    # App entry, routing, providers
├── components/             # Shared UI components (Button, Modal, Card, etc.)
├── constants/              # Default prompts, schemas, models
├── features/               # Feature modules (self-contained)
│   ├── debug/              # Debug panel with logs and storage inspector
│   ├── evals/              # AI & human evaluation workflows
│   ├── export/             # Export formats (JSON, CSV, PDF)
│   ├── listings/           # Listing CRUD and list views
│   ├── settings/           # Prompts, schemas, LLM config, preferences
│   ├── structured-outputs/ # Schema-driven extraction
│   ├── transcript/         # Transcript view with audio player
│   └── upload/             # File upload and validation
├── hooks/                  # Reusable hooks (useCurrentAppData, useDebounce)
├── services/
│   ├── errors/             # Error types and handlers
│   ├── export/             # Export service and format registry
│   ├── llm/                # LLM providers (Gemini), evaluation service
│   ├── logger/             # Centralized logging with debug panel integration
│   ├── notifications/      # Toast notifications
│   ├── storage/            # IndexedDB repositories (listings, files, entities)
│   └── templates/          # Prompt variable resolution
├── stores/                 # Zustand state management
│   ├── appStore.ts         # Current app (voice-rx | kaira-bot)
│   ├── listingsStore.ts    # In-memory listing cache
│   ├── promptsStore.ts     # Prompts loaded from entities
│   ├── schemasStore.ts     # Schemas loaded from entities
│   ├── settingsStore.ts    # Persisted settings (IndexedDB backend)
│   ├── taskQueueStore.ts   # Background task tracking
│   └── uiStore.ts          # UI state (sidebar, modals)
├── types/                  # TypeScript interfaces and types
└── utils/                  # Utility functions (formatters, validators)
```

### Key Patterns

**Feature Modules:** Each feature is self-contained with components, hooks, and utils
**Direct Selectors:** Always use `useStore((state) => state.method)` to avoid infinite loops
**Repository Pattern:** Storage layer abstracts IndexedDB operations
**Provider Pattern:** LLM providers implement common interface for extensibility

### Scripts

```bash
npm run dev       # Start development server
npm run build     # Build for production
npm run lint      # Run ESLint
npm run preview   # Preview production build
```

## Documentation

Additional documentation is available in the `docs/` directory:
- **Storage Consolidation**: `docs/storage-consolidation/` - Database migration and architecture details
- **Schema Documentation**: `src/services/storage/SCHEMA.md` - Entity patterns and query examples

## Troubleshooting

**Build Issues:**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json dist
npm install
npm run build
```

**Storage Issues:**
```bash
# Open browser DevTools → Application → IndexedDB
# Delete database: ai-evals-platform
# Refresh page to reinitialize
```

**Debug Panel:**
- Press `Ctrl+Shift+D` (or `Cmd+Shift+D` on Mac) to open debug panel
- View evaluation logs, task queue, storage usage
- Export logs for troubleshooting

## Contributing

This is an internal project. For questions or issues, contact the development team.

## License

Proprietary - All rights reserved
