import {
  Card,
  MermaidDiagram,
  DataTable,
  CodeBlock,
  PageHeader,
} from "@/components";
import { usePageExport } from "@/hooks/usePageExport";
import { dbModels, type DbModel } from "@/data/dbModels";
import { apiRoutes, type ApiRoute } from "@/data/apiRoutes";

const erDiagram = `erDiagram
    Listing ||--o{ EvalRun : has
    ChatSession ||--o{ ChatMessage : contains
    ChatSession ||--o{ EvalRun : has
    Evaluator ||--o{ EvalRun : used_in
    Job ||--o{ EvalRun : triggers
    EvalRun ||--o{ ThreadEvaluation : produces
    EvalRun ||--o{ AdversarialEvaluation : produces
    EvalRun ||--o{ ApiLog : logs
    EvalRun ||--o{ EvaluationAnalytics : cached_in

    Listing {
        UUID id PK
        string app_id
        JSONB transcript
        JSONB audio_file
    }
    EvalRun {
        UUID id PK
        string eval_type
        string status
        JSONB result
        JSONB summary
    }
    Job {
        UUID id PK
        string job_type
        string status
        JSONB params
    }
    Evaluator {
        UUID id PK
        string name
        text prompt
        JSONB output_schema
    }
    ChatSession {
        UUID id PK
        string app_id
        string thread_id
        string title
    }
    ChatMessage {
        UUID id PK
        UUID session_id FK
        string role
        text content
    }
    ThreadEvaluation {
        int id PK
        UUID run_id FK
        string thread_id
        JSONB result
    }
    AdversarialEvaluation {
        int id PK
        UUID run_id FK
        string category
        string verdict
    }
    ApiLog {
        int id PK
        UUID run_id FK
        string provider
        string model
    }
    EvaluationAnalytics {
        UUID id PK
        string app_id
        string scope
        UUID run_id FK
        JSONB analytics_data
    }`;

const apiClientCode = `// Frontend API client (src/services/api/client.ts)
import { apiRequest, apiUpload, apiDownload } from '@/services/api/client';

// GET request with query params
const listings = await apiRequest<Listing[]>('/api/listings?app_id=voice-rx');

// POST with JSON body
const job = await apiRequest<Job>('/api/jobs', {
  method: 'POST',
  body: JSON.stringify({ job_type: 'evaluate-voice-rx', params: {...} })
});

// File upload (multipart/form-data)
const file = await apiUpload('/api/files/upload', formData);

// Binary download
const blob = await apiDownload('/api/files/{id}/download');`;

const dbModelColumns = [
  {
    key: "model" as const,
    header: "Model",
    render: (val: unknown) => (
      <code style={{ color: "var(--accent-text)", fontSize: "0.8125rem" }}>
        {String(val)}
      </code>
    ),
  },
  {
    key: "table" as const,
    header: "Table",
    render: (val: unknown) => (
      <code style={{ fontSize: "0.8125rem" }}>{String(val)}</code>
    ),
  },
  {
    key: "keyColumns" as const,
    header: "Key Columns",
    wrap: true,
    render: (val: unknown) => (
      <span className="inline-flex flex-wrap gap-1">
        {String(val)
          .split(", ")
          .map((col, i) => (
            <code
              key={i}
              className="inline-block px-1.5 py-0.5 rounded text-[11px]"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {col}
            </code>
          ))}
      </span>
    ),
  },
  { key: "description" as const, header: "Description", wrap: true },
];

const apiRouteColumns = [
  {
    key: "router" as const,
    header: "Router",
    render: (val: unknown) => (
      <code style={{ color: "var(--accent-text)", fontSize: "0.8125rem" }}>
        {String(val)}
      </code>
    ),
  },
  {
    key: "prefix" as const,
    header: "Prefix",
    render: (val: unknown) => (
      <code style={{ fontSize: "0.8125rem" }}>{String(val)}</code>
    ),
  },
  {
    key: "keyEndpoints" as const,
    header: "Key Endpoints",
    wrap: true,
    render: (val: unknown) => (
      <span className="inline-flex flex-wrap gap-1">
        {String(val)
          .split(", ")
          .map((ep, i) => {
            const [method, ...rest] = ep.split(" ");
            const path = rest.join(" ");
            const color =
              method === "GET"
                ? "#10b981"
                : method === "POST"
                  ? "#3b82f6"
                  : method === "PUT"
                    ? "#f59e0b"
                    : method === "DELETE"
                      ? "#ef4444"
                      : "var(--text-secondary)";
            return (
              <code
                key={i}
                className="inline-block px-1.5 py-0.5 rounded text-[11px]"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <span style={{ color, fontWeight: 600 }}>{method}</span>{" "}
                <span style={{ color: "var(--text-secondary)" }}>{path}</span>
              </code>
            );
          })}
      </span>
    ),
  },
  { key: "description" as const, header: "Description", wrap: true },
];

export default function DbApiRef() {
  const { contentRef } = usePageExport();

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="DB & API Reference"
    >
      <PageHeader
        title="Database Models"
        subtitle={
          <>
            16 SQLAlchemy models across 12 files, designed around{" "}
            <code>EvalRun</code> as the unified record for evaluation outcomes.
          </>
        }
        pageTitle="DB & API Reference"
        contentRef={contentRef}
      />

      <DataTable<DbModel> columns={dbModelColumns} data={dbModels} />

      {/* Entity Relationships */}
      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Entity Relationships
      </h2>
      <MermaidDiagram chart={erDiagram} />

      {/* API Routes */}
      <h2
        className="text-2xl font-bold mt-12 mb-2"
        style={{ color: "var(--text)" }}
      >
        API Routes
      </h2>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {apiRoutes.length} routers registered in main.py, all prefixed with
          /api/.
        </p>
        <a
          href="#api-explorer"
          className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          style={{
            background: "var(--accent-surface)",
            color: "var(--accent-text)",
            border: "1px solid var(--border)",
          }}
        >
          Go to API Explorer playground
        </a>
      </div>

      <DataTable<ApiRoute> columns={apiRouteColumns} data={apiRoutes} />

      {/* API Client Pattern */}
      <h2
        className="text-2xl font-bold mt-8 mb-4"
        style={{ color: "var(--text)" }}
      >
        API Client Pattern
      </h2>
      <Card>
        <CodeBlock code={apiClientCode} language="typescript" />
      </Card>
    </div>
  );
}
