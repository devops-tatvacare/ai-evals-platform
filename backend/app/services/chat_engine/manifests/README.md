# Manifests vs semantic models — separation of concerns

Phase 4 §658 acceptance gate: *"zero fields living in both."* For every field
that appears in both `manifests/<app>.yaml` and `semantic_models/<app>.yaml`,
this file documents the justified (b)-style separation. Unjustified duplicates
are a drift signal — fix the source, not this doc.

## What each file owns

**Manifest (`manifests/<app>.yaml`)** — **column-level** source of truth for a
declared catalog table:

- `role` (`dimension` / `measure` / `temporal` / `key` / `identifier` /
  `ordered_categorical`)
- `data_type`, `semantic_type` (Vega-Lite / Metabase taxonomy)
- `synonyms`, `allowed_values`, `ordering`, `unit`, `measure_kind`, `chartable`
- column `description` — narrates what the column stores

Every manifest column surface flows through the `comment_emitter` →
`pg_description` → SQL agent hint path (Phase 4 §652, §654). Harness-Core
callers read these through `parse_column_comment`, never by importing the
manifest directly from inside `sql_agent`.

**Semantic model (`semantic_models/<app>.yaml`)** — **dimension-level** source
of truth for the analytics SQL agent:

- `name` — the business-facing identifier; may alias the underlying column
  (e.g. `thread_id` → `item_id`).
- `table` — which catalog table the dimension resolves against.
- `expression` — raw SQL expression (column name, JSONB path
  `context->>'k'`, or a `CASE WHEN …` derivation). The manifest is
  column-level and cannot carry SQL text; dimensions can.
- `description` — narrates the dimension's **role in analysis**, not the
  column's storage semantics. For aliased or derived dimensions this text
  is strictly dimension-level.
- `allowed_values`, `ordering` — dimension-level vocabulary. For 1:1 column
  dimensions these can coincide with the column's manifest values; for
  derived dimensions (JSONB, CASE) they cannot live on a column and must
  stay here.

## Why these fields appear in both

| field | justification |
|---|---|
| `description` | Column descriptions narrate storage. Dimension descriptions narrate analytic use of that column (often under an alias like `thread_id`). The two are authored by different audiences and read by different consumers (discover tool, SQL-agent context, entity registry). |
| `allowed_values` | Column-level values are the authoritative set for that storage column. Dimension-level values are the set an analyst writing SQL through this dimension should see; a derived/JSONB dimension's set can't live on a column. |
| `ordering` | Same as `allowed_values` — category ordering for an ordered-categorical dimension is part of its analytic contract, not the column's storage contract. |

## Fields owned exclusively by the semantic model

- `expression` — manifest is column-level; SQL text has no home there.
- `name` alias distinct from `expression` — manifest keys by column name,
  not business alias.
- `context_keys` under `tables.<table>` — JSONB path hints for the outer
  prompt. Manifest does not represent JSONB keys.

## Fields owned exclusively by the manifest

- `role`, `data_type`, `semantic_type` — the 3-axis taxonomy (CLAUDE.md).
  Propagates to pg_description and then into SQL-agent hints.
- `synonyms`, `unit`, `measure_kind`, `chartable` — column-level metadata
  with no dimension-level analogue.

## Drift policy

If a field truly overlaps 1:1 between a column and its semantic dimension and
nobody reads the dimension-level copy, delete the dimension-level copy. If
both copies are read, they each describe a different concept — keep them and
make sure the wording reflects that difference.
