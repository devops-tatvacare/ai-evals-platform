import {
  TrendingUp,
  AlertTriangle,
  Target,
  BarChart3,
  Layers,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card, InfoBox, PageHeader } from "@/components";
import { usePageExport } from "@/hooks/usePageExport";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

interface QuestionCard {
  icon: LucideIcon;
  question: string;
  answer: string;
  feature: string;
  accentVar: string;
}

const threeQuestions: QuestionCard[] = [
  {
    icon: AlertTriangle,
    question: "What keeps breaking?",
    answer:
      "Recurring issues table, sorted by frequency across runs. If the same problem shows up in 7 of your last 12 runs, it's not a fluke — it's a pattern that needs fixing.",
    feature: "Issues & Recommendations tab",
    accentVar: "var(--error)",
  },
  {
    icon: TrendingUp,
    question: "Are we getting better?",
    answer:
      "Health trend line plotted over time. Ship a prompt update and watch whether scores climb or dip across subsequent runs — no spreadsheet required.",
    feature: "Health & Trends tab",
    accentVar: "var(--success)",
  },
  {
    icon: Target,
    question: "Where should we invest?",
    answer:
      "Priority-grouped recommendations (P0/P1/P2) with projected impact per action. Tells your team what to fix next, ranked by severity and recurrence.",
    feature: "Recommendations section",
    accentVar: "var(--warning)",
  },
];

interface Differentiator {
  icon: LucideIcon;
  title: string;
  description: string;
}

const differentiators: Differentiator[] = [
  {
    icon: Layers,
    title: "Automatic synthesis",
    description:
      "Most eval platforms show per-run results and leave you to do the cross-run synthesis in your head (or a spreadsheet). This does that synthesis automatically — deduplicating issues, tracking frequency, and ranking by severity.",
  },
  {
    icon: BarChart3,
    title: "Rule compliance heatmaps",
    description:
      "See which rules are chronically failing across runs. If a rule passes at 40% over 10 runs, that's a clear signal the prompt or schema needs work — not something you'd easily spot from individual reports.",
  },
  {
    icon: Zap,
    title: "Zero-config architecture",
    description:
      "Batch-compute-on-demand from cached single-run reports. No complex incremental pipelines, no external dependencies. Two-level cache (single-run + cross-run) in the same table — simple and debuggable. Staleness detection via timestamp comparison.",
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ForWhatItsWorth() {
  const { contentRef } = usePageExport();

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="For What It's Worth?"
    >
      <PageHeader pageTitle="For What It's Worth?" contentRef={contentRef} />

      {/* Hero — subdued, conversational */}
      <div
        className="relative mb-8 overflow-hidden rounded-2xl px-6 py-6"
        style={{
          background:
            "linear-gradient(135deg, var(--accent-surface), var(--bg-secondary))",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <h1
          className="text-xl font-bold tracking-tight mb-2"
          style={{ color: "var(--text)" }}
        >
          Cross-Run Analytics — what it is, and why it matters
        </h1>
        <p
          className="text-sm leading-relaxed max-w-[640px]"
          style={{ color: "var(--text-secondary)" }}
        >
          If you run evaluations more than once (and you should), you'll
          eventually ask: <em>are things improving, or am I chasing the same
          bugs?</em> Cross-run analytics is the operational layer that answers
          that question without a spreadsheet.
        </p>
      </div>

      {/* What it's NOT */}
      <h2
        className="text-2xl font-bold mb-4 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        What it's not
      </h2>

      <InfoBox>
        This isn't "analytics" in the Datadog/Grafana sense. There's no
        statistical rigor, no drill-down dashboards, no anomaly detection. It's
        intentionally simpler than that — designed for team leads and PMs who
        need a quick read on eval health, not data scientists building models.
      </InfoBox>

      {/* Three questions */}
      <h2
        className="text-2xl font-bold mt-10 mb-5 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        Three questions it answers
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {threeQuestions.map((q) => (
          <Card key={q.question} hoverable>
            <div className="flex flex-col gap-3 h-full">
              <div
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  background: "var(--bg-secondary)",
                  color: q.accentVar,
                }}
              >
                <q.icon size={20} />
              </div>
              <h3
                className="text-base font-bold tracking-tight"
                style={{ color: "var(--text)" }}
              >
                "{q.question}"
              </h3>
              <p
                className="text-sm leading-relaxed flex-1"
                style={{ color: "var(--text-secondary)" }}
              >
                {q.answer}
              </p>
              <span
                className="inline-block mt-auto text-xs font-semibold px-2 py-1 rounded-md"
                style={{
                  background: "var(--accent-surface)",
                  color: "var(--accent-text)",
                }}
              >
                {q.feature}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Who it's for */}
      <h2
        className="text-2xl font-bold mb-4 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        Who it's for
      </h2>

      <div
        className="rounded-xl px-5 py-4 mb-10"
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <p
          className="text-sm leading-relaxed mb-3"
          style={{ color: "var(--text-secondary)" }}
        >
          The buyer persona is a <strong style={{ color: "var(--text)" }}>team lead or PM</strong> who
          runs eval suites regularly and needs to:
        </p>
        <ul
          className="list-disc list-inside space-y-1.5 text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          <li>Report progress to stakeholders ("health scores up 12% over 8 runs")</li>
          <li>Prioritize engineering work ("these 3 issues recur every run")</li>
          <li>Validate fixes ("the prompt change eliminated the top P0 issue")</li>
          <li>Hold coverage accountability ("only 12 of 47 runs have AI narrative")</li>
        </ul>
        <p
          className="text-sm leading-relaxed mt-3"
          style={{ color: "var(--text-muted)" }}
        >
          They want a dashboard that tells them what to fix next — not a query
          builder that lets them slice data 50 ways.
        </p>
      </div>

      {/* Why it works */}
      <h2
        className="text-2xl font-bold mb-5 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        Why it works
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {differentiators.map((d) => (
          <Card key={d.title}>
            <div className="flex flex-col gap-3">
              <div
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
                style={{
                  background: "var(--bg-secondary)",
                  color: "var(--accent-text)",
                }}
              >
                <d.icon size={16} />
              </div>
              <h3
                className="text-[1.0625rem] font-bold tracking-tight"
                style={{ color: "var(--text)" }}
              >
                {d.title}
              </h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {d.description}
              </p>
            </div>
          </Card>
        ))}
      </div>

      {/* Honest limitations */}
      <h2
        className="text-2xl font-bold mb-4 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        Honest limitations
      </h2>

      <div
        className="rounded-xl overflow-hidden mb-10"
        style={{ border: "1px solid var(--border-subtle)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--bg-secondary)" }}>
              <th
                className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Gap
              </th>
              <th
                className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                What that means
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              [
                "No statistical depth",
                "Arithmetic means and counts. No confidence intervals, no significance testing.",
              ],
              [
                "No root-cause linking",
                "Issues say 'Response Accuracy failed in 7 runs' but don't point to which prompt or model caused it.",
              ],
              [
                "No trend intelligence",
                "Raw data points, not slope detection. You see the chart — the 'declining at X%/week' insight is on you.",
              ],
              [
                "Naive deduplication",
                "80-char prefix matching. Similar-but-differently-worded issues may fragment instead of merging.",
              ],
            ].map(([gap, meaning]) => (
              <tr
                key={gap}
                className="border-t"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <td
                  className="px-4 py-2.5 font-medium whitespace-nowrap"
                  style={{ color: "var(--text)" }}
                >
                  {gap}
                </td>
                <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  {meaning}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom line */}
      <h2
        className="text-2xl font-bold mb-4 flex items-center gap-2"
        style={{ color: "var(--text)" }}
      >
        Bottom line
      </h2>

      <div
        className="rounded-xl px-5 py-4"
        style={{
          background:
            "linear-gradient(135deg, var(--accent-surface), var(--bg-secondary))",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <p
          className="text-sm leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          Cross-run analytics is a solid v1 of{" "}
          <strong style={{ color: "var(--text)" }}>eval trend monitoring</strong>.
          Sell it as operational visibility for teams running repeated evaluations.
          The core value is the recurring issues table and the health trend
          chart — they answer real questions that individual run reports can't.
          The AI summary is a nice-to-have, not the headline.
        </p>
      </div>
    </div>
  );
}
