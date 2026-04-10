# Floating Chat Widget — Design Spec

## Goal

Replace the `BuilderOverlay` with a floating bottom-right chat widget that lives at the layout level, supports Gemini and OpenAI providers with simplified selection (no `LLMConfigSection`), renders rich markdown + tool call badges, and reads prompt templates from `App.config.chat`.

## Architecture

The widget is a self-contained feature at `src/features/chat-widget/`. It mounts in `MainLayout`, persists across page navigation, and communicates with the existing `/api/report-builder/chat` endpoint (extended with tool call metadata and optional SSE streaming). Provider selection is two pills (Gemini | OpenAI). Default models come from backend env vars. Credentials resolved via existing `settings_helper`.

## Scope

**In scope (Phase 1+2):**
- Floating widget (collapsed bubble / expanded panel, resizable)
- Simplified provider toggle (Gemini | OpenAI, no model picker)
- Default models from backend env vars (`GEMINI_MODEL`, `OPENAI_MODEL`)
- Credential availability check via existing `/api/llm/auth-status`
- App-specific prompt templates from `App.config.chat.promptTemplates[]`
- ReactMarkdown rendering for all assistant messages
- Tool call badges rendered inline in message bubbles
- Streaming via SSE with buffered React rendering
- Tool calling visibility (start/end events, pulsing badge state)
- `composedReport` inline preview (existing `MiniReportPreview` reused)
- "Build custom report" button on Report tab opens/focuses widget with pre-filled prompt

**Out of scope:**
- Anthropic adapter
- Phase 3 narrative analytics tools
- Chat history persistence to database
- Multi-session management in sidebar

---

## 1. Backend Changes

### 1.1 New endpoint: `GET /api/chat-engine/defaults`

Returns default model per provider and availability based on env vars + credential resolution.

```python
# backend/app/routes/chat_engine.py
@router.get("/defaults")
async def get_defaults(auth: AuthContext = Depends(get_auth_context)):
    return {
        "gemini": {
            "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            "available": True,  # always available, creds checked separately
        },
        "openai": {
            "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            "available": True,
        },
    }
```

### 1.2 Extended chat response schema

Add `tool_calls` to `BuilderChatResponse`:

```python
class ToolCallOut(CamelModel):
    name: str
    summary: str

class BuilderChatResponse(CamelModel):
    session_id: str
    role: str = "assistant"
    content: str
    tool_calls: list[ToolCallOut] = []
    composed_report: ComposedReportOut | None = None
```

The `run_chat_turn` function collects tool call summaries as tools execute and returns them.

### 1.3 SSE streaming endpoint: `POST /api/report-builder/chat/stream`

New endpoint that yields Server-Sent Events:

```python
@router.post("/chat/stream")
async def chat_stream(body: BuilderChatRequest, auth, db):
    # ... session setup same as /chat ...
    
    async def event_generator():
        # yields SSE events:
        # event: tool_call_start  data: {"name": "..."}
        # event: tool_call_end    data: {"name": "...", "summary": "..."}
        # event: content_delta    data: {"delta": "..."}
        # event: done             data: {"composedReport": ..., "toolCalls": [...]}
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

The runner needs a callback mechanism so `dispatch_fn` can emit events as tools start/finish. The adapter's `send()` method streams content deltas.

**Fallback:** If streaming adds too much complexity, Phase 1 uses the existing request/response `/chat` endpoint with the extended schema. The frontend shows a "thinking" animation with tool badges appearing as they complete. SSE added as fast follow.

### 1.4 Tool call tracking in chat_handler

The `dispatch` closure in `run_chat_turn` already has access to each tool call. Extend it to collect summaries:

```python
tool_call_log: list[dict] = []

async def dispatch(name, arguments):
    result_str = await dispatch_tool_call(...)
    
    # Generate summary from result
    summary = _summarize_tool_result(name, result_str)
    tool_call_log.append({"name": name, "summary": summary})
    
    return result_str

# After run_tool_loop:
return {
    "role": "assistant",
    "content": text,
    "tool_calls": tool_call_log,
    "composed_report": composed_report,
}
```

`_summarize_tool_result` extracts a short label: "13 types", "kaira-bot", "5 sections", "saved", etc.

---

## 2. Frontend Components

### 2.1 File Structure

```
src/features/chat-widget/
  ChatWidget.tsx         — floating container + bubble
  ChatMessages.tsx       — message list with ReactMarkdown
  ToolCallBadge.tsx      — single tool call badge (name + summary + status)
  ProviderToggle.tsx     — Gemini | OpenAI pills
  PromptChips.tsx        — app-specific prompt buttons
  ChatInput.tsx          — textarea + send button
  api.ts                 — sendMessage, streamMessage, getDefaults
  types.ts               — WidgetMessage, ToolCallBadge, ChatWidgetState
  useChatWidget.ts       — Zustand store slice for widget state
```

### 2.2 ChatWidget.tsx (Container)

- Renders at `MainLayout` level, fixed bottom-right
- **Collapsed:** 56px purple bubble with chat icon
- **Expanded:** 420×560px panel, resizable (min 360×400, max 600×80vh)
- Header: icon + "AI Assistant" + app tag (from `useAppStore.currentApp`) + new/minimize/close buttons
- Provider toggle bar (below header)
- Messages area (scrollable, flex-1)
- Input area (bottom)
- Only renders if `appConfig.chat?.enabled !== false`

### 2.3 ProviderToggle.tsx

Two pills: Gemini | OpenAI.

```typescript
interface ProviderToggleProps {
  selected: 'gemini' | 'openai' | null;
  onSelect: (provider: 'gemini' | 'openai') => void;
  locked: boolean;  // true after first message sent
  disabled: { gemini: boolean; openai: boolean };  // from credential check
}
```

- Checks `hasProviderCredentials()` for each provider
- Azure credentials enable the OpenAI pill (backend routes Azure through OpenAI adapter)
- Disabled pill: grayed out, tooltip "Configure in Settings → LLM Auth"
- Locked state: only selected pill visible, shows lock icon, other pill hidden

### 2.4 ChatMessages.tsx

Renders the message list:

```typescript
interface Props {
  messages: WidgetMessage[];
  status: 'idle' | 'streaming' | 'tool_calling';
  activeToolCall: string | null;
}
```

Each assistant message renders:
1. **Tool call badges** (if any) — `ToolCallBadge` components above content
2. **Content** — `<ReactMarkdown>` with `remarkGfm` for tables, strikethrough, etc.
3. **Composed report preview** — `MiniReportPreview` if `composedReport` is set

User messages render as plain styled text (no markdown needed).

### 2.5 ToolCallBadge.tsx

```typescript
interface ToolCallBadgeProps {
  name: string;
  summary?: string;
  status: 'running' | 'done';
}
```

- Running: pulsing dot + tool name + "running..."
- Done: checkmark + tool name + summary text
- Styled: `font-mono`, compact, brand-accent background

### 2.6 PromptChips.tsx

```typescript
interface PromptChipsProps {
  templates: Array<{ label: string; prompt: string; category?: string }>;
  onSelect: (prompt: string) => void;
}
```

- Reads from `appConfig.chat.promptTemplates`
- Renders as pill buttons in the empty state
- Clicking sends the `prompt` string as a user message
- Grouped by `category` if present

### 2.7 useChatWidget.ts (Zustand Store)

```typescript
interface ChatWidgetStore {
  // UI state
  open: boolean;
  toggle: () => void;
  openWithPrompt: (prompt: string) => void;  // opens + sends prompt
  
  // Session state
  sessionId: string | null;
  provider: 'gemini' | 'openai' | null;
  model: string;
  messages: WidgetMessage[];
  status: 'idle' | 'streaming' | 'tool_calling';
  activeToolCall: string | null;
  
  // Actions
  setProvider: (p: 'gemini' | 'openai') => void;
  send: (text: string, db: AsyncSession?) => Promise<void>;
  reset: () => void;  // new chat
  
  // Defaults (loaded once)
  defaults: { gemini: { model: string }; openai: { model: string } } | null;
  loadDefaults: () => Promise<void>;
}
```

- Provider locked after first `send()` call
- `openWithPrompt()` used by "Build custom report" button on Report tab
- `loadDefaults()` called on mount, caches result
- `send()` creates session on first call, adds user message optimistically, calls API, appends assistant response

### 2.8 Streaming Flow (in `send`)

```typescript
async send(text) {
  // 1. Optimistically add user message
  addMessage({ role: 'user', content: text, status: 'complete' });
  
  // 2. Add placeholder assistant message
  const msgId = addMessage({ role: 'assistant', content: '', status: 'streaming', toolCalls: [] });
  set({ status: 'streaming' });
  
  // 3. Open SSE connection
  const eventSource = await streamMessage({ sessionId, message: text, provider, model });
  
  eventSource.on('tool_call_start', (data) => {
    set({ status: 'tool_calling', activeToolCall: data.name });
    appendToolCall(msgId, { name: data.name, status: 'running' });
  });
  
  eventSource.on('tool_call_end', (data) => {
    updateToolCall(msgId, data.name, { summary: data.summary, status: 'done' });
  });
  
  eventSource.on('content_delta', (data) => {
    set({ status: 'streaming', activeToolCall: null });
    appendContent(msgId, data.delta);  // batched, debounced at 50ms
  });
  
  eventSource.on('done', (data) => {
    finalizeMessage(msgId, data);
    set({ status: 'idle' });
  });
}
```

**Fallback (non-streaming):** Replace SSE with a single `POST /chat` call. Show "thinking" animation. On response, populate tool calls + content at once.

---

## 3. App.config.chat Schema

New key added to `App.config` JSONB:

```json
{
  "chat": {
    "enabled": true,
    "promptTemplates": [
      {
        "label": "Build compliance report",
        "prompt": "Build a compliance-focused report for this app with rule checks and friction analysis",
        "category": "report"
      },
      {
        "label": "Show recent eval runs",
        "prompt": "List the last 10 evaluation runs with their pass rates and types",
        "category": "data"
      },
      {
        "label": "Worst performing threads",
        "prompt": "Show me the threads with the lowest scores from the most recent batch eval",
        "category": "data"
      }
    ],
    "capabilities": ["report_builder"]
  }
}
```

- Stored per-app in the `apps` table `config` column
- Frontend reads via `useAppStore.getAppConfig(currentApp).chat`
- Seeded per-app with sensible defaults via migration or seed script
- `capabilities` controls which tool sets the backend loads (future: `data_explorer`)

---

## 4. Integration Points

### 4.1 MainLayout

```tsx
// src/components/layout/MainLayout.tsx
import { ChatWidget } from '@/features/chat-widget/ChatWidget';

// Inside the layout, after <main>:
<ChatWidget />
```

### 4.2 Report Tab — "Build custom report" button

```tsx
// Instead of opening BuilderOverlay:
const { openWithPrompt } = useChatWidgetStore();
<Button onClick={() => openWithPrompt('Build a custom report for this evaluation run')}>
  Build custom report
</Button>
```

### 4.3 BuilderOverlay deletion

- Delete `src/features/reportBuilder/components/BuilderOverlay.tsx`
- Remove from `ReportTab.tsx` imports and usage
- Keep `src/features/reportBuilder/api.ts` and `types.ts` (reused by widget)
- Keep `MiniReportPreview` logic — extract to shared component or inline in `ChatMessages.tsx`

---

## 5. Message Rendering

All assistant messages rendered with:

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>
  {message.content}
</ReactMarkdown>
```

Styled with scoped CSS:
- Tables: bordered, compact, mono headers
- Code blocks: `font-mono`, `bg-tertiary` background
- Bold: `text-primary` weight
- Lists: tight spacing
- Links: brand color, underlined

No raw JSON ever shown to user. The backend returns clean natural language content. Tool results are summarized by the LLM, not dumped raw.

---

## 6. What Changes

| Action | Path | Notes |
|--------|------|-------|
| Create | `src/features/chat-widget/` (8 files) | New feature directory |
| Create | `backend/app/routes/chat_engine.py` | `/api/chat-engine/defaults` endpoint |
| Modify | `backend/app/routes/report_builder.py` | Add `/chat/stream` SSE endpoint |
| Modify | `backend/app/services/report_builder/chat_handler.py` | Track tool call summaries |
| Modify | `backend/app/services/report_builder/schemas.py` | Add `ToolCallOut` to response |
| Modify | `src/components/layout/MainLayout.tsx` | Mount `<ChatWidget />` |
| Modify | `src/features/evalRuns/components/report/ReportTab.tsx` | Replace overlay with widget trigger |
| Delete | `src/features/reportBuilder/components/BuilderOverlay.tsx` | Replaced by ChatWidget |
| Modify | `backend/app/main.py` | Register chat_engine router |
| Seed | `App.config` for each app | Add `chat` key with prompt templates |

---

## 7. Non-Goals

- No chat history in database (in-memory sessions with TTL, same as now)
- No multi-session sidebar (single active session per widget)
- No Anthropic support
- No model picker in UI (env var defaults only)
- No Phase 3 narrative analytics tools
