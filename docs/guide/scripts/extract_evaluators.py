#!/usr/bin/env python3
"""Extract evaluator constants from seed_defaults.py and output JSON.

Called by sync-data.ts during `npm run sync`.
Reads the Python source, isolates the constant definitions (schemas + evaluator
lists), executes them in a sandboxed namespace, and prints JSON to stdout.

No external dependencies required — uses only stdlib.
"""
import json
import sys
from pathlib import Path

SEED_FILE = Path(__file__).resolve().parents[3] / "backend" / "app" / "services" / "seed_defaults.py"


def extract_constants(source: str) -> str:
    """Return the slice of source containing only constant definitions.

    Strategy: grab everything from the first '_MER_SCHEMA' or
    'KAIRA_BOT_EVALUATORS' definition up to (but not including) the first
    `async def` or `def seed_` line, which marks runtime code.
    """
    # Find where constants start — first shared schema or evaluator list
    start_markers = ["_MER_SCHEMA", "KAIRA_BOT_EVALUATORS"]
    start = len(source)
    for marker in start_markers:
        idx = source.find(f"\n{marker}")
        if idx != -1 and idx < start:
            start = idx

    if start == len(source):
        raise ValueError("Could not find evaluator constants in seed_defaults.py")

    # Find where runtime code starts
    end_markers = ["\nasync def ", "\ndef seed_"]
    end = len(source)
    for marker in end_markers:
        idx = source.find(marker, start)
        if idx != -1 and idx < end:
            end = idx

    return source[start:end]


def main() -> None:
    if not SEED_FILE.exists():
        print(json.dumps({"error": f"seed_defaults.py not found at {SEED_FILE}"}))
        sys.exit(1)

    source = SEED_FILE.read_text(encoding="utf-8")

    try:
        constants_code = extract_constants(source)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    # Execute constants in an isolated namespace
    namespace: dict = {"True": True, "False": False, "None": None}
    try:
        exec(compile(constants_code, "seed_defaults_constants", "exec"), namespace)
    except Exception as e:
        print(json.dumps({"error": f"exec failed: {e}"}))
        sys.exit(1)

    # Collect results
    result = {}

    if "KAIRA_BOT_EVALUATORS" in namespace:
        result["kaira_bot"] = namespace["KAIRA_BOT_EVALUATORS"]

    if "VOICE_RX_UPLOAD_EVALUATORS" in namespace:
        result["voice_rx_upload"] = namespace["VOICE_RX_UPLOAD_EVALUATORS"]

    if "VOICE_RX_API_EVALUATORS" in namespace:
        result["voice_rx_api"] = namespace["VOICE_RX_API_EVALUATORS"]

    if not result:
        print(json.dumps({"error": "No evaluator constants found in namespace"}))
        sys.exit(1)

    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
