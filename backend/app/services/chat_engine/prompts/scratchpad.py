"""Layer 4: session scratchpad rendered each turn."""
from __future__ import annotations

from typing import Any

_MAX_FINDINGS = 15
_MAX_ERRORS = 5


def render(session: dict[str, Any]) -> str:
    pad = session.get('scratchpad')
    if not pad:
        return ''

    findings = pad.get('findings', [])
    composed = pad.get('composed_report')
    errors = pad.get('errors', [])

    if not findings and not composed and not errors:
        return ''

    lines = ['SESSION STATE:']

    if findings:
        lines.append('Findings so far:')
        for finding in findings[-_MAX_FINDINGS:]:
            lines.append(f'- {finding}')

    if composed:
        name = composed.get('name', 'Untitled')
        sections = composed.get('sections', [])
        section_text = ', '.join(sections) if sections else 'no sections'
        lines.append(f'Current composed report: "{name}" ({section_text})')

    if errors:
        lines.append('Recent errors:')
        for error in errors[-_MAX_ERRORS:]:
            lines.append(f'- {error}')

    return '\n'.join(lines)
