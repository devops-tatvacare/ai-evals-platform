# Dynamic Chart Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5 hardcoded chart types with a data-shape-driven classifier that determines eligible chart types from analyze results, letting the LLM pick from a short list while the frontend renders any Recharts chart via a generic component lookup map.

**Architecture:** A new `chart_classifier.py` module holds the chart type registry and a pure classifier function. After every `analyze` call, the classifier inspects result columns and row counts, producing `column_types` and `eligible_charts` in the scratchpad. The `render_chart` tool loses its enum constraint; the handler validates against the eligible set. The frontend `ChartRenderer` replaces its switch-case with a declarative `CHART_MAP` that maps type strings to Recharts components. `ChatChart` gains suggestion pills for alternative types (client-side re-render, no backend call).

**Tech Stack:** Python 3.12, Recharts 3.7.0, React 18, TypeScript, Vitest

**Design spec:** `docs/plans/2026-04-14-dynamic-chart-renderer-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/app/services/chat_engine/chart_classifier.py` | Create | Registry, column type detection, eligibility logic |
| `backend/tests/test_chart_classifier_unittest.py` | Create | Unit tests for classifier |
| `backend/app/services/report_builder/scratchpad_state.py` | Modify | Call classifier in `build_analysis_snapshot` |
| `backend/app/services/report_builder/tool_definitions.py` | Modify | Widen `render_chart` schema |
| `backend/app/services/report_builder/tool_handlers.py` | Modify | Validate against eligible set |
| `backend/app/services/chat_engine/prompts/scratchpad.py` | Modify | Render eligible charts in session state |
| `backend/app/services/chat_engine/semantic_models/inside-sales.yaml` | Modify | Add `ordering` to applicable dimensions |
| `backend/tests/test_report_builder_tool_handlers_unittest.py` | Modify | Update render_chart handler tests |
| `src/features/chat-widget/types.ts` | Modify | Widen `ChartSpec.type`, add fields |
| `src/features/analytics/components/ChartRenderer.tsx` | Rewrite | Generic CHART_MAP renderer |
| `src/features/chat-widget/ChatChart.tsx` | Modify | Suggestion pills, sizing matrix, legend fix |

---

### Task 1: Chart Classifier — Registry and Column Detection

**Files:**
- Create: `backend/app/services/chat_engine/chart_classifier.py`
- Create: `backend/tests/test_chart_classifier_unittest.py`

- [ ] **Step 1: Write failing tests for column type classification**

```python
# backend/tests/test_chart_classifier_unittest.py
from __future__ import annotations

import unittest

from app.services.chat_engine.chart_classifier import classify_columns


class ClassifyColumnsTests(unittest.TestCase):

    def test_numeric_column(self):
        rows = [{'revenue': 100}, {'revenue': 200.5}, {'revenue': 0}]
        result = classify_columns(['revenue'], rows)
        self.assertEqual(result['revenue'], 'numeric')

    def test_temporal_column_by_name(self):
        rows = [{'created_date': '2026-01-01'}, {'created_date': '2026-02-01'}]
        result = classify_columns(['created_date'], rows)
        self.assertEqual(result['created_date'], 'temporal')

    def test_temporal_column_by_value(self):
        rows = [{'ts': '2026-01-15T10:00:00'}, {'ts': '2026-02-20T12:00:00'}]
        result = classify_columns(['ts'], rows)
        self.assertEqual(result['ts'], 'temporal')

    def test_categorical_column(self):
        rows = [{'agent': 'Alice'}, {'agent': 'Bob'}]
        result = classify_columns(['agent'], rows)
        self.assertEqual(result['agent'], 'categorical')

    def test_ordered_categorical_from_dimension_metadata(self):
        rows = [{'stage': 'new'}, {'stage': 'closed'}]
        dimensions = [{'name': 'stage', 'ordering': ['new', 'contacted', 'closed']}]
        result = classify_columns(['stage'], rows, dimensions=dimensions)
        self.assertEqual(result['stage'], 'ordered_categorical')

    def test_mixed_columns(self):
        rows = [
            {'agent': 'Alice', 'revenue': 100, 'month': '2026-01'},
            {'agent': 'Bob', 'revenue': 200, 'month': '2026-02'},
        ]
        result = classify_columns(['agent', 'revenue', 'month'], rows)
        self.assertEqual(result['agent'], 'categorical')
        self.assertEqual(result['revenue'], 'numeric')
        self.assertEqual(result['month'], 'temporal')

    def test_empty_rows_all_categorical(self):
        result = classify_columns(['a', 'b'], [])
        self.assertEqual(result['a'], 'categorical')
        self.assertEqual(result['b'], 'categorical')

    def test_null_values_skipped(self):
        rows = [{'count': None}, {'count': 5}, {'count': 10}]
        result = classify_columns(['count'], rows)
        self.assertEqual(result['count'], 'numeric')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_chart_classifier_unittest.py -v`
Expected: FAIL — `ImportError: cannot import name 'classify_columns'`

- [ ] **Step 3: Implement classify_columns**

```python
# backend/app/services/chat_engine/chart_classifier.py
"""Data-shape-driven chart type classification.

The classifier inspects analyze result columns to determine which
Recharts chart types are eligible for the data. No app-specific logic —
only data shape and optional semantic model dimension metadata.
"""
from __future__ import annotations

import re
from typing import Any

# Patterns for detecting temporal columns
_TEMPORAL_NAME_PATTERN = re.compile(
    r'(date|time|month|week|year|quarter|day|period|created|updated)',
    re.IGNORECASE,
)
_ISO_DATE_PATTERN = re.compile(
    r'^\d{4}[-/]\d{2}([-/]\d{2})?([T ]\d{2}:\d{2}(:\d{2})?)?',
)


def _is_numeric_value(value: Any) -> bool:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return True
    if isinstance(value, str):
        try:
            float(value)
            return True
        except (ValueError, TypeError):
            return False
    return False


def _is_temporal_value(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return bool(_ISO_DATE_PATTERN.match(value.strip()))


def classify_columns(
    columns: list[str],
    rows: list[dict[str, Any]],
    *,
    dimensions: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    """Classify each column as numeric, temporal, ordered_categorical, or categorical.

    Args:
        columns: ordered column names from the analyze result.
        rows: data rows (list of dicts).
        dimensions: optional semantic model dimension metadata. Each dict
            may include an ``ordering`` key (list of ordered values) that
            promotes the column to ``ordered_categorical``.

    Returns:
        dict mapping column name → type string.
    """
    ordered_dims: set[str] = set()
    if dimensions:
        for dim in dimensions:
            if isinstance(dim, dict) and dim.get('ordering'):
                ordered_dims.add(str(dim.get('name', '')))

    result: dict[str, str] = {}
    for col in columns:
        # Check ordered categorical first (from semantic model metadata)
        if col in ordered_dims:
            result[col] = 'ordered_categorical'
            continue

        # Sample non-null values
        values = [
            row[col]
            for row in rows
            if isinstance(row, dict) and col in row and row[col] is not None
        ]

        if not values:
            result[col] = 'categorical'
            continue

        # Check numeric
        if all(_is_numeric_value(v) for v in values):
            result[col] = 'numeric'
            continue

        # Check temporal — by column name or by value pattern
        if _TEMPORAL_NAME_PATTERN.search(col):
            result[col] = 'temporal'
            continue
        if all(_is_temporal_value(v) for v in values):
            result[col] = 'temporal'
            continue

        result[col] = 'categorical'

    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_chart_classifier_unittest.py -v`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/chat_engine/chart_classifier.py backend/tests/test_chart_classifier_unittest.py
git commit -m "feat: add chart column type classifier with tests"
```

---

### Task 2: Chart Classifier — Registry and Eligibility Logic

**Files:**
- Modify: `backend/app/services/chat_engine/chart_classifier.py`
- Modify: `backend/tests/test_chart_classifier_unittest.py`

- [ ] **Step 1: Write failing tests for eligibility**

Add to `backend/tests/test_chart_classifier_unittest.py`:

```python
from app.services.chat_engine.chart_classifier import classify_columns, get_eligible_charts


class GetEligibleChartsTests(unittest.TestCase):

    def test_one_categorical_one_numeric(self):
        column_types = {'agent': 'categorical', 'revenue': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=5)
        self.assertIn('bar', eligible)
        self.assertIn('horizontal_bar', eligible)
        self.assertIn('pie', eligible)
        self.assertNotIn('line', eligible)
        self.assertNotIn('scatter', eligible)

    def test_one_temporal_one_numeric(self):
        column_types = {'month': 'temporal', 'revenue': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=12)
        self.assertIn('line', eligible)
        self.assertIn('area', eligible)
        self.assertIn('bar', eligible)
        self.assertNotIn('funnel', eligible)

    def test_ordered_categorical_enables_funnel(self):
        column_types = {'stage': 'ordered_categorical', 'count': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=6)
        self.assertIn('funnel', eligible)
        # Funnel should rank first due to specificity
        self.assertEqual(eligible[0], 'funnel')

    def test_two_numerics_enables_scatter(self):
        column_types = {'revenue': 'numeric', 'calls': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=50)
        self.assertIn('scatter', eligible)

    def test_pie_excluded_for_high_row_count(self):
        column_types = {'agent': 'categorical', 'revenue': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=20)
        self.assertNotIn('pie', eligible)
        self.assertNotIn('donut', eligible)

    def test_radar_excluded_for_high_row_count(self):
        column_types = {'dim': 'categorical', 'val': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=15)
        self.assertNotIn('radar', eligible)

    def test_radar_included_for_low_row_count(self):
        column_types = {'dim': 'categorical', 'val': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=6)
        self.assertIn('radar', eligible)

    def test_multi_numeric_enables_stacked_and_composed(self):
        column_types = {'month': 'temporal', 'rev': 'numeric', 'cost': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=10)
        self.assertIn('stacked_area', eligible)
        self.assertIn('composed', eligible)
        self.assertIn('line', eligible)

    def test_ordered_categorical_satisfies_ordinal(self):
        """ordered_categorical columns should satisfy min_ordinal for line/area."""
        column_types = {'stage': 'ordered_categorical', 'count': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=6)
        self.assertIn('line', eligible)
        self.assertIn('area', eligible)

    def test_empty_columns_returns_empty(self):
        eligible = get_eligible_charts({}, row_count=0)
        self.assertEqual(eligible, [])

    def test_horizontal_bar_preferred_for_high_cardinality(self):
        column_types = {'city': 'categorical', 'sales': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=15)
        bar_idx = eligible.index('bar')
        hbar_idx = eligible.index('horizontal_bar')
        self.assertLess(hbar_idx, bar_idx)

    def test_horizontal_bar_not_preferred_for_low_cardinality(self):
        column_types = {'status': 'categorical', 'count': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=3)
        bar_idx = eligible.index('bar')
        hbar_idx = eligible.index('horizontal_bar')
        self.assertLess(bar_idx, hbar_idx)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_chart_classifier_unittest.py::GetEligibleChartsTests -v`
Expected: FAIL — `ImportError: cannot import name 'get_eligible_charts'`

- [ ] **Step 3: Implement the registry and get_eligible_charts**

Add to `backend/app/services/chat_engine/chart_classifier.py`:

```python
# ── Chart type registry ──────────────────────────────────────────────

CHART_TYPE_REGISTRY: dict[str, dict[str, Any]] = {
    'bar':            {'min_categorical': 1, 'min_numeric': 1, 'max_series': 1},
    'horizontal_bar': {'min_categorical': 1, 'min_numeric': 1, 'max_series': 1, 'prefer_when': 'high_cardinality'},
    'stacked_bar':    {'min_categorical': 1, 'min_numeric': 2},
    'grouped_bar':    {'min_categorical': 1, 'min_numeric': 2},
    'line':           {'min_ordinal': 1, 'min_numeric': 1},
    'area':           {'min_ordinal': 1, 'min_numeric': 1},
    'stacked_area':   {'min_ordinal': 1, 'min_numeric': 2},
    'pie':            {'min_categorical': 1, 'min_numeric': 1, 'max_rows': 12},
    'donut':          {'min_categorical': 1, 'min_numeric': 1, 'max_rows': 12},
    'scatter':        {'min_numeric': 2},
    'radar':          {'min_categorical': 1, 'min_numeric': 1, 'min_rows': 3, 'max_rows': 10},
    'funnel':         {'min_categorical': 1, 'min_numeric': 1, 'requires': 'ordered_categorical'},
    'treemap':        {'min_categorical': 1, 'min_numeric': 1, 'min_rows': 3},
    'radial_bar':     {'min_categorical': 1, 'min_numeric': 1, 'max_rows': 8},
    'composed':       {'min_ordinal': 1, 'min_numeric': 2},
}

_HIGH_CARDINALITY_THRESHOLD = 8


def get_eligible_charts(
    column_types: dict[str, str],
    *,
    row_count: int,
) -> list[str]:
    """Return chart types eligible for the given data shape, ordered by fit.

    Ranking:
    1. Charts with ``requires`` constraints that match (specificity wins)
    2. Charts with ``prefer_when`` conditions that match
    3. General-purpose charts
    """
    if not column_types:
        return []

    counts = {
        'numeric': 0,
        'categorical': 0,
        'temporal': 0,
        'ordered_categorical': 0,
    }
    for col_type in column_types.values():
        counts[col_type] = counts.get(col_type, 0) + 1

    # Ordinal = temporal + ordered_categorical
    ordinal_count = counts['temporal'] + counts['ordered_categorical']
    # Categorical includes ordered_categorical and temporal (they can group)
    categorical_count = counts['categorical'] + counts['ordered_categorical'] + counts['temporal']

    has_ordered = counts['ordered_categorical'] > 0

    eligible: list[tuple[int, str]] = []  # (priority, type_name)

    for chart_type, reqs in CHART_TYPE_REGISTRY.items():
        # Check min_numeric
        if counts['numeric'] < reqs.get('min_numeric', 0):
            continue
        # Check min_categorical (temporal and ordered satisfy this)
        if categorical_count < reqs.get('min_categorical', 0):
            continue
        # Check min_ordinal (temporal and ordered_categorical satisfy this)
        if ordinal_count < reqs.get('min_ordinal', 0):
            continue
        # Check row count bounds
        if row_count < reqs.get('min_rows', 0):
            continue
        if 'max_rows' in reqs and row_count > reqs['max_rows']:
            continue
        # Check requires constraint
        requires = reqs.get('requires')
        if requires == 'ordered_categorical' and not has_ordered:
            continue

        # Assign priority (lower = better)
        priority = 30  # default: general purpose
        if requires and requires == 'ordered_categorical' and has_ordered:
            priority = 10  # specificity match
        elif reqs.get('prefer_when') == 'high_cardinality' and row_count >= _HIGH_CARDINALITY_THRESHOLD:
            priority = 20  # preference match
        elif reqs.get('prefer_when') == 'high_cardinality' and row_count < _HIGH_CARDINALITY_THRESHOLD:
            priority = 35  # demote when preference doesn't match

        eligible.append((priority, chart_type))

    eligible.sort(key=lambda item: item[0])
    return [chart_type for _, chart_type in eligible]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_chart_classifier_unittest.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/chat_engine/chart_classifier.py backend/tests/test_chart_classifier_unittest.py
git commit -m "feat: add chart type registry and eligibility classifier"
```

---

### Task 3: Integrate Classifier into Scratchpad

**Files:**
- Modify: `backend/app/services/report_builder/scratchpad_state.py`
- Modify: `backend/app/services/report_builder/chat_handler.py` (line 84, line 371)
- Modify: `backend/app/services/chat_engine/prompts/scratchpad.py` (lines 89-108)

- [ ] **Step 1: Write failing test for snapshot with chart eligibility**

Add to `backend/tests/test_chart_classifier_unittest.py`:

```python
from app.services.report_builder.scratchpad_state import build_analysis_snapshot


class SnapshotIntegrationTests(unittest.TestCase):

    def test_snapshot_includes_column_types_and_eligible_charts(self):
        result = {
            'status': 'ok',
            'question': 'Revenue by agent',
            'row_count': 5,
            'data': [
                {'agent': 'Alice', 'revenue': 100},
                {'agent': 'Bob', 'revenue': 200},
            ],
        }
        snapshot = build_analysis_snapshot(result)
        self.assertIn('column_types', snapshot)
        self.assertEqual(snapshot['column_types']['agent'], 'categorical')
        self.assertEqual(snapshot['column_types']['revenue'], 'numeric')
        self.assertIn('eligible_charts', snapshot)
        self.assertIn('bar', snapshot['eligible_charts'])

    def test_snapshot_with_dimensions_enables_funnel(self):
        result = {
            'status': 'ok',
            'question': 'Leads by stage',
            'row_count': 5,
            'data': [
                {'stage': 'new', 'count': 100},
                {'stage': 'closed', 'count': 20},
            ],
        }
        dimensions = [{'name': 'stage', 'ordering': ['new', 'contacted', 'closed']}]
        snapshot = build_analysis_snapshot(result, dimensions=dimensions)
        self.assertEqual(snapshot['column_types']['stage'], 'ordered_categorical')
        self.assertIn('funnel', snapshot['eligible_charts'])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_chart_classifier_unittest.py::SnapshotIntegrationTests -v`
Expected: FAIL — `build_analysis_snapshot() got an unexpected keyword argument 'dimensions'`

- [ ] **Step 3: Modify build_analysis_snapshot to call classifier**

In `backend/app/services/report_builder/scratchpad_state.py`, update `build_analysis_snapshot` (line 79):

```python
def build_analysis_snapshot(
    result: dict[str, Any],
    dimensions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    rows = result.get('data', [])
    if not isinstance(rows, list):
        rows = []
    normalized_rows = [row for row in rows if isinstance(row, dict)]
    columns = _ordered_columns(normalized_rows)
    preview_rows = [
        _compact_row(row, columns)
        for row in normalized_rows[:_MAX_ANALYSIS_PREVIEW_ROWS]
    ]
    focus = preview_rows[0] if preview_rows else {}
    row_count = result.get('row_count')
    if not isinstance(row_count, int):
        row_count = len(normalized_rows)

    from app.services.chat_engine.chart_classifier import classify_columns, get_eligible_charts

    column_types = classify_columns(columns, normalized_rows, dimensions=dimensions)
    eligible_charts = get_eligible_charts(column_types, row_count=row_count)

    return {
        'question': str(result.get('question', '')).strip(),
        'row_count': row_count,
        'sql_used': result.get('sql_used'),
        'columns': columns,
        'column_types': column_types,
        'eligible_charts': eligible_charts,
        'data': normalized_rows,
        'preview_rows': preview_rows,
        'focus': focus,
    }
```

Add import at top of file:
```python
# no new top-level import needed — using inline import to avoid circular dependency
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_chart_classifier_unittest.py -v`
Expected: All tests PASS

- [ ] **Step 5: Pass dimension metadata from chat_handler**

In `backend/app/services/report_builder/chat_handler.py`, modify `_update_scratchpad` (line 58) to accept `app_id`:

Change the signature from:
```python
def _update_scratchpad(session: dict[str, Any], tool_name: str, result_str: str) -> None:
```
to:
```python
def _update_scratchpad(session: dict[str, Any], tool_name: str, result_str: str, *, app_id: str = '') -> None:
```

Then modify the analyze branch (around line 81-84) to load dimension metadata:

```python
    if tool_name == 'analyze' and data.get('status') == 'ok':
        question = str(data.get('question', '')).strip()
        row_count = data.get('row_count', 0)
        # Load dimension metadata for chart classifier
        dimensions: list[dict[str, Any]] | None = None
        if app_id:
            from app.services.chat_engine.sql_agent import load_semantic_model, _normalize_dimensions
            try:
                semantic_model = load_semantic_model(app_id)
                dimensions = _normalize_dimensions(semantic_model)
            except Exception:
                pass
        push_analysis_snapshot(pad, build_analysis_snapshot(data, dimensions=dimensions))
        if question:
            pad['findings'].append(f'{question} ({row_count} rows)')
        return
```

Update the call site at line 371 to pass app_id:

```python
_update_scratchpad(session, name, result_str, app_id=session.get("app_id", ""))
```

- [ ] **Step 6: Inject eligible charts into scratchpad rendering**

In `backend/app/services/chat_engine/prompts/scratchpad.py`, after the existing `last_analysis` block (line 89-108), add chart eligibility rendering inside the same `if last_analysis:` block:

After line 108, add:
```python
        eligible_charts = last_analysis.get('eligible_charts', [])
        if eligible_charts:
            best = eligible_charts[0]
            others = ', '.join(eligible_charts[1:6])
            lines.append(f'- Chart types for this data: {", ".join(eligible_charts[:6])}. Best fit: {best}.')
```

- [ ] **Step 7: Run all affected tests**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_chart_classifier_unittest.py backend/tests/test_report_builder_tool_handlers_unittest.py -v`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/report_builder/scratchpad_state.py backend/app/services/report_builder/chat_handler.py backend/app/services/chat_engine/prompts/scratchpad.py
git commit -m "feat: integrate chart classifier into scratchpad and LLM context"
```

---

### Task 4: Widen render_chart Tool Schema and Handler

**Files:**
- Modify: `backend/app/services/report_builder/tool_definitions.py` (lines 277-324)
- Modify: `backend/app/services/report_builder/tool_handlers.py` (lines 1204-1257)
- Modify: `backend/tests/test_report_builder_tool_handlers_unittest.py`

- [ ] **Step 1: Write failing test for new render_chart behavior**

Add to `backend/tests/test_report_builder_tool_handlers_unittest.py`:

```python
class RenderChartEligibilityTests(unittest.IsolatedAsyncioTestCase):

    async def test_render_chart_accepts_eligible_type(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['stage', 'count'],
                    'column_types': {'stage': 'ordered_categorical', 'count': 'numeric'},
                    'eligible_charts': ['funnel', 'bar', 'pie'],
                    'data': [{'stage': 'new', 'count': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='funnel',
            title='Stage Progression',
            x_key='stage',
            y_key='count',
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['chart_spec']['type'], 'funnel')

    async def test_render_chart_rejects_ineligible_type(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['agent', 'revenue'],
                    'column_types': {'agent': 'categorical', 'revenue': 'numeric'},
                    'eligible_charts': ['bar', 'horizontal_bar', 'pie'],
                    'data': [{'agent': 'A', 'revenue': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='funnel',
            title='Test',
            x_key='agent',
            y_key='revenue',
            session=session,
        )
        self.assertEqual(result['status'], 'error')
        self.assertIn('not eligible', result['error'])

    async def test_render_chart_passes_through_alternatives(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['agent', 'revenue'],
                    'column_types': {'agent': 'categorical', 'revenue': 'numeric'},
                    'eligible_charts': ['bar', 'horizontal_bar', 'pie'],
                    'data': [{'agent': 'A', 'revenue': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='bar',
            title='Revenue',
            x_key='agent',
            y_key='revenue',
            alternatives=['horizontal_bar', 'pie'],
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['chart_spec']['alternatives'], ['horizontal_bar', 'pie'])

    async def test_render_chart_fallback_to_registry_when_no_eligible(self):
        """Backward compat: if scratchpad has no eligible_charts, accept any registry type."""
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['agent', 'revenue'],
                    'data': [{'agent': 'A', 'revenue': 100}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='bar',
            title='Revenue',
            x_key='agent',
            y_key='revenue',
            session=session,
        )
        self.assertEqual(result['status'], 'ok')

    async def test_render_chart_series_field_for_composed(self):
        session = {
            'scratchpad': {
                'last_analysis': {
                    'columns': ['month', 'revenue', 'cost'],
                    'column_types': {'month': 'temporal', 'revenue': 'numeric', 'cost': 'numeric'},
                    'eligible_charts': ['composed', 'line', 'stacked_area'],
                    'data': [{'month': '2026-01', 'revenue': 100, 'cost': 50}],
                },
            },
        }
        result = await handle_render_chart(
            chart_type='composed',
            title='Revenue vs Cost',
            x_key='month',
            series=[
                {'data_key': 'revenue', 'type': 'bar'},
                {'data_key': 'cost', 'type': 'line'},
            ],
            session=session,
        )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(len(result['chart_spec']['series']), 2)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_report_builder_tool_handlers_unittest.py::RenderChartEligibilityTests -v`
Expected: FAIL

- [ ] **Step 3: Update tool_definitions.py**

Replace the `render_chart` entry in `ANALYTICS_TOOLS` (starting at line 276) in `backend/app/services/report_builder/tool_definitions.py`:

```python
    {
        "name": "render_chart",
        "description": (
            "Render an interactive chart visualization from data returned by the analyze tool. "
            "Call this AFTER analyze when the user asks for a chart, visualization, or graph. "
            "If the user is charting the most recent analysis from session state, do not re-run analyze "
            "unless the requested metric, grouping, or filters changed. "
            "Pick chart_type from the eligible chart types listed in session state for the current data. "
            "The x_key, y_key, and series data_key values must match column names from the analyze result."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "chart_type": {
                    "type": "string",
                    "description": "Chart type to render. Pick from the eligible chart types for the current data.",
                },
                "title": {
                    "type": "string",
                    "description": "Chart title displayed above the visualization.",
                },
                "x_key": {
                    "type": "string",
                    "description": "Column name for the x-axis or category labels.",
                },
                "y_key": {
                    "type": "string",
                    "description": "Column name for the y-axis values (single series).",
                },
                "series_keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Column names for multiple data series (stacked/grouped). Each becomes a segment.",
                },
                "series": {
                    "type": "array",
                    "description": "For composed charts: per-series visual config. Each entry specifies a data column and how to render it.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "data_key": {
                                "type": "string",
                                "description": "Column name for this series.",
                            },
                            "type": {
                                "type": "string",
                                "enum": ["bar", "line", "area", "scatter"],
                                "description": "Visual type for this series.",
                            },
                            "stack_id": {
                                "type": "string",
                                "description": "Optional stack group ID for stacking multiple bar series.",
                            },
                        },
                        "required": ["data_key", "type"],
                    },
                },
                "x_label": {
                    "type": "string",
                    "description": "Optional display label for x-axis.",
                },
                "y_label": {
                    "type": "string",
                    "description": "Optional display label for y-axis.",
                },
                "legend_position": {
                    "type": "string",
                    "enum": ["top", "bottom", "right", "none"],
                    "description": "Legend position. Defaults to bottom for cartesian charts, right for pie/donut.",
                },
                "alternatives": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Up to 3 alternative chart types the user can switch to client-side. "
                        "Only include when the user did not request a specific chart type."
                    ),
                },
            },
            "required": ["chart_type", "title", "x_key"],
        },
    },
```

- [ ] **Step 4: Update handle_render_chart in tool_handlers.py**

Replace `handle_render_chart` (line 1204) in `backend/app/services/report_builder/tool_handlers.py`:

```python
async def handle_render_chart(
    *,
    chart_type: str,
    title: str,
    x_key: str,
    y_key: str | None = None,
    series_keys: list[str] | None = None,
    series: list[dict[str, Any]] | None = None,
    x_label: str = "",
    y_label: str = "",
    legend_position: str | None = None,
    alternatives: list[str] | None = None,
    session: dict[str, Any] | None = None,
    **_kwargs: Any,
) -> dict:
    """Package chart spec for frontend rendering. Data comes from prior analyze call."""
    from app.services.chat_engine.chart_classifier import CHART_TYPE_REGISTRY

    scratchpad = (session or {}).get('scratchpad', {}) if session else {}
    last_analysis = scratchpad.get('last_analysis')
    if not isinstance(last_analysis, dict):
        return {
            'status': 'error',
            'error': 'No analysis result available to chart. Run analyze first.',
        }

    # Validate chart type against eligible set or registry fallback
    eligible = last_analysis.get('eligible_charts')
    if isinstance(eligible, list) and eligible:
        if chart_type not in eligible:
            return {
                'status': 'error',
                'error': f'Chart type "{chart_type}" is not eligible for this data. Eligible types: {eligible}',
            }
    elif chart_type not in CHART_TYPE_REGISTRY:
        return {
            'status': 'error',
            'error': f'Unknown chart type "{chart_type}". Available: {list(CHART_TYPE_REGISTRY.keys())}',
        }

    # Validate column references
    available_columns = [
        str(column)
        for column in last_analysis.get('columns', [])
        if column
    ]
    requested_columns = [x_key]
    if y_key:
        requested_columns.append(y_key)
    requested_columns.extend(series_keys or [])
    if series:
        requested_columns.extend(s.get('data_key', '') for s in series if isinstance(s, dict))
    missing_columns = [
        column
        for column in requested_columns
        if column and column not in available_columns
    ]
    if missing_columns:
        return {
            'status': 'error',
            'error': f'Chart columns not present in the latest analysis result: {missing_columns}',
            'available_columns': available_columns,
        }

    # Validate alternatives against registry
    validated_alternatives: list[str] = []
    if alternatives:
        validated_alternatives = [alt for alt in alternatives if alt in CHART_TYPE_REGISTRY][:3]

    chart_spec: dict[str, Any] = {
        "type": chart_type,
        "title": title,
        "xKey": x_key,
        "yKey": y_key,
        "seriesKeys": series_keys or [],
        "xLabel": x_label,
        "yLabel": y_label,
    }
    if series:
        chart_spec["series"] = [
            {"dataKey": s["data_key"], "type": s["type"], **({"stackId": s["stack_id"]} if s.get("stack_id") else {})}
            for s in series
            if isinstance(s, dict) and s.get("data_key") and s.get("type")
        ]
    if legend_position:
        chart_spec["legendPosition"] = legend_position
    if validated_alternatives:
        chart_spec["alternatives"] = validated_alternatives

    return {
        "status": "ok",
        "chart_spec": chart_spec,
    }
```

- [ ] **Step 5: Run tests**

Run: `PYTHONPATH=backend python -m pytest backend/tests/test_report_builder_tool_handlers_unittest.py -v`
Expected: All PASS (both new and existing tests — existing tests still pass because old shapes are a subset)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/report_builder/tool_definitions.py backend/app/services/report_builder/tool_handlers.py backend/tests/test_report_builder_tool_handlers_unittest.py
git commit -m "feat: widen render_chart schema and validate against eligible charts"
```

---

### Task 5: Add Semantic Model Dimension Metadata

**Files:**
- Modify: `backend/app/services/chat_engine/semantic_models/inside-sales.yaml`

- [ ] **Step 1: Add ordering to inside-sales dimensions**

In `backend/app/services/chat_engine/semantic_models/inside-sales.yaml`, add `ordering` to the `result_status` dimension (line 43) and `direction` dimension if applicable:

```yaml
  - name: result_status
    table: analytics_eval_facts
    expression: "result_status"
    description: "Primary verdict or outcome"
    ordering: ["PASS", "SOFT FAIL", "HARD FAIL", "CRITICAL"]
```

Note: Only add `ordering` where there's a meaningful sequence. `agent` and `evaluator_name` are not ordered. `result_status` has a severity progression.

- [ ] **Step 2: Verify semantic model loads correctly**

Run: `PYTHONPATH=backend python -c "from app.services.chat_engine.sql_agent import load_semantic_model, _normalize_dimensions; model = load_semantic_model('inside-sales'); dims = _normalize_dimensions(model); ordered = [d for d in dims if d.get('ordering')]; print(f'Ordered dimensions: {[d[\"name\"] for d in ordered]}')"`
Expected: `Ordered dimensions: ['result_status']`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/chat_engine/semantic_models/inside-sales.yaml
git commit -m "feat: add ordering metadata to inside-sales severity dimension"
```

---

### Task 6: Frontend Types — Widen ChartSpec

**Files:**
- Modify: `src/features/chat-widget/types.ts` (lines 20-35)

- [ ] **Step 1: Update ChartSpec and add SeriesConfig**

Replace the `ChartSpec` interface in `src/features/chat-widget/types.ts` (lines 20-28):

```typescript
export interface SeriesConfig {
  dataKey: string;
  type: 'bar' | 'line' | 'area' | 'scatter';
  stackId?: string;
}

export interface ChartSpec {
  type: string;
  title: string;
  xKey: string;
  yKey?: string;
  seriesKeys: string[];
  series?: SeriesConfig[];
  xLabel: string;
  yLabel: string;
  legendPosition?: 'top' | 'bottom' | 'right' | 'none';
  alternatives?: string[];
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc -b --noEmit`
Expected: No new errors. The type is wider (string vs union), so all existing consumers still compile.

- [ ] **Step 3: Commit**

```bash
git add src/features/chat-widget/types.ts
git commit -m "feat: widen ChartSpec type to support dynamic chart types"
```

---

### Task 7: Frontend — Generic ChartRenderer

**Files:**
- Rewrite: `src/features/analytics/components/ChartRenderer.tsx`

- [ ] **Step 1: Rewrite ChartRenderer with CHART_MAP**

Replace the entire content of `src/features/analytics/components/ChartRenderer.tsx`:

```typescript
import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, FunnelChart, Funnel, Treemap,
  RadialBarChart, RadialBar, ComposedChart,
} from 'recharts';
import { resolveColor } from '@/utils/statusColors';
import type { SeriesConfig } from '@/features/chat-widget/types';

const CHART_PALETTE = [
  '--color-brand-primary',
  '--color-verdict-pass',
  '--color-level-easy',
  '--color-verdict-soft-fail',
  '--color-level-hard',
  '--color-verdict-fail',
  '--color-level-crack',
  '--color-verdict-critical',
];

interface ChartMapping {
  cartesian?: boolean;
  polar?: boolean;
  layoutVertical?: boolean;
  stacked?: boolean;
  innerRadius?: number;
}

const CHART_MAP: Record<string, ChartMapping> = {
  bar:            { cartesian: true },
  horizontal_bar: { cartesian: true, layoutVertical: true },
  stacked_bar:    { cartesian: true, stacked: true },
  grouped_bar:    { cartesian: true },
  line:           { cartesian: true },
  area:           { cartesian: true },
  stacked_area:   { cartesian: true, stacked: true },
  scatter:        { cartesian: true },
  radar:          { polar: true },
  funnel:         {},
  treemap:        {},
  radial_bar:     { polar: true },
  composed:       { cartesian: true },
  pie:            { polar: true },
  donut:          { polar: true, innerRadius: 0.5 },
};

interface ChartRendererProps {
  type: string;
  data: Record<string, unknown>[];
  xKey: string;
  yKey?: string;
  seriesKeys?: string[];
  series?: SeriesConfig[];
  xLabel?: string;
  yLabel?: string;
  legendPosition?: 'top' | 'bottom' | 'right' | 'none';
  height?: number;
  compact?: boolean;
}

function truncateLabel(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 1) + '\u2026';
}

export function ChartRenderer({
  type, data, xKey, yKey, seriesKeys = [], series, xLabel, yLabel,
  legendPosition, height = 300, compact = false,
}: ChartRendererProps) {
  const colors = useMemo(
    () => CHART_PALETTE.map((v) => resolveColor(`var(${v})`)),
    [],
  );

  if (!data.length) {
    return <div className="text-xs text-[var(--text-muted)] py-4 text-center">No data</div>;
  }

  const mapping = CHART_MAP[type] ?? CHART_MAP.bar;
  const labelMaxLen = compact ? 18 : 40;
  const tickFontSize = compact ? 9 : 10;
  const shouldShowLegend = legendPosition !== 'none';
  const legendPos = legendPosition ?? (mapping.polar ? 'right' : 'bottom');
  const xTickFormatter = compact ? (v: string) => truncateLabel(String(v), labelMaxLen) : undefined;
  const autoRotate = compact && data.length > 8;
  const tooltipStyle = { fontSize: compact ? 10 : 11, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' };
  const commonMargin = compact
    ? { top: 4, right: 8, bottom: xLabel || autoRotate ? 24 : 4, left: yLabel ? 28 : 4 }
    : { top: 8, right: 16, bottom: xLabel ? 24 : 8, left: yLabel ? 32 : 8 };

  const legendProps = shouldShowLegend ? {
    layout: (legendPos === 'right' ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal',
    align: (legendPos === 'right' ? 'right' : 'center') as 'right' | 'center',
    verticalAlign: (legendPos === 'top' ? 'top' : legendPos === 'right' ? 'middle' : 'bottom') as 'top' | 'middle' | 'bottom',
    wrapperStyle: compact ? { fontSize: 10, maxHeight: height - 16, overflowY: 'auto' as const } : undefined,
    formatter: (value: string) => truncateLabel(value, labelMaxLen),
  } : undefined;

  // ── Pie / Donut ──────────────────────────────────────────────
  if (type === 'pie' || type === 'donut') {
    const outerRadius = compact ? Math.min(height / 3, 80) : height / 3;
    const innerRadius = mapping.innerRadius ? outerRadius * mapping.innerRadius : 0;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey={yKey || 'value'}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={outerRadius}
            innerRadius={innerRadius}
            label={compact ? undefined : ({ name, percent }: { name?: string; percent?: number }) =>
              `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number | undefined) => (value ?? 0).toLocaleString()} />
          {legendProps && <Legend {...legendProps} />}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // ── Radar ────────────────────────────────────────────────────
  if (type === 'radar') {
    const keys = seriesKeys.length ? seriesKeys : yKey ? [yKey] : [];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius={compact ? '70%' : '80%'}>
          <PolarGrid stroke="var(--border-subtle)" />
          <PolarAngleAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} />
          <PolarRadiusAxis tick={{ fontSize: tickFontSize - 1 }} />
          {keys.map((k, i) => (
            <Radar key={k} dataKey={k} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.3} />
          ))}
          <Tooltip contentStyle={tooltipStyle} />
          {legendProps && <Legend {...legendProps} />}
        </RadarChart>
      </ResponsiveContainer>
    );
  }

  // ── Radial Bar ───────────────────────────────────────────────
  if (type === 'radial_bar') {
    const coloredData = data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <RadialBarChart data={coloredData} innerRadius="20%" outerRadius="90%" startAngle={180} endAngle={0}>
          <RadialBar dataKey={yKey || 'value'} background={{ fill: 'var(--bg-secondary)' }} />
          <Tooltip contentStyle={tooltipStyle} />
          {legendProps && <Legend {...legendProps} iconType="circle" formatter={(_, entry) => truncateLabel(String((entry as { payload?: Record<string, unknown> }).payload?.[xKey] ?? ''), labelMaxLen)} />}
        </RadialBarChart>
      </ResponsiveContainer>
    );
  }

  // ── Funnel ───────────────────────────────────────────────────
  if (type === 'funnel') {
    const coloredData = data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <FunnelChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Funnel dataKey={yKey || 'value'} nameKey={xKey} data={coloredData} />
          {legendProps && <Legend {...legendProps} />}
        </FunnelChart>
      </ResponsiveContainer>
    );
  }

  // ── Treemap ──────────────────────────────────────────────────
  if (type === 'treemap') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <Treemap
          data={data.map((d, i) => ({ name: String(d[xKey] ?? ''), size: Number(d[yKey || 'value'] ?? 0), fill: colors[i % colors.length] }))}
          dataKey="size"
          nameKey="name"
          aspectRatio={4 / 3}
          stroke="var(--bg-primary)"
        />
      </ResponsiveContainer>
    );
  }

  // ── Scatter ──────────────────────────────────────────────────
  if (type === 'scatter') {
    const numericCols = seriesKeys.length ? seriesKeys : yKey ? [yKey] : [];
    const scatterYKey = numericCols[0];
    if (!scatterYKey) return <div className="text-xs text-[var(--text-muted)] py-4 text-center">Scatter needs two numeric columns</div>;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={commonMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey={xKey} type="number" tick={{ fontSize: tickFontSize }} name={xLabel || xKey} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis dataKey={scatterYKey} type="number" tick={{ fontSize: tickFontSize }} name={yLabel || scatterYKey} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} fill={colors[0]} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  // ── Composed ─────────────────────────────────────────────────
  if (type === 'composed' && series?.length) {
    const visualMap: Record<string, typeof Bar | typeof Line | typeof Area | typeof Scatter> = {
      bar: Bar, line: Line, area: Area, scatter: Scatter,
    };
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={commonMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis tick={{ fontSize: tickFontSize }} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip contentStyle={tooltipStyle} />
          {legendProps && <Legend {...legendProps} />}
          {series.map((s, i) => {
            const Visual = visualMap[s.type] ?? Bar;
            const key = s.dataKey;
            const color = colors[i % colors.length];
            if (Visual === Line) return <Line key={key} dataKey={key} stroke={color} strokeWidth={2} dot={{ r: compact ? 2 : 3 }} />;
            if (Visual === Area) return <Area key={key} dataKey={key} stroke={color} fill={color} fillOpacity={0.3} />;
            if (Visual === Scatter) return <Scatter key={key} dataKey={key} fill={color} />;
            return <Bar key={key} dataKey={key} fill={color} stackId={s.stackId} radius={[4, 4, 0, 0]} />;
          })}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // ── Cartesian (bar, horizontal_bar, stacked_bar, grouped_bar, line, area, stacked_area) ──
  const isVerticalLayout = mapping.layoutVertical;
  const yAxisWidth = compact ? 90 : 120;

  if (type === 'line' || type === 'area') {
    const keys = seriesKeys.length ? seriesKeys : yKey ? [yKey] : [];
    const ChartContainer = type === 'area' ? AreaChart : LineChart;
    const Visual = type === 'area' ? Area : Line;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ChartContainer data={data} margin={commonMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} angle={autoRotate ? -45 : 0} textAnchor={autoRotate ? 'end' : 'middle'} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis tick={{ fontSize: tickFontSize }} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip contentStyle={tooltipStyle} />
          {legendProps && !compact && <Legend {...legendProps} />}
          {keys.map((k, i) => (
            type === 'area'
              ? <Area key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.3} stackId={mapping.stacked ? 'stack' : undefined} />
              : <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: compact ? 2 : 3 }} />
          ))}
        </ChartContainer>
      </ResponsiveContainer>
    );
  }

  // Bar variants (bar, horizontal_bar, stacked_bar, grouped_bar)
  const barKeys = seriesKeys.length ? seriesKeys : yKey ? [yKey] : [];
  const barHeight = compact ? 24 : 32;
  const resolvedHeight = isVerticalLayout ? Math.max(height, data.length * barHeight) : height;

  return (
    <ResponsiveContainer width="100%" height={resolvedHeight}>
      <BarChart data={data} margin={commonMargin} layout={isVerticalLayout ? 'vertical' : 'horizontal'}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        {isVerticalLayout ? (
          <>
            <XAxis type="number" tick={{ fontSize: tickFontSize }} label={yLabel ? { value: yLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: tickFontSize }} width={yAxisWidth} tickFormatter={(v: string) => truncateLabel(String(v), compact ? 14 : 20)} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} angle={autoRotate ? -45 : 0} textAnchor={autoRotate ? 'end' : 'middle'} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
            <YAxis tick={{ fontSize: tickFontSize }} label={yLabel ? { value: yLabel, position: 'insideLeft', angle: -90, fontSize: tickFontSize + 1 } : undefined} />
          </>
        )}
        <Tooltip contentStyle={tooltipStyle} />
        {legendProps && barKeys.length > 1 && <Legend {...legendProps} />}
        {barKeys.map((k, i) => (
          <Bar key={k} dataKey={k} fill={colors[i % colors.length]} stackId={mapping.stacked ? 'stack' : undefined} radius={isVerticalLayout ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/features/analytics/components/ChartRenderer.tsx
git commit -m "feat: replace switch-case chart renderer with generic CHART_MAP"
```

---

### Task 8: Frontend — ChatChart Sizing, Consolidation, and Suggestion Pills

**Files:**
- Modify: `src/features/chat-widget/ChatChart.tsx`

- [ ] **Step 1: Rewrite ChatChart with sizing matrix, extended consolidation, and suggestion pills**

Replace the entire content of `src/features/chat-widget/ChatChart.tsx`:

```typescript
import { useMemo, useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { cn } from '@/utils/cn';
import { ChartRenderer } from '@/features/analytics/components/ChartRenderer';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import type { ChartData } from './types';

/** Chart type display labels for suggestion pills. */
const TYPE_LABELS: Record<string, string> = {
  bar: 'Bar',
  horizontal_bar: 'H. Bar',
  stacked_bar: 'Stacked',
  grouped_bar: 'Grouped',
  line: 'Line',
  area: 'Area',
  stacked_area: 'Stacked Area',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  radar: 'Radar',
  funnel: 'Funnel',
  treemap: 'Treemap',
  radial_bar: 'Radial',
  composed: 'Composed',
};

/** Max items before tail entries are grouped into "Other". */
const CONSOLIDATION_LIMITS: Record<string, number> = {
  pie: 8,
  donut: 8,
  radar: 10,
  radial_bar: 8,
  treemap: 20,
};

function resolveChartHeight(type: string, dataCount: number): number {
  switch (type) {
    case 'pie':
    case 'donut':
    case 'treemap':
    case 'radial_bar':
      return 240;
    case 'radar':
      return 260;
    case 'horizontal_bar':
      return Math.max(200, Math.min(dataCount * 28, 400));
    case 'funnel':
      return Math.max(180, Math.min(dataCount * 36, 360));
    default:
      return 220;
  }
}

function consolidateData(
  data: Record<string, unknown>[],
  type: string,
  xKey: string,
  yKey: string | undefined,
): Record<string, unknown>[] {
  const maxSlices = CONSOLIDATION_LIMITS[type];
  if (!maxSlices || data.length <= maxSlices) return data;

  const valueKey = yKey || 'value';
  const sorted = [...data].sort((a, b) => Number(b[valueKey] ?? 0) - Number(a[valueKey] ?? 0));
  const top = sorted.slice(0, maxSlices - 1);
  const rest = sorted.slice(maxSlices - 1);

  if (rest.length === 0) return top;

  const otherValue = rest.reduce((sum, row) => sum + Number(row[valueKey] ?? 0), 0);
  return [...top, { [xKey]: `Other (${rest.length})`, [valueKey]: otherValue }];
}

interface ChatChartProps {
  chart: ChartData;
  appId: string;
}

export function ChatChart({ chart, appId }: ChatChartProps) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeType, setActiveType] = useState(chart.spec.type);

  const handleSave = async () => {
    setSaving(true);
    try {
      await analyticsLibraryApi.saveChart({
        appId,
        title: chart.spec.title,
        sqlQuery: chart.sqlQuery,
        chartConfig: {
          type: activeType,
          xKey: chart.spec.xKey,
          yKey: chart.spec.yKey,
          seriesKeys: chart.spec.seriesKeys,
          series: chart.spec.series,
          xLabel: chart.spec.xLabel,
          yLabel: chart.spec.yLabel,
          legendPosition: chart.spec.legendPosition,
        },
        sourceQuestion: chart.sourceQuestion,
      });
      setSaved(true);
      notificationService.success('Chart added to library');
    } catch {
      notificationService.error('Failed to save chart');
    } finally {
      setSaving(false);
    }
  };

  const displayData = useMemo(
    () => consolidateData(
      chart.data as Record<string, unknown>[],
      activeType,
      chart.spec.xKey,
      chart.spec.yKey,
    ),
    [chart.data, activeType, chart.spec.xKey, chart.spec.yKey],
  );

  const height = resolveChartHeight(activeType, displayData.length);
  const alternatives = chart.spec.alternatives ?? [];

  return (
    <div className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[var(--text-primary)] truncate mr-2">{chart.spec.title}</span>
        <button
          onClick={handleSave}
          disabled={saved || saving}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors shrink-0',
            saved
              ? 'bg-[var(--color-verdict-pass)]/10 text-[var(--color-verdict-pass)]'
              : 'bg-[var(--color-brand-accent)] text-[var(--color-brand-primary)] hover:bg-[var(--color-brand-primary)] hover:text-white',
          )}
        >
          {saved ? <Check className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
          {saved ? 'Saved' : 'Add to library'}
        </button>
      </div>
      <ChartRenderer
        type={activeType}
        data={displayData}
        xKey={chart.spec.xKey}
        yKey={chart.spec.yKey}
        seriesKeys={chart.spec.seriesKeys}
        series={chart.spec.series}
        xLabel={chart.spec.xLabel}
        yLabel={chart.spec.yLabel}
        legendPosition={chart.spec.legendPosition}
        height={height}
        compact
      />
      {alternatives.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-muted)]">Try as:</span>
          {alternatives.map((alt) => (
            <button
              key={alt}
              onClick={() => setActiveType(alt)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                activeType === alt
                  ? 'border border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
              )}
            >
              {TYPE_LABELS[alt] || alt}
            </button>
          ))}
          {activeType !== chart.spec.type && (
            <button
              onClick={() => setActiveType(chart.spec.type)}
              className="rounded px-2 py-0.5 text-[10px] font-medium bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              {TYPE_LABELS[chart.spec.type] || chart.spec.type}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/features/chat-widget/ChatChart.tsx
git commit -m "feat: add chart type suggestion pills, sizing matrix, and extended consolidation"
```

---

### Task 9: Verify End-to-End

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

Run: `PYTHONPATH=backend python -m pytest backend/tests/ -v --tb=short`
Expected: All PASS

- [ ] **Step 2: Run frontend type check**

Run: `npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 3: Run frontend tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 4: Build frontend**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit any fixes from verification**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: resolve issues found during end-to-end verification"
```
