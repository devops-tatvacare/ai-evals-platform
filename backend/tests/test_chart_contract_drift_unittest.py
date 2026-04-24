"""Drift guard for the chart-contract codegen pipeline.

Replaces the ``.github/workflows/chart-contract-drift.yml`` CI check. Runs
``npm run codegen:chart-contract`` against a pristine copy of the generated
outputs and fails if the regenerated artifacts do not match what is committed
under ``src/features/chat-widget/generated/``.

Skips (rather than failing) when Node or the codegen deps are unavailable, so
running the backend suite in a Node-less environment (e.g. a minimal Docker
image) stays green.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import tempfile
import unittest


_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
_GENERATED_DIR = _REPO_ROOT / 'src' / 'features' / 'chat-widget' / 'generated'
_GENERATED_FILES = (
    'chartContract.schema.json',
    'chartContract.ts',
    'chartContract.validator.ts',
)


class ChartContractDriftTests(unittest.TestCase):
    def test_generated_artifacts_match_pydantic_model(self):
        if shutil.which('npm') is None or shutil.which('node') is None:
            self.skipTest('npm/node unavailable; skipping drift check')
        if not (_REPO_ROOT / 'node_modules').exists():
            self.skipTest('node_modules missing; run `npm install` to enable drift check')

        for name in _GENERATED_FILES:
            if not (_GENERATED_DIR / name).exists():
                self.fail(f'expected generated artifact missing: {name}')

        with tempfile.TemporaryDirectory() as tmpdir:
            backup = pathlib.Path(tmpdir)
            for name in _GENERATED_FILES:
                shutil.copy2(_GENERATED_DIR / name, backup / name)

            try:
                result = subprocess.run(
                    ['npm', 'run', '--silent', 'codegen:chart-contract'],
                    cwd=_REPO_ROOT,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode != 0:
                    self.fail(
                        'codegen:chart-contract failed:\n'
                        f'stdout:\n{result.stdout}\n'
                        f'stderr:\n{result.stderr}'
                    )

                drift = []
                for name in _GENERATED_FILES:
                    regenerated = (_GENERATED_DIR / name).read_bytes()
                    committed = (backup / name).read_bytes()
                    if regenerated != committed:
                        drift.append(name)

                if drift:
                    self.fail(
                        'chart-contract codegen drift detected for: '
                        f'{", ".join(drift)}. Run '
                        "'npm run codegen:chart-contract' locally and commit "
                        'the result.'
                    )
            finally:
                for name in _GENERATED_FILES:
                    shutil.copy2(backup / name, _GENERATED_DIR / name)


if __name__ == '__main__':
    unittest.main()
