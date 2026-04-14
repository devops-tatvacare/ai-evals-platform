# Dynamic Chart Renderer — Design Spec

**Date:** 2026-04-14
**Status:** Approved
**Goal:** Replace the 5 hardcoded chart types with a data-shape-driven, LLM-assisted charting system that supports any Recharts chart type, scales across all apps, and renders cleanly inside the chat widget.

---

## Problem

The Sherlock chat agent supports only 5 chart types (`bar`, `horizontal_bar`, `line`, `pie`, `stacked_bar`) hardcoded across three layers: the backend tool schema enum, the frontend TypeScript union, and the frontend renderer switch-case. Adding a chart type requires changes in all three places plus prompt engineering to teach the LLM when to use it. Inside-sales needs funnels, other apps may need radar/scatter/treemap — the current design doesn't scale.

## Approach: Data Shape Classifier

A deterministic Python classifier inspects the analyze result's column types, cardinality, and row count, then produces an ordered list of eligible chart types. The LLM picks from this short list and maps columns to axes. No prompt essays about chart selection theory — the classifier handles visual grammar, the LLM handles intent and language.

### Why not fully LLM-driven?

More chart types = more prompt instructions = more wrong picks. The LLM would need to be a chart selection expert AND a data analyst. Prompt-based chart guidance mudddles at scale. Deterministic classification doesn't.

---

## 1. Chart Type Registry

A single Python dict defines every supported chart type and its data shape requirements:

```python
CHART_TYPE_REGISTRY = {
    'bar':            { 'min_categorical': 1, 'min_numeric': 1, 'max_series': 1 },
    'horizontal_bar': { 'min_categorical': 1, 'min_numeric': 1, 'max_series': 1, 'prefer_when': 'high_cardinality' },
    'stacked_bar':    { 'min_categorical': 1, 'min_numeric': 2 },
    'grouped_bar':    { 'min_categorical': 1, 'min_numeric': 2 },
    'line':           { 'min_ordinal': 1, 'min_numeric': 1 },
    'area':           { 'min_ordinal': 1, 'min_numeric': 1 },
    'stacked_area':   { 'min_ordinal': 1, 'min_numeric': 2 },
    'pie':            { 'min_categorical': 1, 'min_numeric': 1, 'max_rows': 12 },
    'donut':          { 'min_categorical': 1, 'min_numeric': 1, 'max_rows': 12 },
    'scatter':        { 'min_numeric': 2 },
    'radar':          { 'min_categorical': 1, 'min_numeric': 1, 'min_rows': 3, 'max_rows': 10 },
    'funnel':         { 'min_categorical': 1, 'min_numeric': 1, 'requires': 'ordered_categorical' },
    'treemap':        { 'min_categorical': 1, 'min_numeric': 1, 'min_rows': 3 },
    'radial_bar':     { 'min_categorical': 1, 'min_numeric': 1, 'max_rows': 8 },
    'composed':       { 'min_ordinal': 1, 'min_numeric': 2 },
}
```

Adding a new chart type = one entry here + one component mapping in the frontend renderer. No prompt changes, no backend logic changes.

## 2. Column Classification

After `analyze` returns data, the classifier inspects each column:

| Column trait | Detection |
|---|---|
| **numeric** | All non-null values parse as int/float |
| **temporal** | Column name contains `date`, `time`, `month`, `week`, `year`, or values parse as dates |
| **ordered_categorical** | Dimension has `ordering` in semantic model metadata |
| **categorical** | Everything else (strings, IDs, labels) |

Additionally computes:
- **cardinality** — distinct value count per column
- **row_count** — total rows in result

Temporal columns satisfy both `min_ordinal` and `min_categorical` requirements (they're ordered and can be grouped). `ordered_categorical` columns also satisfy `min_ordinal` — ordered categories are ordinal by definition.

## 3. Eligibility Logic

For each registry entry:
1. Does the data have enough columns of each required type (`min_categorical`, `min_numeric`, `min_ordinal`)?
2. Row count within `min_rows`/`max_rows` if specified?
3. `requires` constraint met (e.g. `ordered_categorical` column present)?
4. `prefer_when` conditions noted for ranking (e.g. `high_cardinality` bumps `horizontal_bar`)

Output: an ordered list of eligible types, best-fit first. Stored in scratchpad alongside the analysis result.

### Ranking heuristics

1. Charts with `requires` constraints that match get top rank (specificity wins — funnel for ordered data)
2. Charts with `prefer_when` conditions that match rank next
3. General-purpose charts (bar, line) rank last as safe defaults
4. Ties broken by registry order

## 4. Backend Flow

### After analyze

`build_analysis_snapshot()` in `scratchpad_state.py` gains two new fields:

```python
snapshot = {
    'question': ...,
    'row_count': ...,
    'columns': ...,
    'column_types': {
        'revenue': 'numeric',
        'agent_name': 'categorical',
        'date': 'temporal',
        'lead_stage': 'ordered_categorical',
    },
    'eligible_charts': ['funnel', 'bar', 'pie', 'radar', 'horizontal_bar'],
    'data': ...,
    'preview_rows': ...,
    'focus': ...,
}
```

The classifier is a pure function in a new file `backend/app/services/chat_engine/chart_classifier.py`. It takes columns + rows + optional semantic model dimension metadata, returns `column_types` and `eligible_charts`. The dimension metadata (including `ordering`) is already loaded per-app in `sql_agent.py` from the semantic model YAML — the classifier receives it as a parameter, not by loading it itself.

### LLM context injection

After analyze, the LLM's next turn sees (injected by `chat_handler.py`):

```
Available chart types for this data: funnel, bar, pie, radar, horizontal_bar. Best fit: funnel.
```

Short, factual, no explanations. The LLM picks from the list.

### render_chart tool schema

Remove the `enum` constraint on `chart_type`. Add optional fields:

```python
{
    "name": "render_chart",
    "inputSchema": {
        "properties": {
            "chart_type": {
                "type": "string",
                "description": "Chart type to render. Pick from the eligible chart types for the current data.",
            },
            "title": { "type": "string" },
            "x_key": { "type": "string" },
            "y_key": { "type": "string" },
            "series_keys": { "type": "array", "items": { "type": "string" } },
            "series": {
                "type": "array",
                "description": "For composed charts: per-series config.",
                "items": {
                    "type": "object",
                    "properties": {
                        "data_key": { "type": "string" },
                        "type": { "type": "string", "enum": ["bar", "line", "area", "scatter"] },
                        "stack_id": { "type": "string" },
                    },
                    "required": ["data_key", "type"],
                },
            },
            "x_label": { "type": "string" },
            "y_label": { "type": "string" },
            "legend_position": {
                "type": "string",
                "enum": ["top", "bottom", "right", "none"],
            },
            "alternatives": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Up to 3 alternative chart types the user can switch to client-side. Only include when the user did not request a specific chart type.",
            },
        },
        "required": ["chart_type", "title", "x_key"],
    },
}
```

### render_chart handler

Validation:
1. `chart_type` must be in `eligible_charts` from scratchpad, OR in `CHART_TYPE_REGISTRY` (fallback for explicit user requests)
2. Column validation unchanged — `x_key`, `y_key`, `series_keys`, `series[].data_key` must exist in analysis columns
3. `alternatives` validated: each must be in the registry

Returns the full spec including new fields.

### Chart SSE emission

No structural change to `chat_handler.py` chart emission. The spec payload is wider (new optional fields), data/sqlQuery/sourceQuestion stay the same.

## 5. Frontend Types

```typescript
interface ChartSpec {
  type: string;                           // was union, now any registered type
  title: string;
  xKey: string;
  yKey?: string;
  seriesKeys: string[];
  series?: SeriesConfig[];                // new: for composed charts
  xLabel: string;
  yLabel: string;
  legendPosition?: 'top' | 'bottom' | 'right' | 'none';  // new
  alternatives?: string[];                // new: suggestion pills
}

interface SeriesConfig {
  dataKey: string;
  type: 'bar' | 'line' | 'area';
  stackId?: string;
}

// ChartData, WidgetMessage unchanged in structure
```

## 6. Frontend Renderer

Replace the switch-case in `ChartRenderer.tsx` with a component lookup map:

```typescript
const CHART_MAP: Record<string, ChartMapping> = {
  bar:           { container: BarChart,      visual: Bar,       cartesian: true },
  horizontal_bar:{ container: BarChart,      visual: Bar,       cartesian: true, layoutVertical: true },
  stacked_bar:   { container: BarChart,      visual: Bar,       cartesian: true, stacked: true },
  grouped_bar:   { container: BarChart,      visual: Bar,       cartesian: true },
  line:          { container: LineChart,      visual: Line,      cartesian: true },
  area:          { container: AreaChart,      visual: Area,      cartesian: true },
  stacked_area:  { container: AreaChart,      visual: Area,      cartesian: true, stacked: true },
  scatter:       { container: ScatterChart,   visual: Scatter,   cartesian: true },
  radar:         { container: RadarChart,     visual: Radar,     polar: true },
  funnel:        { container: FunnelChart,    visual: Funnel },
  treemap:       { container: Treemap },
  radial_bar:    { container: RadialBarChart, visual: RadialBar, polar: true },
  composed:      { container: ComposedChart,  cartesian: true },
  pie:           { container: PieChart,       visual: Pie,       polar: true },
  donut:         { container: PieChart,       visual: Pie,       polar: true, innerRadius: 0.5 },
};
```

Rendering logic:
1. Look up mapping by `spec.type`, fall back to `bar` if unknown
2. If `cartesian` — render `CartesianGrid`, `XAxis`, `YAxis`, `Tooltip`, `Legend`
3. If `polar` — render polar-specific axes/grid
4. If `composed` — iterate `spec.series`, look up visual per series type
5. Otherwise — render container + visual generically
6. Apply sizing, legend position, label formatting from spec

## 7. Sizing Strategy

`ChatChart.tsx` computes height from chart type and data:

| Chart type | Height |
|---|---|
| Cartesian (bar, line, area, grouped_bar, stacked_bar, stacked_area, scatter, composed) | 220px base, +20px if legend shown |
| horizontal_bar | `clamp(dataCount * 28, 200, 400)` |
| pie / donut | 240px |
| radar | 260px |
| funnel | `clamp(dataCount * 36, 180, 360)` |
| treemap | 240px |
| radial_bar | 240px |

### Legend overflow

- `maxItems` = 6 in compact mode. Excess items shown as muted "(+N more)" label.
- Position from `spec.legendPosition`, defaults: `bottom` for cartesian, `right` for pie/donut.
- `overflowY: 'auto'` with `maxHeight` on wrapper.

### Label overflow

- X-axis: auto-rotate to -45deg when item count > 8 in compact mode
- Truncation: 18 chars compact / 40 chars full (unchanged)
- Tooltip always shows full untruncated value

### Data consolidation

- pie/donut: max 8 slices, tail grouped to "Other (N)"
- radar: max 10 axes
- radial_bar: max 8 bars
- treemap: max 20 nodes
- All others: no consolidation

## 8. Chart Type Suggestion UX

When the user is vague ("chart this", "visualize"), the LLM populates `alternatives` with 2-3 other eligible types.

Frontend renders small pill buttons below the chart:

```
[Chart rendered here]
  Try as:  [Horizontal Bar]  [Pie]
```

- Ghost-styled pills (10px font, `--bg-secondary`, `--text-muted`)
- Max 3 alternatives
- Click swaps `spec.type` in local React state — **no backend call**, instant re-render with same data
- Active type gets `--color-brand-primary` border
- Switching to pie triggers consolidation; switching back restores full data
- "Add to library" saves whichever type is currently active

If the user explicitly requested a chart type, no alternatives shown.

## 9. Semantic Model Metadata

The only app-specific input is optional `ordering` on dimensions in semantic model YAMLs:

```yaml
dimensions:
  - name: lead_stage
    type: categorical
    ordering: [new, contacted, qualified, proposal, negotiation, closed_won, closed_lost]
```

This is declarative, not chart-specific. Any app that defines an ordered dimension automatically gets funnel eligibility. Apps without ordered dimensions simply don't see funnel in their eligible list.

The classifier reads this metadata when available. No `ordering` = no `ordered_categorical` classification = funnel not offered. Zero app-specific code paths.

## 10. Backward Compatibility

### Why no migration needed

The new `ChartSpec` is a superset of the old one:
- Old fields (`type`, `xKey`, `yKey`, `seriesKeys`, `xLabel`, `yLabel`) unchanged
- New fields (`series`, `legendPosition`, `alternatives`) all optional with defaults
- Old chart type values still valid — they're in the registry

Persisted chat messages render without changes. Analytics library entries work as-is. No database migration.

### Frontend type widening

`ChartSpec.type` changes from a union literal to `string`. The renderer looks up the type in `CHART_MAP` and falls back to `bar` if unknown. A backend-only deploy that adds a new chart type to the registry works immediately if the Recharts component is already in `CHART_MAP`.

### Scratchpad fallback

Existing scratchpad state without `eligible_charts` (from cached sessions) triggers fallback: handler validates against the global registry instead of the eligible list.

## 11. File Inventory

| File | Change | Effort |
|---|---|---|
| **New:** `backend/app/services/chat_engine/chart_classifier.py` | Registry + classifier function + column type detection | Small (~80 lines) |
| `backend/app/services/report_builder/scratchpad_state.py` | Call classifier in `build_analysis_snapshot`, store `column_types` + `eligible_charts` | Small |
| `backend/app/services/report_builder/tool_definitions.py` | Widen `render_chart` schema: remove enum, add optional fields | Small |
| `backend/app/services/report_builder/tool_handlers.py` | Validate against eligible set, pass through richer spec | Small |
| `backend/app/services/report_builder/chat_handler.py` | Inject eligible types context into LLM turn after analyze | Small |
| `backend/app/services/chat_engine/semantic_models/*.yaml` | Add `ordering` to applicable dimensions | Trivial |
| `src/features/chat-widget/types.ts` | Widen `ChartSpec.type` to string, add optional fields | Trivial |
| `src/features/analytics/components/ChartRenderer.tsx` | Replace switch-case with `CHART_MAP` lookup + generic render | Medium |
| `src/features/chat-widget/ChatChart.tsx` | Suggestion pills, sizing matrix, legend overflow, label rotation | Medium |

No new dependencies. All Recharts chart components already ship with the installed package.

## 12. End-to-End Example

User asks inside-sales Sherlock: **"How are my leads progressing through stages?"**

1. LLM calls `analyze` with question "Count of leads grouped by lead_stage"
2. SQL agent generates and executes query. Returns 6 rows: `lead_stage` (categorical) + `lead_count` (numeric)
3. Classifier runs on result. Detects `lead_stage` has `ordering` in semantic model -> `ordered_categorical`. Computes eligible: `['funnel', 'bar', 'pie', 'radar', 'horizontal_bar']`
4. LLM sees "Available chart types: funnel, bar, pie, radar, horizontal_bar. Best fit: funnel." Calls `render_chart` with `chart_type='funnel'`, `alternatives=['bar', 'pie']`
5. Backend validates, emits chart SSE with spec + data
6. Frontend renders funnel chart. Below it: "Try as: Bar | Pie" pills
7. User clicks "Pie" — instant client-side re-render, no backend call
8. User clicks "Add to library" — saves current type (pie) + full config + SQL
