"""Phase 6 §739, §741, §743, §745 — regenerate the frontend ChartPayload
contract (types + JSON schema + runtime validator) from the backend
Pydantic model.

Invocation:

    PYTHONPATH=backend python scripts/codegen/generate_chart_contract.py

Runs as the first half of the ``npm run codegen:chart-contract`` pipeline.
The second half (``json-schema-to-typescript`` + ``ajv`` precompile) is
driven by ``scripts/codegen/generate_chart_contract.js`` via the npm
script so we don't split tooling between Python and Node on the same step.

Output paths (deterministic, written atomically):

- ``src/features/chat-widget/generated/chartContract.schema.json``
- ``src/features/chat-widget/generated/chartContract.ts``    (via JS step)
- ``src/features/chat-widget/generated/chartContract.validator.ts`` (JS step)

This file only emits the canonical JSON Schema — the Node side consumes it.
"""

from __future__ import annotations

import json
import pathlib


_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
_OUT_SCHEMA = (
    _REPO_ROOT
    / 'src'
    / 'features'
    / 'chat-widget'
    / 'generated'
    / 'chartContract.schema.json'
)


def _annotate_freeform_fields(node: object) -> None:
    """Walk the schema; tell ``json-schema-to-typescript`` to emit ``unknown``
    for Pydantic ``Any`` fields.

    Pydantic emits ``Any`` as a schema with only ``default``/``title`` — no
    ``type``. ``json-schema-to-typescript`` infers object-shape from untyped
    schemas, so ``ChartSummaryField.value`` (backend ``Any``) would land as
    ``{ [k: string]: unknown }``. The ``tsType`` vendor key is the documented
    override: it makes the generator emit the exact TS type verbatim.
    """

    if isinstance(node, dict):
        # A property schema that carries ``title`` + ``default`` but no
        # structural keys is a Pydantic-emitted ``Any`` field.
        structural = {
            'type', 'anyOf', 'allOf', 'oneOf', 'enum', 'const',
            'items', 'properties', '$ref', 'tsType',
        }
        if 'title' in node and not (structural & node.keys()):
            node['tsType'] = 'unknown'
        for value in node.values():
            _annotate_freeform_fields(value)
    elif isinstance(node, list):
        for item in node:
            _annotate_freeform_fields(item)


def main() -> int:
    # Import late: ``PYTHONPATH=backend`` must be set so ``app.*`` resolves.
    from app.services.report_builder.chart_contract import chart_payload_json_schema

    schema = chart_payload_json_schema()
    _annotate_freeform_fields(schema)
    # Decorate the root schema so ``json-schema-to-typescript`` names the
    # root type ``ChartPayload`` rather than a generic ``_Main``.
    schema.setdefault('title', 'ChartPayload')
    schema['$id'] = (
        'https://ai-evals-platform/schemas/report_builder/chart_contract.json'
    )

    rendered = json.dumps(schema, indent=2, sort_keys=True) + '\n'

    _OUT_SCHEMA.parent.mkdir(parents=True, exist_ok=True)
    _OUT_SCHEMA.write_text(rendered)
    print(f'wrote {_OUT_SCHEMA.relative_to(_REPO_ROOT)} ({len(rendered)} bytes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
