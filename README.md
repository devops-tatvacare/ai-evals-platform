# Voice RX Evaluator

A modern web application for evaluating medical transcription quality. Upload audio files and transcripts, generate AI-powered transcriptions, compare results, and perform human evaluations.

## Features

- **Audio & Transcript Upload**: Support for WAV, MP3, WebM audio and JSON/TXT transcripts
- **AI Transcription**: Generate transcriptions using Google Gemini API
- **Transcript Comparison**: Side-by-side diff view with match percentage
- **Human Evaluation**: Review and correct transcripts with inline editing
- **Export Options**: Export data as JSON, CSV, or PDF
- **Dark/Light Theme**: Toggle between themes for comfortable viewing
- **Offline Support**: Data persisted locally with IndexedDB

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd voice-rx-evaluator

# Install dependencies
npm install

# Start development server
npm run dev
```

### Configuration

1. Navigate to **Settings** in the application
2. Go to **AI Configuration** tab
3. Enter your Google Gemini API key
4. (Optional) Customize prompts in the **Prompts** tab

## Usage

### Creating an Evaluation

1. Click **New** in the sidebar or go to the home page
2. Drag & drop or select audio and/or transcript files
3. Click **Create Evaluation**

### AI Evaluation

1. Open a listing and go to the **Evals** tab
2. Click **Request AI Evaluation**
3. View the transcript comparison and match percentage
4. Re-run evaluation if needed

### Human Review

1. After AI evaluation, switch to the **Human Review** tab
2. Review each segment and make corrections inline
3. Add overall score (1-5) and notes
4. Changes auto-save every second

### Exporting Data

Click the **Export** button on any listing to download:
- **JSON (Full Data)**: Complete listing with all evaluations
- **CSV (Transcript Segments)**: Transcript segments in spreadsheet format
- **PDF (Evaluation Report)**: Formatted report for sharing
- **JSON (Human Corrections)**: Only human evaluation corrections

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

## Adding New LLM Providers

1. Create a new service in `src/services/llm/providers/`
2. Implement the provider interface:
```typescript
interface LLMProvider {
  id: string;
  name: string;
  transcribe(audio: Blob, prompt: string): Promise<string>;
}
```
3. Register in `src/services/llm/index.ts`

## Adding New Export Formats

1. Create exporter in `src/services/export/exporters/`
2. Implement the `Exporter` interface:
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

## Development

### Tech Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS v4
- **State Management**: Zustand
- **Storage**: IndexedDB (Dexie)
- **Audio**: WaveSurfer.js
- **PDF Export**: jsPDF
- **Diff View**: react-diff-viewer-continued

### Project Structure

```
src/
├── app/              # App entry, routing, providers
├── components/       # Shared UI components
├── constants/        # App constants and defaults
├── features/         # Feature modules
│   ├── debug/        # Debug panel (dev mode)
│   ├── evals/        # AI & human evaluation
│   ├── export/       # Export functionality
│   ├── listings/     # Listing management
│   ├── settings/     # App settings
│   ├── transcript/   # Transcript view & audio player
│   └── upload/       # File upload
├── hooks/            # Custom React hooks
├── services/         # External services
│   ├── errors/       # Error handling
│   ├── export/       # Export infrastructure
│   ├── llm/          # LLM integration
│   ├── logger/       # Logging service
│   └── storage/      # IndexedDB repositories
├── stores/           # Zustand stores
├── styles/           # Global styles
├── types/            # TypeScript types
└── utils/            # Utility functions
```

### Scripts

```bash
npm run dev       # Start development server
npm run build     # Build for production
npm run lint      # Run ESLint
npm run preview   # Preview production build
```

## License

MIT
