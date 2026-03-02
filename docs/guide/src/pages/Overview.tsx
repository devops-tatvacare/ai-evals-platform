import {
  ArrowRight,
  Database,
  Monitor,
  Server,
  type LucideIcon,
} from "lucide-react";
import { Card, MermaidDiagram, Badge, PageHeader } from "@/components";
import { usePageExport } from "@/hooks/usePageExport";

const archDiagram = `graph TB
    Browser["Browser (React + Vite)"] -->|"/api/*"| Vite["Vite Dev Proxy :5173"]
    Vite -->|"Proxy"| FastAPI["FastAPI :8721"]
    FastAPI -->|"async SQLAlchemy"| PG["PostgreSQL :5432"]
    FastAPI -->|"Starts on boot"| Worker["Job Worker Loop"]
    Worker -->|"Polls every 5s"| PG
    Worker -->|"evaluate-voice-rx"| VRX["voice_rx_runner"]
    Worker -->|"evaluate-batch"| Batch["batch_runner"]
    Worker -->|"evaluate-adversarial"| Adv["adversarial_runner"]
    Worker -->|"evaluate-custom"| Custom["custom_evaluator_runner"]
    Worker -->|"evaluate-custom-batch"| CustomBatch["custom_evaluator_runner (batch)"]
    Worker -->|"generate-report"| Report["report_service"]
    Worker -->|"generate-cross-run-report"| CrossReport["cross_run_aggregator"]
    VRX -->|"API calls"| LLM["LLM Providers (Gemini / OpenAI / Anthropic / Azure OpenAI)"]
    Batch --> LLM
    Adv --> LLM
    Custom --> LLM
    CustomBatch --> LLM
    Report --> LLM
    CrossReport --> LLM

    style Browser fill:#6366f1,color:#fff
    style FastAPI fill:#10b981,color:#fff
    style PG fill:#f59e0b,color:#fff
    style Worker fill:#8b5cf6,color:#fff
    style LLM fill:#ec4899,color:#fff`;

const workspaces = [
  {
    iconSrc: "/voice-rx-icon.jpeg",
    iconAlt: "Voice RX icon",
    title: "Voice RX",
    description:
      "Evaluate medical voice transcription quality. Upload audio + transcripts, run AI-judged transcription and per-segment critique using a two-call LLM pipeline.",
    badges: [
      { color: "blue" as const, label: "Transcription" },
      { color: "purple" as const, label: "Evaluation" },
    ],
  },
  {
    iconSrc: "/kaira-icon.svg",
    iconAlt: "Kaira Bot icon",
    title: "Kaira Bot",
    description:
      "Test and evaluate the Kaira health assistant. Run live chat sessions via SSE streaming, evaluate conversations with custom evaluators, batch-score CSV thread datasets at scale, and run adversarial stress tests against the live API.",
    badges: [
      { color: "green" as const, label: "Chat" },
      { color: "purple" as const, label: "Evaluation" },
      { color: "amber" as const, label: "Batch" },
      { color: "purple" as const, label: "Adversarial" },
    ],
  },
];

const techStack = [
  {
    title: "Frontend",
    icon: Monitor,
    items: ["React 19", "Vite", "TypeScript", "Zustand", "Tailwind CSS v4"],
  },
  {
    title: "Backend",
    icon: Server,
    items: ["FastAPI", "async SQLAlchemy", "asyncpg", "Python"],
  },
  {
    title: "Database",
    icon: Database,
    items: ["PostgreSQL 16", "JSONB columns", "Docker Compose"],
  },
];

interface TechStackSection {
  title: string;
  icon: LucideIcon;
  items: string[];
}

interface TechStackCardProps {
  stack: TechStackSection;
}

function TechStackCard({ stack }: TechStackCardProps) {
  const Icon = stack.icon;

  return (
    <Card className="h-full">
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--accent-text)",
            }}
          >
            <Icon size={16} />
          </span>
          <h3
            className="text-[1.0625rem] font-bold tracking-tight"
            style={{ color: "var(--text)" }}
          >
            {stack.title}
          </h3>
        </div>
        <ul
          className="list-disc list-inside text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          {stack.items.map((item) => (
            <li key={item} className="py-0.5">
              {item}
            </li>
          ))}
        </ul>
        <a
          href="#sbom"
          className="mt-auto inline-flex items-center gap-1.5 pt-2 text-xs font-semibold"
          style={{ color: "var(--accent-text)" }}
        >
          View related inventory in SBOM
          <ArrowRight size={14} />
        </a>
      </div>
    </Card>
  );
}

export default function Overview() {
  const { contentRef } = usePageExport();

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="Overview"
    >
      <PageHeader pageTitle="Overview" contentRef={contentRef} />

      {/* Hero */}
      <div
        className="relative mb-6 overflow-hidden rounded-2xl px-6 py-6 text-center"
        style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6, #a78bfa)",
          color: "#ffffff",
        }}
      >
        <div
          className="absolute -top-1/2 -left-1/2 w-[150%] h-[150%] pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.05) 0%, transparent 60%)",
          }}
        />
        <h1 className="text-2xl font-extrabold tracking-tight mb-2 relative">
          AI Evals Platform
        </h1>
        <p className="text-sm opacity-90 max-w-[480px] mx-auto relative">
          An interactive guide to understanding how the platform evaluates AI
          systems across Voice RX and Kaira Bot workspaces.
        </p>
      </div>

      {/* Three Workspaces */}
      <h2
        className="text-2xl font-bold mt-2 mb-5 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        Two Workspaces
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {workspaces.map((ws) => (
          <Card key={ws.title}>
            <div className="flex flex-col gap-3">
              <div
                className="w-12 h-12 rounded-xl inline-flex items-center justify-center mb-1"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <img
                  src={ws.iconSrc}
                  alt={ws.iconAlt}
                  className="w-8 h-8 object-contain"
                  loading="lazy"
                />
              </div>
              <h3
                className="text-[1.0625rem] font-bold tracking-tight"
                style={{ color: "var(--text)" }}
              >
                {ws.title}
              </h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {ws.description}
              </p>
              <div className="flex flex-wrap gap-2 mt-1">
                {ws.badges.map((b) => (
                  <Badge key={b.label} color={b.color}>
                    {b.label}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Technology Stack */}
      <h2
        className="text-2xl font-bold mb-5 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        Technology Stack
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
        Need exact package versions and transitive dependencies?{" "}
        <a
          href="#sbom"
          className="font-semibold"
          style={{ color: "var(--accent-text)" }}
        >
          Jump to SBOM
        </a>
        .
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {techStack.map((stack) => (
          <TechStackCard key={stack.title} stack={stack} />
        ))}
      </div>

      {/* Architecture Overview */}
      <h2
        className="text-2xl font-bold mb-5 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        Architecture Overview
      </h2>
      <MermaidDiagram chart={archDiagram} />
    </div>
  );
}
