import type { ReactNode } from "react";
import { Mic, MessageSquare } from "lucide-react";
import {
  StepperFlow,
  Accordion,
  MermaidDiagram,
  InfoBox,
  PageHeader,
} from "@/components";
import { usePageExport } from "@/hooks/usePageExport";
import { workflowThemes, type WorkflowTheme } from "@/data/workflowThemes";

function getThemeSurfaceStyle(theme: WorkflowTheme) {
  return {
    background: `var(${theme.surfaceVar})`,
    border: `1px solid var(${theme.borderVar})`,
  };
}

interface WorkflowCalloutProps {
  theme: WorkflowTheme;
  label: string;
  description: string;
}

function WorkflowCallout({ theme, label, description }: WorkflowCalloutProps) {
  return (
    <div
      className="mb-4 rounded-lg px-4 py-3"
      style={getThemeSurfaceStyle(theme)}
    >
      <p
        className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: `var(${theme.accentVar})` }}
      >
        {label}
      </p>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {description}
      </p>
    </div>
  );
}

interface WorkflowPanelProps {
  theme: WorkflowTheme;
  title: string;
  children: ReactNode;
}

function WorkflowPanel({ theme, title, children }: WorkflowPanelProps) {
  return (
    <div className="rounded-lg p-3" style={getThemeSurfaceStyle(theme)}>
      <h5
        className="mb-2 text-sm font-semibold"
        style={{ color: `var(${theme.accentVar})` }}
      >
        {title}
      </h5>
      {children}
    </div>
  );
}

const universalSteps = [
  {
    title: "Bring Assets",
    description: "Upload audio, transcripts, CSVs, or connect to APIs.",
  },
  {
    title: "Review Setup",
    description: "Configure prompts, schemas, select models.",
  },
  {
    title: "Run Evaluators",
    description: "Execute standalone custom evaluators.",
  },
  {
    title: "Run Full Evals",
    description: "Launch complete evaluation pipelines.",
  },
];

const voiceRxDiagram = `sequenceDiagram
    participant FE as Frontend
    participant BE as FastAPI
    participant DB as PostgreSQL
    participant LLM as LLM Provider

    FE->>BE: POST /api/jobs (evaluate-voice-rx)
    BE->>DB: Create Job + EvalRun
    BE-->>FE: job_id

    Note over BE,LLM: Call 1: Transcription
    BE->>DB: Load listing + audio
    BE->>LLM: Audio + transcription prompt + schema
    LLM-->>BE: AI transcript (JSON)

    Note over BE,LLM: Call 2: Critique
    BE->>LLM: Audio + original + AI transcript + eval prompt
    LLM-->>BE: Per-segment critique (JSON)

    BE->>DB: Save EvalRun result
    FE->>BE: Poll job progress
    BE-->>FE: Status + result`;

const kairaBotDiagram = `sequenceDiagram
    participant FE as Kaira Bot UI
    participant KAPI as Kaira API
    participant BE as FastAPI Eval Backend
    participant DB as PostgreSQL
    participant LLM as LLM Provider

    FE->>KAPI: Stream conversation turns (/chat/stream)
    KAPI-->>FE: Bot response + session identifiers
    FE->>BE: POST /api/jobs (evaluate-custom)
    BE->>DB: Load ChatSession + evaluator definition
    BE->>LLM: Prompt(chat transcript) + output schema
    LLM-->>BE: Structured evaluation JSON
    BE->>DB: Save EvalRun + parsed scores
    BE-->>FE: Job status + final result`;

const batchDiagram = `flowchart LR
    CSV[CSV Upload] --> Validate[Validate + normalize rows]
    Validate --> Job[evaluate-batch job]
    Job --> Loader[DataLoader groups by thread]
    Loader --> Loop[Per-thread evaluation loop]
    Loop --> Builtins[Intent / Correctness / Efficiency]
    Loop --> Custom[Custom evaluators]
    Builtins --> Save[Persist ThreadEvaluation rows]
    Custom --> Save
    Save --> Report[Batch summary metrics]`;

const adversarialDiagram = `flowchart LR
    Config[API + test configuration] --> Job[evaluate-adversarial job]
    Job --> Cases[Phase 1: generate adversarial cases]
    Cases --> Sim[Phase 2: ConversationAgent executes live turns]
    Sim --> Judge[Phase 3: judge model evaluates transcript]
    Judge --> Save[Persist AdversarialEvaluation rows]
    Save --> Insights[Safety trends + failed-case replay]`;

export default function Workflows() {
  const { contentRef } = usePageExport();

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="Workflows"
    >
      <PageHeader
        title="Universal Evaluation Pattern"
        subtitle="Every workspace follows the same four-step flow: bring assets, configure setup, run evaluators, then review structured output."
        pageTitle="Workflows"
        contentRef={contentRef}
      />

      <StepperFlow steps={universalSteps} />

      <h2
        className="text-2xl font-bold mt-10 mb-4"
        style={{ color: "var(--text)" }}
      >
        Per-Workspace Workflows
      </h2>

      {/* Voice RX */}
      <Accordion title="Voice RX Workflow" icon={<Mic size={18} />}>
        <WorkflowCallout
          theme={workflowThemes.voiceRx}
          label="Voice RX"
          description="Medical speech quality scoring with a deterministic two-call evaluation pipeline."
        />

        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <WorkflowPanel theme={workflowThemes.voiceRx} title="Assets">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Upload audio files (.mp3/.wav) and original transcript JSON with
              time-aligned segments. Alternatively, import from the VoiceRX API
              which provides audio + structured output (rx object) together.
            </p>
          </WorkflowPanel>
          <WorkflowPanel theme={workflowThemes.voiceRx} title="Setup">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Configure three types of prompts &mdash;{" "}
              <strong>transcription prompt</strong> (uses{" "}
              <code>{"{{audio}}"}</code>, <code>{"{{time_windows}}"}</code>,{" "}
              <code>{"{{segment_count}}"}</code>),{" "}
              <strong>evaluation prompt</strong> (uses{" "}
              <code>{"{{transcript}}"}</code>,{" "}
              <code>{"{{llm_transcript}}"}</code>,{" "}
              <code>{"{{original_script}}"}</code>), and optional{" "}
              <strong>normalization</strong>. Select per-step models. Define
              JSON schemas for structured LLM output enforcement.
            </p>
          </WorkflowPanel>
        </div>

        <h4
          className="font-semibold mb-1"
          style={{ color: `var(${workflowThemes.voiceRx.accentVar})` }}
        >
          Standalone Evaluators
        </h4>
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Create custom evaluators using <code>InlineSchemaBuilder</code>{" "}
          (visual field builder). Each evaluator has a prompt template + output
          schema. Submitted as <code>&apos;evaluate-custom&apos;</code> job
          &rarr; <code>custom_evaluator_runner.py</code>.
        </p>

        <h4
          className="font-semibold mb-1"
          style={{ color: `var(${workflowThemes.voiceRx.accentVar})` }}
        >
          Full Evaluation Pipeline
        </h4>
        <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
          4-tab wizard (
          <strong>
            Settings &rarr; Transcription &rarr; Evaluation &rarr; Review
          </strong>
          ). Submits <code>&apos;evaluate-voice-rx&apos;</code> job. Two-call
          pipeline:
        </p>
        <ul
          className="list-disc list-inside text-sm mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          <li>
            <strong>Call 1 (Transcription):</strong> Audio + prompt &rarr; LLM
            &rarr; AI transcript
          </li>
          <li>
            <strong>Call 2 (Critique):</strong> Audio + original + AI transcript
            &rarr; LLM &rarr; per-segment scores
          </li>
        </ul>

        <MermaidDiagram chart={voiceRxDiagram} />
      </Accordion>

      {/* Kaira Bot */}
      <Accordion title="Kaira Bot Workflow" icon={<MessageSquare size={18} />}>
        <WorkflowCallout
          theme={workflowThemes.kairaBot}
          label="Kaira Bot"
          description="Real-time conversation QA with schema-constrained evaluator outputs for fast reviewer feedback."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <WorkflowPanel theme={workflowThemes.kairaBot} title="Assets">
            <ul
              className="list-disc list-inside text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              <li>
                Live chat transcript from SSE endpoint <code>/chat/stream</code>
              </li>
              <li>
                Session continuity via <code>thread_id</code> and{" "}
                <code>server_session_id</code>
              </li>
              <li>
                Transcript context injected through{" "}
                <code>{"{{chat_transcript}}"}</code>
              </li>
            </ul>
          </WorkflowPanel>
          <WorkflowPanel theme={workflowThemes.kairaBot} title="Setup">
            <ul
              className="list-disc list-inside text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              <li>
                Build evaluator prompts with <code>InlineSchemaBuilder</code>
              </li>
              <li>
                Define output fields and JSON constraints for stable parsing
              </li>
              <li>Select provider/model from shared LLM settings</li>
            </ul>
          </WorkflowPanel>
        </div>

        <h4
          className="font-semibold mb-2"
          style={{ color: `var(${workflowThemes.kairaBot.accentVar})` }}
        >
          Execution Path
        </h4>
        <ul
          className="list-disc list-inside text-sm mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          <li>
            <code>useEvaluatorRunner</code> submits an{" "}
            <code>&apos;evaluate-custom&apos;</code> job with session and
            evaluator IDs
          </li>
          <li>
            <code>custom_evaluator_runner.py</code> loads messages, resolves
            variables, and compiles evaluator schema
          </li>
          <li>
            LLM returns structured output, and backend stores{" "}
            <code>EvalRun</code> plus extracted scores for reporting
          </li>
        </ul>

        <MermaidDiagram chart={kairaBotDiagram} />

        <InfoBox className="mt-6 mb-4">
          Kaira Bot also supports batch and adversarial evaluation workflows.
          Both run as background jobs and persist granular records for trend
          analysis and replay.
        </InfoBox>

        <h4
          className="font-semibold mb-2"
          style={{ color: `var(${workflowThemes.kairaBot.accentVar})` }}
        >
          Batch Evaluation
        </h4>
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Score historical thread datasets at scale and compare evaluator
          performance across intents and answer quality.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <WorkflowPanel theme={workflowThemes.kairaBot} title="Assets">
            <ul
              className="list-disc list-inside text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              <li>
                CSV dataset with fields such as <code>thread_id</code>,{" "}
                <code>query_text</code>, <code>intent</code>, and{" "}
                <code>final_response_message</code>
              </li>
              <li>Optional custom evaluator definitions</li>
            </ul>
          </WorkflowPanel>
          <WorkflowPanel theme={workflowThemes.kairaBot} title="Setup">
            <ul
              className="list-disc list-inside text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              <li>
                6-step wizard:{" "}
                <strong>
                  Info &rarr; CSV Upload &rarr; Scope &rarr; Evaluators &rarr;
                  LLM Config &rarr; Review
                </strong>
              </li>
              <li>
                Combine built-ins (<code>IntentEvaluator</code>,{" "}
                <code>CorrectnessEvaluator</code>,{" "}
                <code>EfficiencyEvaluator</code>) with custom evaluators
              </li>
            </ul>
          </WorkflowPanel>
        </div>

        <ul
          className="list-disc list-inside text-sm mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          <li>
            <code>&apos;evaluate-batch&apos;</code> triggers{" "}
            <code>batch_runner.py</code>, which loads rows via DataLoader
          </li>
          <li>
            Each thread is evaluated and persisted as{" "}
            <code>ThreadEvaluation</code>
          </li>
          <li>
            Run outputs include aggregate accuracy and verdict distribution
            summaries
          </li>
        </ul>

        <MermaidDiagram chart={batchDiagram} />

        <h4
          className="font-semibold mt-6 mb-2"
          style={{ color: `var(${workflowThemes.kairaBot.accentVar})` }}
        >
          Adversarial Testing
        </h4>
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Probe safety boundaries by running generated adversarial conversations
          against the live Kaira API.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <WorkflowPanel theme={workflowThemes.kairaBot} title="Assets">
            <ul
              className="list-disc list-inside text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              <li>
                Live API endpoint + auth token for the target Kaira assistant
              </li>
              <li>Judge model configuration for compliance scoring</li>
            </ul>
          </WorkflowPanel>
          <WorkflowPanel theme={workflowThemes.kairaBot} title="Setup">
            <ul
              className="list-disc list-inside text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              <li>
                5-step wizard:{" "}
                <strong>
                  Info &rarr; API Config &rarr; Test Config &rarr; LLM Config
                  &rarr; Review
                </strong>
              </li>
              <li>
                Tune test count, turn delay, and case delay to balance realism
                and runtime
              </li>
            </ul>
          </WorkflowPanel>
        </div>

        <ul
          className="list-disc list-inside text-sm mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          <li>
            <code>&apos;evaluate-adversarial&apos;</code> runs via{" "}
            <code>adversarial_runner.py</code>
          </li>
          <li>
            <strong>Phase 1:</strong> LLM generates diverse attack-style test
            cases
          </li>
          <li>
            <strong>Phase 2:</strong> <code>ConversationAgent</code> runs
            multi-turn sessions against live API
          </li>
          <li>
            <strong>Phase 3:</strong> Judge LLM scores each transcript for
            safety and policy compliance
          </li>
          <li>
            Results persist as <code>AdversarialEvaluation</code> rows with{" "}
            <code>verdict</code> and <code>goal_achieved</code>
          </li>
        </ul>

        <MermaidDiagram chart={adversarialDiagram} />
      </Accordion>
    </div>
  );
}
