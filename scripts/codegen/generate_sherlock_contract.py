"""Regenerate the frontend SherlockPart contract (types + JSON schema + runtime validator) from the backend Pydantic union.

Invocation:

    PYTHONPATH=backend python scripts/codegen/generate_sherlock_contract.py

Runs as the first half of the ``npm run codegen:sherlock-contract`` pipeline.
The second half (``json-schema-to-typescript`` + ``ajv`` precompile) is driven
by ``scripts/codegen/generate_sherlock_contract.js`` via the npm script so we
don't split tooling between Python and Node on the same step.

Output paths (deterministic, written atomically):

- ``src/features/sherlock/generated/sherlockContract.schema.json``
- ``src/features/sherlock/generated/sherlockContract.ts``    (via JS step)
- ``src/features/sherlock/generated/sherlockContract.validator.ts`` (JS step)

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
    / 'sherlock'
    / 'generated'
    / 'sherlockContract.schema.json'
)


def _annotate_freeform_fields(node: object) -> None:
    """Tell ``json-schema-to-typescript`` to emit ``unknown`` for Pydantic ``Any`` fields.

    Pydantic emits ``Any`` as a schema with only ``default``/``title`` — no
    ``type``. ``json-schema-to-typescript`` infers object-shape from untyped
    schemas, which would land payload-style fields as ``{ [k: string]: unknown }``.
    The ``tsType`` vendor key is the documented override: it makes the
    generator emit the exact TS type verbatim.
    """

    if isinstance(node, dict):
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
    from app.services.sherlock_v3.contracts import sherlock_part_json_schema

    schema = sherlock_part_json_schema()
    _annotate_freeform_fields(schema)
    schema.setdefault('title', 'SherlockPart')
    schema['$id'] = (
        'https://ai-evals-platform/schemas/sherlock_v3/sherlock_contract.json'
    )

    rendered = json.dumps(schema, indent=2, sort_keys=True) + '\n'

    _OUT_SCHEMA.parent.mkdir(parents=True, exist_ok=True)
    _OUT_SCHEMA.write_text(rendered)
    print(f'wrote {_OUT_SCHEMA.relative_to(_REPO_ROOT)} ({len(rendered)} bytes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
