"""Every arm of SherlockPart must be instantiated by production code.

This is the win-criteria test for the Sherlock contract layer: if a Part
class is defined in the discriminated union but never constructed
anywhere under ``app/services/sherlock_v3/`` or ``app/routes/``, the
typed-vocabulary promise is broken — the FE will eventually render a
view for that arm that the BE never produces. This test fails fast.

The intent is structural, not semantic: we accept any production call
site that names the class, not just ``emitter.emit(X(...))``. That keeps
the test resilient to helper layering without letting purely-tested
arms slip through.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path
from typing import Union, get_args, get_origin

from app.services.sherlock_v3.contracts.parts import SherlockPart


REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_ROOTS = (
    REPO_ROOT / 'app' / 'services' / 'sherlock_v3',
    REPO_ROOT / 'app' / 'routes',
)


def _union_arms(annotation) -> list[type]:
    """Unwrap Annotated → Union to the list of concrete classes."""
    args = get_args(annotation)
    if not args:
        return [annotation] if isinstance(annotation, type) else []
    first = args[0]
    if get_origin(first) is Union:
        return [a for a in get_args(first) if isinstance(a, type)]
    if get_origin(annotation) is Union:
        return [a for a in args if isinstance(a, type)]
    return [a for a in args if isinstance(a, type)]


class SherlockPartVocabularyCoverageTests(unittest.TestCase):
    def test_every_part_arm_is_instantiated_in_production_code(self) -> None:
        arms = _union_arms(SherlockPart)
        self.assertTrue(arms, 'SherlockPart should be a non-empty discriminated union')

        production_text = '\n'.join(
            path.read_text(encoding='utf-8')
            for root in PRODUCTION_ROOTS
            if root.exists()
            for path in root.rglob('*.py')
            if 'contracts' not in path.parts
        )

        missing: list[str] = []
        for arm in arms:
            pattern = re.compile(rf'\b{re.escape(arm.__name__)}\s*\(')
            if not pattern.search(production_text):
                missing.append(arm.__name__)

        self.assertEqual(
            [], missing,
            f'These SherlockPart arms are defined but never instantiated by '
            f'production code under {[str(p) for p in PRODUCTION_ROOTS]}: '
            f'{missing}. Either emit them somewhere real or remove them from '
            f'the union — dead arms in a typed contract are a regression risk.',
        )


if __name__ == '__main__':
    unittest.main()
