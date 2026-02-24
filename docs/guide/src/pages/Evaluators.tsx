import { useState } from "react";
import {
  Card,
  Badge,
  CodeBlock,
  Accordion,
  FilterPills,
  PageHeader,
  InfoBox,
} from "@/components";
import { usePageExport } from "@/hooks/usePageExport";
import {
  evaluatorGroups,
  type SeedEvaluator,
  type EvaluatorSchemaField,
} from "@/data/evaluators";

const filterOptions = evaluatorGroups.map((g) => ({
  id: g.groupId,
  label: g.groupLabel,
}));

const typeBadgeColor: Record<string, "blue" | "green" | "purple" | "amber" | "red"> = {
  number: "blue",
  text: "purple",
  boolean: "green",
  array: "amber",
  enum: "red",
  object: "amber",
};

function SchemaFieldRow({ field }: { field: EvaluatorSchemaField }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <td className="px-3 py-2">
        <code
          className="text-xs font-mono"
          style={{ color: "var(--accent-text)" }}
        >
          {field.key}
        </code>
      </td>
      <td className="px-3 py-2">
        <Badge color={typeBadgeColor[field.type] ?? "blue"}>{field.type}</Badge>
      </td>
      <td
        className="px-3 py-2 text-xs"
        style={{ color: "var(--text-secondary)" }}
      >
        {field.description}
      </td>
      <td className="px-3 py-2 text-center">
        {field.isMainMetric && (
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: "var(--accent)" }}
            title="Main metric"
          />
        )}
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {field.displayMode === "header" && (
          <Badge color="green">header</Badge>
        )}
        {field.displayMode === "card" && <Badge color="blue">card</Badge>}
        {field.displayMode === "hidden" && <Badge color="purple">hidden</Badge>}
      </td>
      <td className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {field.thresholds && (
          <span>
            <span style={{ color: "var(--success)" }}>
              {"\u2265"}
              {field.thresholds.green}
            </span>
            {field.thresholds.yellow != null && (
              <>
                {" / "}
                <span style={{ color: "var(--warning)" }}>
                  {"\u2265"}
                  {field.thresholds.yellow}
                </span>
              </>
            )}
          </span>
        )}
        {field.enumValues && (
          <span>{field.enumValues.join(" | ")}</span>
        )}
      </td>
    </tr>
  );
}

function SchemaTable({ fields }: { fields: EvaluatorSchemaField[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr
            style={{
              borderBottom: "2px solid var(--border)",
              background: "var(--bg-secondary)",
            }}
          >
            <th
              className="px-3 py-2 text-left text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Field
            </th>
            <th
              className="px-3 py-2 text-left text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Type
            </th>
            <th
              className="px-3 py-2 text-left text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Description
            </th>
            <th
              className="px-3 py-2 text-center text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
              title="Is main metric"
            >
              KPI
            </th>
            <th
              className="px-3 py-2 text-left text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Display
            </th>
            <th
              className="px-3 py-2 text-left text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Thresholds
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <SchemaFieldRow key={f.key} field={f} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function extractVariables(prompt: string): string[] {
  const matches = prompt.match(/\{\{[\w.]+\}\}/g);
  return matches ? [...new Set(matches)] : [];
}

function EvaluatorDetail({ evaluator }: { evaluator: SeedEvaluator }) {
  const vars = extractVariables(evaluator.prompt);
  const mainMetric = evaluator.output_schema.find((f) => f.isMainMetric);

  return (
    <div className="space-y-5">
      {/* Meta row */}
      <div className="flex flex-wrap gap-2 items-center">
        {evaluator.is_global && <Badge color="purple">global</Badge>}
        {evaluator.show_in_header && <Badge color="green">header KPI</Badge>}
        {mainMetric && (
          <Badge color="blue">
            main: {mainMetric.key} ({mainMetric.type})
          </Badge>
        )}
        {vars.map((v) => (
          <span
            key={v}
            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono"
            style={{
              background: "var(--code-bg)",
              color: "var(--accent-text)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {v}
          </span>
        ))}
      </div>

      {/* Prompt */}
      <div>
        <h4
          className="text-xs font-semibold uppercase tracking-wider mb-2"
          style={{ color: "var(--text-muted)" }}
        >
          Prompt Template
        </h4>
        <CodeBlock code={evaluator.prompt} language="markdown" />
      </div>

      {/* Output Schema Table */}
      <div>
        <h4
          className="text-xs font-semibold uppercase tracking-wider mb-2"
          style={{ color: "var(--text-muted)" }}
        >
          Output Schema ({evaluator.output_schema.length} fields)
        </h4>
        <SchemaTable fields={evaluator.output_schema} />
      </div>

      {/* Array sub-schemas */}
      {evaluator.output_schema
        .filter((f) => f.arrayItemSchema)
        .map((f) => (
          <div key={f.key}>
            <h4
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              {f.key} item shape
            </h4>
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                style={{ borderCollapse: "collapse" }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: "2px solid var(--border)",
                      background: "var(--bg-secondary)",
                    }}
                  >
                    <th
                      className="px-3 py-2 text-left text-xs font-semibold"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Property
                    </th>
                    <th
                      className="px-3 py-2 text-left text-xs font-semibold"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Type
                    </th>
                    <th
                      className="px-3 py-2 text-left text-xs font-semibold"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {f.arrayItemSchema!.properties.map((p) => (
                    <tr
                      key={p.key}
                      style={{
                        borderBottom: "1px solid var(--border-subtle)",
                      }}
                    >
                      <td className="px-3 py-2">
                        <code
                          className="text-xs font-mono"
                          style={{ color: "var(--accent-text)" }}
                        >
                          {p.key}
                        </code>
                      </td>
                      <td className="px-3 py-2">
                        <Badge color="blue">{p.type}</Badge>
                      </td>
                      <td
                        className="px-3 py-2 text-xs"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {p.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}

export default function Evaluators() {
  const { contentRef } = usePageExport();
  const [activeGroup, setActiveGroup] = useState(filterOptions[0].id);

  const group = evaluatorGroups.find((g) => g.groupId === activeGroup);

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="Evaluators"
    >
      <PageHeader
        title="Custom Evaluators"
        subtitle="Seeded evaluator definitions that ship with the platform. Each evaluator pairs a prompt template with a structured output schema to produce consistent, measurable LLM judgments."
        pageTitle="Evaluators"
        contentRef={contentRef}
      />

      <InfoBox className="mb-6">
        These evaluators are auto-seeded on backend startup from{" "}
        <code>seed_defaults.py</code>. Voice RX evaluators are created
        per-listing via <code>POST /api/evaluators/seed-defaults</code>. Kaira
        Bot evaluators are global (available to all listings). Each can be forked
        and customised.
      </InfoBox>

      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {evaluatorGroups.map((g) => (
          <Card key={g.groupId} hoverable={false} className="!p-4">
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-1"
              style={{ color: "var(--text-muted)" }}
            >
              {g.groupLabel}
            </div>
            <div
              className="text-2xl font-bold"
              style={{ color: "var(--accent-text)" }}
            >
              {g.evaluators.length}
            </div>
            <div
              className="text-xs mt-1"
              style={{ color: "var(--text-secondary)" }}
            >
              {g.appId === "kaira-bot" ? "global" : "per-listing"} evaluators
            </div>
          </Card>
        ))}
      </div>

      {/* Filter pills */}
      <FilterPills
        options={filterOptions}
        active={activeGroup}
        onChange={setActiveGroup}
        className="mb-6"
      />

      {/* Evaluator accordions */}
      {group && (
        <div className="space-y-1">
          {group.evaluators.map((ev, idx) => {
            const mainMetric = ev.output_schema.find((f) => f.isMainMetric);
            const subtitle = mainMetric
              ? `${mainMetric.key} (${mainMetric.type})`
              : `${ev.output_schema.length} fields`;

            return (
              <Accordion
                key={ev.name}
                title={`${ev.name}  \u2014  ${subtitle}`}
                defaultOpen={idx === 0}
              >
                <EvaluatorDetail evaluator={ev} />
              </Accordion>
            );
          })}
        </div>
      )}

      {/* Schema field reference */}
      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Output Schema Field Reference
      </h2>
      <Card hoverable={false}>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          Every evaluator defines an{" "}
          <code>output_schema: EvaluatorOutputField[]</code> that controls how
          the LLM response is structured and how results render in the UI.
        </p>
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "2px solid var(--border)",
                  background: "var(--bg-secondary)",
                }}
              >
                <th
                  className="px-3 py-2 text-left text-xs font-semibold"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Property
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-semibold"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Type
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-semibold"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["key", "string", "Field name in the evaluation JSON output"],
                [
                  "type",
                  "string",
                  'Data type: "number", "text", "boolean", "array", "enum", "object"',
                ],
                ["description", "string", "Human-readable field purpose"],
                [
                  "displayMode",
                  "string",
                  '"header" (prominent KPI), "card" (secondary), "hidden" (reasoning)',
                ],
                [
                  "isMainMetric",
                  "boolean",
                  "Marks the primary KPI shown in listing tables and run headers",
                ],
                [
                  "thresholds",
                  "object",
                  '{ green: N, yellow: N } — colour-codes the metric (green \u2265 N, yellow \u2265 N, else red)',
                ],
                [
                  "role",
                  "string",
                  '"reasoning" — marks the field as a free-text explanation (hidden by default)',
                ],
                [
                  "enumValues",
                  "string[]",
                  "Allowed values for enum-type fields",
                ],
                [
                  "arrayItemSchema",
                  "object",
                  "Schema for array items: { itemType, properties[] }",
                ],
              ].map(([prop, type, desc]) => (
                <tr
                  key={prop}
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <td className="px-3 py-2">
                    <code
                      className="text-xs font-mono"
                      style={{ color: "var(--accent-text)" }}
                    >
                      {prop}
                    </code>
                  </td>
                  <td className="px-3 py-2">
                    <Badge color="blue">{type}</Badge>
                  </td>
                  <td
                    className="px-3 py-2 text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {desc}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
