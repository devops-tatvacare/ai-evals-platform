# AI Evals Platform - Architecture Education Plan

**Goal:** Teach the fundamental separation of concerns in this React/TypeScript codebase through the **Prompt/Schema Management** use case - showing how folders work together from UI click to API persistence.

---

## 📚 Learning Path

This document explains the codebase architecture by following a real user flow:
**"User creates a new evaluation prompt and uses it to evaluate audio"**

### Workplan

- [x] Analyze codebase structure
- [ ] Explain folder responsibilities (types, constants, services, stores, hooks, components, features)
- [ ] Trace prompt creation flow through all layers
- [ ] Trace prompt usage in evaluation flow
- [ ] Provide quick reference cheat sheet

---

## 🏗️ Architecture Overview: The Folder Hierarchy

Think of this app as **layers of responsibility**:

```
┌─────────────────────────────────────────────┐
│  UI Layer (features/, components/)         │  ← User sees & clicks
├─────────────────────────────────────────────┤
│  State Layer (stores/)                      │  ← React state management
├─────────────────────────────────────────────┤
│  Business Logic (services/)                 │  ← Core algorithms
├─────────────────────────────────────────────┤
│  Data Layer (services/api/)                  │  ← HTTP API calls → PostgreSQL
└─────────────────────────────────────────────┘

Supporting cast:
- types/      → TypeScript definitions (the contract)
- constants/  → Hardcoded values (single source of truth)
- hooks/      → Reusable React logic (glue between UI & stores)
- utils/      → Pure functions (no side effects)
```

---

## 📁 Folder Responsibilities Explained

### 1. **`types/`** - The Contract Language

**Purpose:** Define the "shape" of data that flows through the app.

**Rule:** If data crosses a boundary (component → service, store → component, etc.), it must have a type.

**Example - Prompt Definition:**
```typescript
// src/types/prompt.types.ts
export interface PromptDefinition {
  id: string;
  name: string;                    // "Evaluation Prompt v3"
  version: number;                 // Auto-increment per type
  createdAt: Date;
  updatedAt: Date;
  promptType: 'transcription' | 'evaluation' | 'extraction';
  prompt: string;                  // The actual prompt text
  description?: string;
  isDefault?: boolean;
}
```

**Why this matters:**
- TypeScript prevents bugs: Can't pass a `SchemaDefinition` where `PromptDefinition` is expected
- Self-documenting: New developers see what fields exist without digging
- Intellisense: Your editor autocompletes properties

**Re-export pattern:**
```typescript
// src/types/index.ts
export * from './prompt.types';
export * from './schema.types';
// ... other types
```
Allows: `import { PromptDefinition, SchemaDefinition } from '@/types';`

---

### 2. **`constants/`** - Single Source of Truth

**Purpose:** Hardcoded values that never change at runtime. Prevents magic strings/numbers.

**What lives here:**
- Default prompts/schemas (seeded on first run)
- LLM model configurations
- Regex patterns
- UI labels/messages

**Example:**
```typescript
// src/constants/prompts.ts
export const DEFAULT_EVALUATION_PROMPT: Omit<PromptDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Default Evaluation v1',
  version: 1,
  promptType: 'evaluation',
  prompt: `You are an expert medical transcription evaluator...
  
Compare the AI transcript against the ground truth:
{{transcript}} vs {{llm_transcript}}

Output structured JSON per segment.`,
  isDefault: true,
};
```

**Why not hardcode in components?**
```typescript
// ❌ BAD: Scattered across files
<Button>Evaluation Prompt v3</Button>
const label = "Evaluation Prompt v3";

// ✅ GOOD: One place to change
import { PROMPT_TYPE_LABELS } from '@/constants';
<Button>{PROMPT_TYPE_LABELS.evaluation}</Button>
```

---

### 3. **`services/`** - The Business Logic Brain

**Purpose:** Pure business logic. No React, no JSX. Testable in isolation.

**Key principle:** Services don't know about React. They operate on raw data.

**Structure:**
```
services/
├── api/              ← HTTP client layer (fetch → FastAPI → PostgreSQL)
├── storage/          ← Barrel re-export from api/ (backward compat)
├── llm/              ← LLM provider abstraction (Gemini, OpenAI, etc.)
├── templates/        ← Prompt variable resolution ({{audio}}, {{transcript}})
├── evaluation/       ← Two-call evaluation orchestration
├── notifications/    ← Toast messages
├── logger/           ← Structured logging
└── errors/           ← Error normalization
```

**Example - API Client:**
```typescript
// src/services/api/promptsApi.ts
export const promptsRepository = {
  async save(appId: AppId, prompt: PromptDefinition): Promise<PromptDefinition> {
    return apiClient.post('/api/prompts', { ...prompt, app_id: appId });
  },

  async getAll(appId: AppId, promptType?: PromptType): Promise<PromptDefinition[]> {
    const params = new URLSearchParams({ app_id: appId });
    if (promptType) params.set('prompt_type', promptType);
    return apiClient.get(`/api/prompts?${params}`);
  },
};
```

**Why this pattern?**
- **Testable:** No React dependencies, just `promptsRepository.save(...)`
- **Reusable:** Called from components, hooks, or other services
- **Single Responsibility:** Only knows about HTTP API calls

**Template Service (Variable Resolution):**
```typescript
// src/services/templates/variableResolver.ts

// Registry defines what variables exist
export const TEMPLATE_VARIABLES = {
  '{{audio}}': {
    type: 'file',
    availableIn: ['transcription', 'evaluation'],
    required: true,
  },
  '{{transcript}}': {
    type: 'text',
    availableIn: ['evaluation'],
  },
  // ... more variables
};

// Resolver replaces variables with actual data
export function resolvePrompt(
  promptText: string, 
  context: { listing: Listing, audioBlob?: Blob }
): ResolvedPrompt {
  let resolved = promptText;
  
  // Replace {{transcript}} with actual transcript text
  if (context.listing.transcript) {
    resolved = resolved.replace(
      '{{transcript}}', 
      formatTranscript(context.listing.transcript)
    );
  }
  
  // {{audio}} is special - passed separately to LLM API
  const audioBlob = context.audioBlob;
  
  return { text: resolved, media: { audio: audioBlob } };
}
```

**LLM Service (Provider Pattern):**
```typescript
// src/services/llm/providers/GeminiProvider.ts
export class GeminiProvider implements ILLMProvider {
  async generateContent(
    prompt: string, 
    options?: LLMGenerateOptions
  ): Promise<LLMResponse> {
    const model = this.genai.getGenerativeModel({
      model: options?.model || 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: options?.schema ? 'application/json' : 'text/plain',
        responseSchema: options?.schema,
      },
    });
    
    const result = await model.generateContent(prompt);
    return { text: result.response.text() };
  }
}

// src/services/llm/providerRegistry.ts
const providers: Record<string, ILLMProvider> = {
  gemini: new GeminiProvider(apiKey),
  // openai: new OpenAIProvider(apiKey),  ← Future providers
};
```

---

### 4. **`stores/`** - State Management (Zustand)

**Purpose:** Global React state. Think of it as an "in-memory database" that React components can subscribe to.

**Why Zustand?** Simpler than Redux, better performance than Context API.

**Pattern:**
```typescript
// src/stores/promptsStore.ts
import { create } from 'zustand';

interface PromptsState {
  prompts: Record<AppId, PromptDefinition[]>;  // Cache
  isLoading: boolean;
  
  // Actions
  loadPrompts: (appId: AppId) => Promise<void>;
  savePrompt: (appId: AppId, prompt: PromptDefinition) => Promise<void>;
  deletePrompt: (appId: AppId, id: string) => Promise<void>;
}

export const usePromptsStore = create<PromptsState>((set, get) => ({
  prompts: { 'voice-rx': [], 'kaira-bot': [] },
  isLoading: false,
  
  loadPrompts: async (appId) => {
    set({ isLoading: true });
    const prompts = await promptsRepository.getAll(appId);
    set((state) => ({
      prompts: { ...state.prompts, [appId]: prompts },
      isLoading: false,
    }));
  },
  
  savePrompt: async (appId, prompt) => {
    const saved = await promptsRepository.save(appId, prompt);
    set((state) => ({
      prompts: {
        ...state.prompts,
        [appId]: [...state.prompts[appId], saved],
      },
    }));
  },
}));
```

**Store Types:**
- **`promptsStore`** / **`schemasStore`**: Cache prompt/schema definitions
- **`listingsStore`**: Cache evaluation records (audio metadata, results)
- **`settingsStore`**: Persisted user preferences (API keys, selected models)
- **`uiStore`**: Ephemeral UI state (sidebar open/closed, selected items)
- **`appStore`**: Current app context ('voice-rx' | 'kaira-bot')
- **`taskQueueStore`**: Background task tracking (progress bars)

**Critical Anti-Pattern:**
```typescript
// ❌ INFINITE LOOP: Re-renders on ANY store change
function MyComponent() {
  const store = usePromptsStore();  
  return <div>{store.prompts.length}</div>;
}

// ✅ CORRECT: Only re-renders when prompts change
function MyComponent() {
  const prompts = usePromptsStore((state) => state.prompts['voice-rx']);
  return <div>{prompts.length}</div>;
}

// ✅ CORRECT: One-off read in callback (doesn't subscribe)
function MyComponent() {
  const handleClick = () => {
    const prompts = usePromptsStore.getState().prompts['voice-rx'];
    console.log(prompts);
  };
  return <button onClick={handleClick}>Log Prompts</button>;
}
```

---

### 5. **`hooks/`** - Reusable React Logic

**Purpose:** Extract repetitive React logic into reusable functions. "Smart glue" between UI and stores/services.

**Rule:** Hook name starts with `use`. Can use other hooks inside.

**Example:**
```typescript
// src/hooks/useCurrentAppData.ts
export function useCurrentPrompts(): PromptDefinition[] {
  const appId = useAppStore((state) => state.currentApp);
  const prompts = usePromptsStore((state) => state.prompts[appId] || []);
  return prompts;
}

export function useCurrentPromptsActions() {
  const appId = useAppStore((state) => state.currentApp);
  const loadPrompts = usePromptsStore((state) => state.loadPrompts);
  const savePrompt = usePromptsStore((state) => state.savePrompt);
  
  return {
    loadPrompts: () => loadPrompts(appId),
    savePrompt: (prompt: PromptDefinition) => savePrompt(appId, prompt),
  };
}
```

**Usage in component:**
```typescript
function PromptsTab() {
  const prompts = useCurrentPrompts();  // ← Auto-scoped to current app
  const { loadPrompts, savePrompt } = useCurrentPromptsActions();
  
  useEffect(() => {
    loadPrompts();  // ← No need to pass appId
  }, []);
  
  return <div>{prompts.length} prompts loaded</div>;
}
```

**Common Hooks:**
- **`useCurrentAppData`**: Get data scoped to active app (voice-rx vs kaira-bot)
- **`useDebounce`**: Delay expensive operations (search, auto-save)
- **`useErrorHandler`**: Centralized error handling
- **`useKeyboardShortcuts`**: Global keyboard shortcuts (Ctrl+S to save)
- **`useUnsavedChanges`**: Warn before navigating away from unsaved form

---

### 6. **`components/`** - Reusable UI Building Blocks

**Purpose:** Generic UI components with no business logic. Pure presentation.

**Structure:**
```
components/
├── ui/                ← Base components (Button, Input, Modal)
├── layout/            ← App shell (Sidebar, Header)
└── feedback/          ← Loading spinners, error states
```

**Principle:** Components are dumb. They receive props, render JSX, emit events.

**Example:**
```typescript
// src/components/ui/Button.tsx
interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

export function Button({ children, onClick, variant = 'primary', disabled }: ButtonProps) {
  return (
    <button
      className={cn(
        'px-4 py-2 rounded',
        variant === 'primary' && 'bg-blue-500 text-white',
        variant === 'danger' && 'bg-red-500 text-white',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
```

**No Business Logic:**
```typescript
// ❌ BAD: Button knows about stores
export function SaveButton() {
  const save = usePromptsStore((state) => state.savePrompt);
  return <button onClick={save}>Save</button>;
}

// ✅ GOOD: Button receives callback as prop
export function Button({ onClick }) {
  return <button onClick={onClick}>Save</button>;
}
```

---

### 7. **`features/`** - Domain-Specific Modules

**Purpose:** Self-contained feature implementations. Each feature has its own UI, logic, and hooks.

**Structure:**
```
features/
├── settings/
│   ├── components/      ← PromptsTab, SchemasTab, PromptCreateOverlay
│   ├── hooks/           ← Feature-specific hooks (if needed)
│   └── index.ts         ← Public API
├── evals/
│   ├── components/      ← EvaluationOverlay, MetricsDisplay
│   ├── hooks/           ← useAIEvaluation, useHumanEvaluation
│   └── metrics/         ← Accuracy calculations
└── upload/
    ├── components/      ← AudioUploader, ValidationMessages
    ├── hooks/           ← useFileValidation
    └── utils/           ← Audio file processing
```

**Feature vs Component:**
- **Feature** = Business domain (Evaluation, Settings, Upload)
- **Component** = UI element (Button, Modal, Input)

**Example - Settings Feature:**
```typescript
// src/features/settings/components/PromptsTab.tsx
export function PromptsTab() {
  const prompts = useCurrentPrompts();
  const { savePrompt } = useCurrentPromptsActions();
  const [showModal, setShowModal] = useState(false);
  
  const handleCreate = async (text: string) => {
    await savePrompt({ promptType: 'evaluation', prompt: text });
    setShowModal(false);
  };
  
  return (
    <Card>
      <Button onClick={() => setShowModal(true)}>Create Prompt</Button>
      {prompts.map(p => <PromptCard key={p.id} prompt={p} />)}
      
      <PromptCreateOverlay 
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleCreate}
      />
    </Card>
  );
}
```

---

## 🔄 Real-World Flow: Creating & Using a Prompt

### **Use Case:** User creates evaluation prompt → uses it to evaluate audio

---

### **Part 1: Creating a Prompt**

**User Action:** Clicks "Create Prompt" button in Settings → Prompts tab

#### Step-by-Step Trace:

```typescript
// 1️⃣ UI Layer: User clicks button
// src/features/settings/components/PromptsTab.tsx
export function PromptsTab() {
  const [showModal, setShowModal] = useState(false);
  
  return (
    <Button onClick={() => setShowModal(true)}>
      Create Prompt
    </Button>
    
    <PromptCreateOverlay 
      isOpen={showModal}
      promptType="evaluation"
      onClose={() => setShowModal(false)}
    />
  );
}
```

```typescript
// 2️⃣ Modal Opens: User types prompt text
// src/features/settings/components/PromptCreateOverlay.tsx
export function PromptCreateOverlay({ isOpen, promptType, onClose }) {
  const { savePrompt } = useCurrentPromptsActions();  // ← Hook from hooks/
  const [promptText, setPromptText] = useState('');
  
  const handleSave = async () => {
    await savePrompt({
      promptType,
      prompt: promptText,
      description: 'My custom prompt',
    });
    onClose();
  };
  
  return (
    <Modal isOpen={isOpen}>
      <textarea 
        value={promptText} 
        onChange={(e) => setPromptText(e.target.value)} 
      />
      <Button onClick={handleSave}>Save</Button>
    </Modal>
  );
}
```

```typescript
// 3️⃣ Hook Layer: Wraps store actions with current app context
// src/hooks/useCurrentAppData.ts
export function useCurrentPromptsActions() {
  const appId = useAppStore((state) => state.currentApp);  // 'voice-rx' or 'kaira-bot'
  const savePromptAction = usePromptsStore((state) => state.savePrompt);
  
  return {
    savePrompt: (prompt: Partial<PromptDefinition>) => 
      savePromptAction(appId, prompt),
  };
}
```

```typescript
// 4️⃣ Store Layer: Orchestrates save + updates cache
// src/stores/promptsStore.ts
export const usePromptsStore = create<PromptsState>((set, get) => ({
  prompts: { 'voice-rx': [], 'kaira-bot': [] },
  
  savePrompt: async (appId, prompt) => {
    // Call repository to persist
    const saved = await promptsRepository.save(appId, prompt);
    
    // Update in-memory cache
    set((state) => ({
      prompts: {
        ...state.prompts,
        [appId]: [...state.prompts[appId], saved],
      },
    }));
    
    return saved;
  },
}));
```

```typescript
// 5️⃣ API Layer: HTTP call to backend
// src/services/api/promptsApi.ts
export const promptsRepository = {
  async save(appId: AppId, prompt: Partial<PromptDefinition>): Promise<PromptDefinition> {
    // Backend handles version auto-increment and persistence
    return apiClient.post('/api/prompts', {
      app_id: appId,
      prompt_type: prompt.promptType,
      name: prompt.name,
      prompt: prompt.prompt,
      description: prompt.description,
    });
  },
};
```

**Result:** Prompt is now:
1. Persisted in PostgreSQL `prompts` table via FastAPI backend
2. Cached in `promptsStore` state
3. Visible in PromptsTab UI (React re-renders automatically)

---

### **Part 2: Using the Prompt in Evaluation**

**User Action:** Selects prompt in EvaluationOverlay → clicks "Evaluate"

#### Step-by-Step Trace:

```typescript
// 1️⃣ UI Layer: User selects prompt from dropdown
// src/features/evals/components/EvaluationOverlay.tsx
export function EvaluationOverlay({ listing }) {
  const prompts = useCurrentPrompts();
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const { evaluate } = useAIEvaluation();  // ← Hook from features/evals/hooks
  
  const handleEvaluate = async () => {
    const prompt = prompts.find(p => p.id === selectedPromptId);
    
    await evaluate(listing, {
      prompts: {
        transcription: '...',
        evaluation: prompt!.prompt,  // ← User's custom prompt
      },
    });
  };
  
  return (
    <Modal>
      <select onChange={(e) => setSelectedPromptId(e.target.value)}>
        {prompts.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <Button onClick={handleEvaluate}>Evaluate</Button>
    </Modal>
  );
}
```

```typescript
// 2️⃣ Hook Layer: Orchestrates two-call evaluation flow
// src/features/evals/hooks/useAIEvaluation.ts
export function useAIEvaluation() {
  const evaluate = async (listing: Listing, config: EvaluationConfig) => {
    // Load audio file from storage
    const audioBlob = await filesRepository.getAudioBlob(listing.id);
    
    // Resolve template variables in prompt
    const resolved = resolvePrompt(config.prompts.evaluation, {
      listing,
      audioBlob,
    });
    
    // CALL 1: Transcription (if not skipped)
    const transcriptResult = await evaluationService.transcribe(
      audioBlob,
      config.prompts.transcription
    );
    
    // CALL 2: Critique (uses Call 1 result)
    const evaluationResult = await evaluationService.critique(
      audioBlob,
      resolved.text,  // ← User's prompt with variables resolved
      transcriptResult
    );
    
    // Save results to database
    const aiEval: AIEvaluation = {
      id: generateId(),
      listingId: listing.id,
      result: evaluationResult,
      createdAt: new Date(),
    };
    
    await listingsRepository.updateAIEvaluation(listing.id, aiEval);
    
    return aiEval;
  };
  
  return { evaluate };
}
```

```typescript
// 3️⃣ Service Layer: Template variable resolution
// src/services/templates/variableResolver.ts
export function resolvePrompt(
  promptText: string, 
  context: { listing: Listing, audioBlob: Blob }
): ResolvedPrompt {
  let resolved = promptText;
  
  // Replace {{transcript}} with actual transcript
  if (promptText.includes('{{transcript}}') && context.listing.transcript) {
    const formatted = context.listing.transcript.segments
      .map(seg => `[${seg.speaker}]: ${seg.text}`)
      .join('\n');
    resolved = resolved.replace('{{transcript}}', formatted);
  }
  
  // Replace {{llm_transcript}} (from Call 1)
  if (promptText.includes('{{llm_transcript}}') && context.listing.aiEvaluation) {
    const llmTranscript = context.listing.aiEvaluation.llmTranscript;
    resolved = resolved.replace('{{llm_transcript}}', llmTranscript);
  }
  
  // {{audio}} is passed separately (not text-replaced)
  return { 
    text: resolved, 
    media: { audio: context.audioBlob } 
  };
}
```

```typescript
// 4️⃣ Service Layer: LLM invocation
// src/services/llm/EvaluationService.ts
export class EvaluationService {
  async critique(
    audioBlob: Blob,
    prompt: string,
    transcriptResult: TranscriptData
  ): Promise<EvaluationResult> {
    const provider = createProvider('gemini', apiKey);
    
    // Call LLM with audio + prompt
    const response = await provider.generateContentWithAudio(
      prompt,
      audioBlob,
      'audio/webm',
      {
        model: 'gemini-2.0-flash',
        schema: evaluationSchema,  // Force structured JSON output
      }
    );
    
    // Parse structured response
    const result = JSON.parse(response.text);
    return result;
  }
}
```

**Result:**
1. Prompt text has variables replaced with actual data
2. LLM receives resolved prompt + audio file
3. Evaluation results saved to database
4. UI shows results in TranscriptView

---

## 🗂️ Data Flow Diagram

```
User Action (UI)
    ↓
Component (features/)
    ↓
Hook (hooks/) ← Wraps store actions with app context
    ↓
Store (stores/) ← In-memory cache + orchestration
    ↓
API Client (services/api/) ← HTTP fetch calls
    ↓
FastAPI Backend → PostgreSQL ← Persistence
```

**Read Flow (Prompt Selector Dropdown):**
```
PromptsTab component
    ↓
useCurrentPrompts() hook  ← Auto-filters by current app
    ↓
usePromptsStore((state) => state.prompts[appId])
    ↓
Returns cached array (React re-renders on changes)
```

**Write Flow (Save Prompt):**
```
PromptCreateOverlay component
    ↓
useCurrentPromptsActions().savePrompt()
    ↓
usePromptsStore.getState().savePrompt(appId, prompt)
    ↓
promptsRepository.save(appId, prompt)
    ↓
apiClient.post('/api/prompts', data)
    ↓
FastAPI → PostgreSQL INSERT
```

---

## 🧠 Mental Models to Internalize

### Model 1: Layers Talk Down, Events Bubble Up

```
UI Layer          → Emits events (onClick, onSave)
                  ← Receives data via props

State Layer       → Calls services
                  ← Returns data synchronously

Service Layer     → Pure functions
                  ← Never calls React hooks

Data Layer        → Raw database operations
```

### Model 2: Types are the Contract

```typescript
// Service promises to return this shape
function getPrompt(id: string): Promise<PromptDefinition>

// Component promises to accept this shape
function PromptCard({ prompt }: { prompt: PromptDefinition })

// TypeScript enforces the contract at compile time
```

### Model 3: Stores are Caches, Not Databases

```typescript
// ❌ Wrong mental model: "Store is the source of truth"
const prompts = usePromptsStore(state => state.prompts);
// What if user refreshes page? Data is lost!

// ✅ Correct: "Store is a cache of API data"
useEffect(() => {
  loadPrompts();  // Fetch from API on mount
}, []);
```

### Model 4: Features Own Their Domain

```
features/settings/    ← Owns prompt/schema management UI
features/evals/       ← Owns evaluation orchestration
features/upload/      ← Owns audio file validation

They share services/ and stores/ but don't import from each other.
```

---

## 📝 Quick Reference Cheat Sheet

| Need to...                        | Use...                          | Example                                      |
|-----------------------------------|---------------------------------|----------------------------------------------|
| Define data shape                 | `types/`                        | `PromptDefinition` interface                 |
| Store hardcoded values            | `constants/`                    | `DEFAULT_EVALUATION_PROMPT`                  |
| Call backend API                  | `services/api/`                 | `promptsRepository.save()`                   |
| Call LLM API                      | `services/llm/`                 | `provider.generateContent()`                 |
| Resolve template variables        | `services/templates/`           | `resolvePrompt(promptText, context)`         |
| Manage React state globally       | `stores/`                       | `usePromptsStore()`                          |
| Extract reusable React logic      | `hooks/`                        | `useCurrentPrompts()`                        |
| Create generic UI component       | `components/ui/`                | `<Button>`, `<Modal>`                        |
| Implement feature-specific UI     | `features/<feature>/components` | `PromptCreateOverlay`                        |
| Implement feature-specific logic  | `features/<feature>/hooks`      | `useAIEvaluation()`                          |

---

## 💡 Key Takeaways

1. **Separation of Concerns:**
   - Types define contracts
   - Constants avoid magic values
   - Services contain logic
   - Stores manage state
   - Hooks connect React to state
   - Components render UI
   - Features bundle domain logic

2. **Data Flow is Unidirectional:**
   - UI → Hook → Store → Service → Database
   - Database → Service → Store → Hook → UI (re-render)

3. **Never Mix Layers:**
   - Services don't import React
   - Components don't call repositories directly
   - Stores don't render JSX

4. **Use Existing Patterns:**
   - New prompt type? Add to `PromptDefinition['promptType']` union
   - New LLM provider? Implement `ILLMProvider` interface
   - New feature? Create `features/<name>/` folder

5. **Template Variables Bridge Prompts and Data:**
   - User writes: `{{transcript}}` in prompt
   - Resolver replaces with actual transcript text
   - LLM receives final resolved prompt

---

## 🎯 Next Steps

After understanding this:
1. Try tracing another flow (Schema creation, Chat with Kaira Bot)
2. Add a new template variable (`{{word_count}}`)
3. Create a new prompt type (`'summarization'`)
4. Implement a new LLM provider (OpenAI)

The patterns stay the same - just apply them to new domains!
