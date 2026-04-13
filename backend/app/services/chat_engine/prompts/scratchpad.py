"""Layer 4: session scratchpad rendered each turn."""
from __future__ import annotations

from typing import Any

_MAX_FINDINGS = 15
_MAX_ERRORS = 5
_MAX_DISCOVERY_DIMENSIONS = 6
_MAX_LOOKUPS = 5


def render(session: dict[str, Any]) -> str:
    pad = session.get('scratchpad')
    if not pad:
        return ''

    findings = pad.get('findings', [])
    composed = pad.get('composed_report')
    errors = pad.get('errors', [])
    discovery = pad.get('discovery')
    lookups = pad.get('lookups', {})

    if not findings and not composed and not errors and not discovery and not lookups:
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

    if discovery:
        dimensions = discovery.get('dimensions', [])
        metrics = discovery.get('metrics', [])
        time_range = discovery.get('time_range') or {}
        earliest = time_range.get('earliest')
        latest = time_range.get('latest')
        lines.append(
            f'Discovery cache: {len(dimensions)} dimensions, {len(metrics)} metrics'
            + (f', range {earliest} to {latest}' if earliest and latest else '')
        )
        for dimension in dimensions[:_MAX_DISCOVERY_DIMENSIONS]:
            values = [
                str(item.get('value'))
                for item in dimension.get('values', [])[:3]
                if item.get('value') not in (None, '')
            ]
            sample = ', '.join(values) if values else 'no sample values'
            lines.append(f"- {dimension.get('name', 'unknown')}: {sample}")

    if lookups:
        lines.append('Resolved values:')
        for dimension, result in list(lookups.items())[-_MAX_LOOKUPS:]:
            values = [
                str(item.get('value'))
                for item in result.get('values', [])[:3]
                if item.get('value') not in (None, '')
            ]
            sample = ', '.join(values) if values else 'no matches'
            lines.append(f'- {dimension}: {sample}')

    if errors:
        lines.append('Recent errors:')
        for error in errors[-_MAX_ERRORS:]:
            lines.append(f'- {error}')

    return '\n'.join(lines)
