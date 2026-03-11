"""Self-contained HTML template for PDF report generation.

Generates a complete HTML document with inline styles from a ReportPayload dict.
Rendered by Playwright via page.set_content() — no network dependency.
All design is mirrored from the React report components.
"""

from __future__ import annotations

import html
import re
from datetime import datetime


# ── Color constants (mirrored from shared/colors.ts) ────────────

def _grade_hex(grade: str) -> str:
    if grade.startswith("A") or grade.startswith("B"):
        return "#10b981"
    if grade.startswith("C"):
        return "#f59e0b"
    return "#ef4444"


def _metric_color(value: float) -> str:
    if value >= 80:
        return "#10B981"
    if value >= 60:
        return "#F59E0B"
    return "#EF4444"


_VERDICT_COLORS = {
    "PASS": "#16a34a", "NOT APPLICABLE": "#6b7280",
    "SOFT FAIL": "#ca8a04", "HARD FAIL": "#dc2626", "CRITICAL": "#7c2d12",
    "EFFICIENT": "#16a34a", "ACCEPTABLE": "#3b82f6",
    "INCOMPLETE": "#6b7280", "FRICTION": "#ca8a04", "BROKEN": "#dc2626",
    "FAIL": "#dc2626", "ERROR": "#6b7280",
}

_SEVERITY_COLORS = {"LOW": "#6b7280", "MEDIUM": "#F59E0B", "HIGH": "#EF4444", "CRITICAL": "#7c2d12"}

_PRIORITY_DOT = {"P0": "#ef4444", "P1": "#f59e0b", "P2": "#3b82f6"}
_PRIORITY_LABEL = {"P0": "P0 · CRITICAL", "P1": "P1 · HIGH", "P2": "P2 · MEDIUM"}

_GAP_DOT = {"UNDERSPEC": "#3b82f6", "SILENT": "#f59e0b", "LEAKAGE": "#ef4444", "CONFLICTING": "#8b5cf6"}
_GAP_BG = {"UNDERSPEC": "#dbeafe", "SILENT": "#fef3c7", "LEAKAGE": "#fee2e2", "CONFLICTING": "#ede9fe"}
_GAP_TEXT = {"UNDERSPEC": "#1e40af", "SILENT": "#92400e", "LEAKAGE": "#991b1b", "CONFLICTING": "#5b21b6"}
_GAP_DESC = {
    "UNDERSPEC": "Prompt lacks explicit guidance on behavior that evaluation rules expect.",
    "SILENT": "Prompt doesn't address a rule at all — expected behavior is neither required nor prohibited.",
    "LEAKAGE": "Internal evaluation criteria are leaking into the prompt, potentially biasing the agent.",
    "CONFLICTING": "Prompt actively contradicts what evaluation rules require.",
}

_RECOVERY_COLORS = {"GOOD": "#10B981", "PARTIAL": "#F59E0B", "FAILED": "#EF4444", "NOT_NEEDED": "#6b7280"}
_CAUSE_COLORS = {"bot": "#EF4444", "user": "#3b82f6"}
_DIFFICULTY_COLORS = {"EASY": "#10B981", "MEDIUM": "#F59E0B", "HARD": "#EF4444"}


def _rank_to_priority(rank: int) -> str:
    if rank <= 1: return "P0"
    if rank <= 3: return "P1"
    return "P2"


def _verdict_label(key: str) -> str:
    if key == "NOT APPLICABLE": return "N/A"
    if key == "NOT_NEEDED": return "Not Needed"
    return " ".join(w.capitalize() for w in re.split(r"[\s_]+", key))


def _esc(text: str | None) -> str:
    return html.escape(str(text)) if text else ""


def _parse_impact(raw: str) -> str:
    """Parse impact strings like '-12 `foo` failures' into styled segments."""
    parts = [p.strip() for p in raw.replace("`", "").split(",") if p.strip()]
    out = []
    for part in parts:
        m = re.match(r"^([+-])(\d+)\s+(.+)$", part)
        if m:
            arrow = "↓" if m.group(1) == "-" else "↑"
            out.append(
                f'<span style="color:#10B981">{arrow}{m.group(2)} '
                f'<code style="background:#d1fae5;padding:1px 4px;border-radius:3px;font-size:10px">'
                f'{_esc(m.group(3))}</code></span>'
            )
        else:
            out.append(f'<span style="color:#64748b">{_esc(part)}</span>')
    return "<br>".join(out) if out else "&mdash;"


# ── Shared HTML building blocks ─────────────────────────────────

def _section_header(title: str, description: str = "") -> str:
    desc = f'<p style="font-size:11px;color:#64748b;margin:4px 0 0">{_esc(description)}</p>' if description else ""
    return f"""
    <div class="section-header" style="margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #e2e8f0">
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#0f172a;margin:0">
        {_esc(title)}
      </h2>
      {desc}
    </div>"""


def _segmented_bar(segments: list[tuple[str, int, str]], height: int = 28, show_values: bool = True) -> str:
    filtered = [(l, v, c) for l, v, c in segments if v > 0]
    total = sum(v for _, v, _ in filtered) or 1
    bar_parts = ""
    for label, value, color in filtered:
        show = str(round(value)) if show_values and value / total >= 0.08 else ""
        bar_parts += (
            f'<div style="flex:{value};background:{color};display:flex;align-items:center;'
            f'justify-content:center;font-size:11px;font-weight:700;color:#fff;min-width:16px">'
            f'{show}</div>'
        )
    legend = ""
    for label, value, color in filtered:
        legend += (
            f'<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#475569;margin-right:12px">'
            f'<span style="width:8px;height:8px;border-radius:50%;background:{color};flex-shrink:0"></span>'
            f'{_esc(label)}: {round(value)}</span>'
        )
    return f"""
    <div style="display:flex;border-radius:6px;overflow:hidden;height:{height}px;margin-bottom:8px">
      {bar_parts}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">{legend}</div>"""


def _table_header(*cols: tuple[str, str, int | None]) -> str:
    """Build a table header row. Each col: (label, alignment, width_px or None)."""
    cells = ""
    for label, align, width in cols:
        w = f"width:{width}px;" if width else ""
        cells += (
            f'<th style="{w}text-align:{align};padding:6px 8px;font-size:10px;font-weight:600;'
            f'color:#64748b;text-transform:uppercase;letter-spacing:0.4px">{label}</th>'
        )
    return f'<thead><tr style="border-bottom:2px solid #e2e8f0">{cells}</tr></thead>'


# ── Main render function ────────────────────────────────────────

def render_report_html(data: dict) -> str:
    """Build a complete HTML page from a ReportPayload dict (camelCase keys)."""
    meta = data.get("metadata", {})
    hs = data.get("healthScore", {})
    breakdown = hs.get("breakdown", {})
    narrative = data.get("narrative") or {}
    distributions = data.get("distributions", {})
    rule_compliance = data.get("ruleCompliance", {})
    friction = data.get("friction", {})
    adversarial = data.get("adversarial")
    exemplars = data.get("exemplars", {})

    is_adversarial = meta.get("evalType") == "batch_adversarial"
    thread_label = "tests" if is_adversarial else "threads"

    # Format date
    created_at = meta.get("createdAt", "")
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        formatted_date = dt.strftime("%d %b %Y")
    except Exception:
        formatted_date = created_at[:10] if created_at else ""

    grade = hs.get("grade", "?")
    numeric = round(hs.get("numeric", 0))

    if is_adversarial:
        metric_labels = ["Pass Rate", "Goal Achievement", "Rule Compliance", "Difficulty Score"]
    else:
        metric_labels = ["Intent Accuracy", "Correctness", "Efficiency", "Task Completion"]
    metric_keys = ["intentAccuracy", "correctnessRate", "efficiencyRate", "taskCompletion"]

    metrics = []
    for label, key in zip(metric_labels, metric_keys):
        item = breakdown.get(key, {})
        metrics.append((label, round(item.get("value", 0))))

    sections: list[str] = []

    # ── Compact header bar (matches on-screen report-actions bar) ──
    meta_parts = [
        f'{meta.get("completedThreads", 0)} {thread_label}',
        _esc(meta.get("evalType", "")),
    ]
    if meta.get("llmModel"):
        meta_parts.append(_esc(meta["llmModel"]))
    if formatted_date:
        meta_parts.append(formatted_date)
    meta_text = " &middot; ".join(meta_parts)

    sections.append(f"""
    <div style="display:flex;align-items:center;gap:14px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:10px 16px;margin-bottom:20px">
      <div style="width:40px;height:40px;border-radius:50%;background:{_grade_hex(grade)};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:14px;font-weight:bold;color:#fff">{_esc(grade)}</span>
      </div>
      <div style="display:flex;align-items:center">
        <span style="font-size:20px;font-weight:bold;color:#0f172a;line-height:1">{numeric}</span>
        <span style="font-size:13px;color:#94a3b8;margin-left:6px;line-height:1">/ 100</span>
      </div>
      <div style="font-size:11px;color:#64748b;display:flex;align-items:center;flex-wrap:wrap;gap:4px;line-height:1">
        {meta_text}
      </div>
    </div>
    """)

    # ── Executive Summary ───────────────────────────────────────
    exec_summary = narrative.get("executiveSummary", "")
    metric_row = ""
    for label, val in metrics:
        c = _metric_color(val)
        metric_row += f"""
        <div style="display:inline-flex;align-items:center;gap:6px;margin-right:20px">
          <span style="font-size:11px;color:#64748b">{label}</span>
          <span style="font-size:13px;font-weight:700;color:{c}">{val}%</span>
          <div style="width:48px;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden">
            <div style="width:{val}%;height:100%;border-radius:3px;background:{c}"></div>
          </div>
        </div>"""

    summary_box = ""
    if exec_summary:
        summary_box = f"""
        <div class="section-block" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:16px">
          <p style="font-size:13px;line-height:1.6;color:#475569;margin:0">{_esc(exec_summary)}</p>
        </div>"""
    else:
        summary_box = '<p style="font-size:13px;color:#94a3b8;font-style:italic">AI narrative was not generated for this report.</p>'

    sections.append(f"""
    {_section_header("Executive Summary", "Health metrics and AI-generated assessment of this evaluation run")}
    <div style="display:flex;flex-wrap:wrap;align-items:center;padding:10px 0;margin-bottom:16px">{metric_row}</div>
    {summary_box}
    """)

    # ── Top Issues ──────────────────────────────────────────────
    top_issues = narrative.get("topIssues", [])
    if top_issues:
        rows = ""
        for i, issue in enumerate(top_issues):
            p = _rank_to_priority(issue.get("rank", 99))
            bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
            rows += f"""
            <tr style="background:{bg}">
              <td style="padding:8px;width:20px;vertical-align:top"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{_PRIORITY_DOT.get(p, '#6b7280')}"></span></td>
              <td style="padding:8px;font-weight:600;color:#0f172a;vertical-align:top">{_esc(issue.get('description'))}</td>
              <td style="padding:8px;color:#64748b;white-space:nowrap;vertical-align:top">{_esc(issue.get('area'))}</td>
              <td style="padding:8px;text-align:right;color:#64748b;vertical-align:top">{issue.get('affectedCount', 0)}</td>
            </tr>"""
        sections.append(f"""
        <div style="margin-bottom:24px">
          <h3 style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:8px">Top Issues</h3>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:12px">
            {_table_header(("", "left", 20), ("Issue", "left", None), ("Focus Area", "left", None), ("Affected", "right", None))}
            <tbody>{rows}</tbody>
          </table>
        </div>""")

    # ── Verdict Distributions ───────────────────────────────────
    correctness = distributions.get("correctness", {})
    efficiency = distributions.get("efficiency", {})
    intent_hist = distributions.get("intentHistogram", {})
    adv_dist = distributions.get("adversarial")

    c_order = ["PASS", "NOT APPLICABLE", "SOFT FAIL", "HARD FAIL", "CRITICAL"]
    e_order = ["EFFICIENT", "ACCEPTABLE", "INCOMPLETE", "FRICTION", "BROKEN"]

    def _ordered_segs(d: dict, order: list[str]) -> list[tuple[str, int, str]]:
        known = [k for k in order if d.get(k, 0) > 0]
        unknown = [k for k in d if d[k] > 0 and k not in order]
        return [(_verdict_label(k), d[k], _VERDICT_COLORS.get(k, "#6b7280")) for k in known + unknown]

    dist_html = f'{_section_header("Verdict Distributions", "How threads were classified across correctness, efficiency, and intent accuracy" if not is_adversarial else "How test cases were classified by adversarial verdict")}'

    # Adversarial bar (prominent if adversarial) + category/difficulty bars
    if is_adversarial and adv_dist:
        adv_segs = _ordered_segs(adv_dist, ["PASS", "SOFT FAIL", "FAIL", "HARD FAIL"])
        adv_grid = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:20px">'
        adv_grid += '<div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Adversarial Verdicts</h3>'
        adv_grid += _segmented_bar(adv_segs) + '</div>'

        # Goal bar from adversarial breakdown
        by_goal = adversarial.get("byGoal", []) if adversarial else []
        if by_goal:
            goal_segs = [(_esc(g.get("goal", "?")), g.get("passed", 0), "#16a34a") for g in by_goal if g.get("passed", 0) > 0]
            if goal_segs:
                goal_legend = ", ".join(f'{_esc(g.get("goal","?"))}: {g.get("passed",0)}/{g.get("total",0)}' for g in by_goal)
                adv_grid += '<div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">By Goal</h3>'
                adv_grid += _segmented_bar(goal_segs)
                adv_grid += f'<p style="font-size:10px;color:#64748b;margin-top:6px">{goal_legend}</p></div>'

        # Difficulty bar
        by_diff = adversarial.get("byDifficulty", []) if adversarial else []
        if by_diff:
            diff_segs = [(_esc(d.get("difficulty", "?")), d.get("passed", 0), _DIFFICULTY_COLORS.get(d.get("difficulty", ""), "#6b7280")) for d in by_diff if d.get("passed", 0) > 0]
            if diff_segs:
                diff_legend = ", ".join(f'{_esc(d.get("difficulty","?"))}: {d.get("passed",0)}/{d.get("total",0)}' for d in by_diff)
                adv_grid += '<div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">By Difficulty</h3>'
                adv_grid += _segmented_bar(diff_segs)
                adv_grid += f'<p style="font-size:10px;color:#64748b;margin-top:6px">{diff_legend}</p></div>'

        adv_grid += '</div>'
        dist_html += adv_grid

    # 3-col grid: correctness, efficiency, intent
    bars_html = ""
    if correctness:
        bars_html += f'<div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Correctness</h3>{_segmented_bar(_ordered_segs(correctness, c_order))}</div>'
    if efficiency:
        bars_html += f'<div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Efficiency</h3>{_segmented_bar(_ordered_segs(efficiency, e_order))}</div>'
    if intent_hist:
        buckets = intent_hist.get("buckets", [])
        counts = intent_hist.get("counts", [])
        high = med = low = 0
        for b, c in zip(buckets, counts):
            try:
                # Handle both "80" and "80-90" style bucket names
                start = int(str(b).split("-")[0].strip())
            except (ValueError, TypeError):
                continue
            if start >= 80: high += c
            elif start >= 50: med += c
            else: low += c
        if high or med or low:
            bars_html += f'<div><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Intent Accuracy</h3>{_segmented_bar([("High (≥80%)", high, "#16a34a"), ("Medium (50–79%)", med, "#ca8a04"), ("Low (<50%)", low, "#dc2626")])}</div>'

    if bars_html:
        # Count actual columns for proper grid sizing
        col_count = bars_html.count("<div><h3")
        dist_html += f'<div style="display:grid;grid-template-columns:repeat({col_count},1fr);gap:20px;margin-bottom:20px">{bars_html}</div>'

    # Non-adversarial adversarial bar
    if not is_adversarial and adv_dist:
        adv_segs = _ordered_segs(adv_dist, ["PASS", "SOFT FAIL", "FAIL", "HARD FAIL"])
        dist_html += '<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Adversarial Verdicts</h3>'
        dist_html += _segmented_bar(adv_segs)

    sections.append(dist_html)

    # ── Rule Compliance ─────────────────────────────────────────
    rules = rule_compliance.get("rules", [])
    co_failures = rule_compliance.get("coFailures", [])
    if rules:
        good = sum(1 for r in rules if r.get("rate", 0) >= 0.8)
        med = sum(1 for r in rules if 0.5 <= r.get("rate", 0) < 0.8)
        bad = sum(1 for r in rules if r.get("rate", 0) < 0.5)

        summary_bar = _segmented_bar([
            (f"≥80%: {good} rules", good, "#10b981"),
            (f"50–79%: {med} rules", med, "#f59e0b"),
            (f"<50%: {bad} rules", bad, "#ef4444"),
        ], height=8, show_values=False)

        rows = ""
        for i, rule in enumerate(rules):
            rate = round(rule.get("rate", 0) * 100)
            rc = _metric_color(rate)
            bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
            if rule.get("rate", 0) < 0.5:
                bg = "#fef2f2"
            rows += f"""
            <tr style="background:{bg}">
              <td style="padding:8px;width:20px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{_SEVERITY_COLORS.get(rule.get('severity', ''), '#6b7280')}"></span></td>
              <td style="padding:8px;font-family:monospace;font-size:11px;color:#0f172a">{_esc(rule.get('ruleId'))}</td>
              <td style="padding:8px;color:#475569">{_esc(rule.get('section'))}</td>
              <td style="padding:8px;text-align:right;color:#0f172a">{rule.get('passed', 0)}</td>
              <td style="padding:8px;text-align:right;color:#0f172a">{rule.get('failed', 0)}</td>
              <td style="padding:8px;text-align:right">
                <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px">
                  <div style="width:96px;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden">
                    <div style="width:{rate}%;height:100%;border-radius:3px;background:{rc}"></div>
                  </div>
                  <span style="font-size:11px;font-weight:600;color:{rc};min-width:32px;text-align:right">{rate}%</span>
                </div>
              </td>
            </tr>"""

        co_html = ""
        if co_failures:
            co_items = ""
            for cf in co_failures:
                co_items += f"""
                <div class="section-block" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:8px 12px;background:#fffbeb;border-radius:6px;border-left:3px solid #f59e0b;font-size:12px;color:#475569;margin-bottom:6px">
                  When <code style="font-family:monospace;font-weight:600;color:#0f172a">{_esc(cf.get('ruleA'))}</code> fails,
                  <code style="font-family:monospace;font-weight:600;color:#0f172a">{_esc(cf.get('ruleB'))}</code> also fails in
                  <span style="font-weight:600">{round(cf.get('coOccurrenceRate', 0) * 100)}%</span> of cases.
                </div>"""
            co_html = f'<div style="margin-top:12px"><h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Co-Failure Patterns</h3>{co_items}</div>'

        sections.append(f"""
        {_section_header("Rule Compliance Analysis", "Pass/fail rates for each evaluation rule, sorted by compliance")}
        <div style="margin-bottom:16px">
          <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Overall Compliance: {len(rules)} rules</p>
          {summary_bar}
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:12px">
          {_table_header(("", "left", 20), ("Rule", "left", None), ("Section", "left", None), ("Pass", "right", None), ("Fail", "right", None), ("Rate", "right", 180))}
          <tbody>{rows}</tbody>
        </table>
        {co_html}
        """)

    # ── Friction Analysis (non-adversarial only) ────────────────
    if not is_adversarial and friction:
        total_friction = friction.get("totalFrictionTurns", 0)
        by_cause = friction.get("byCause", {})
        recovery = friction.get("recoveryQuality", {})
        avg_turns = friction.get("avgTurnsByVerdict", {})

        bot = by_cause.get("bot", 0)
        user = by_cause.get("user", 0)

        stat_box = f"""
        <div class="section-block" style="display:flex;align-items:center;justify-content:center;gap:40px;padding:10px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:20px">
          <div style="text-align:center"><p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin:0 0 2px">Total Friction</p><p style="font-size:20px;font-weight:800;color:#0f172a;margin:0">{total_friction}</p></div>
          <div style="text-align:center"><p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin:0 0 2px">Bot-Caused</p><p style="font-size:20px;font-weight:800;color:#ef4444;margin:0">{bot}</p></div>
          <div style="text-align:center"><p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin:0 0 2px">User-Caused</p><p style="font-size:20px;font-weight:800;color:#3b82f6;margin:0">{user}</p></div>
        </div>"""

        bars_grid = ""
        cause_segs = [(k, v, _CAUSE_COLORS.get(k, "#6b7280")) for k, v in by_cause.items() if v > 0]
        rec_segs = [(_verdict_label(k), v, _RECOVERY_COLORS.get(k, "#6b7280")) for k, v in recovery.items() if v > 0 and k != "NOT_NEEDED"]
        vt_order = ["EFFICIENT", "ACCEPTABLE", "FRICTION", "BROKEN"]
        avg_segs = [(_verdict_label(k), round(avg_turns.get(k, 0) * 10) / 10, _VERDICT_COLORS.get(k, "#6b7280")) for k in vt_order if avg_turns.get(k, 0) > 0]

        grid_cols = ""
        if cause_segs:
            grid_cols += f'<div><h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Friction by Cause</h4>{_segmented_bar(cause_segs, height=24)}</div>'
        if rec_segs:
            grid_cols += f'<div><h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Recovery Quality</h4>{_segmented_bar(rec_segs, height=24)}</div>'
        if avg_segs:
            grid_cols += f'<div><h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Avg Turns by Verdict</h4>{_segmented_bar(avg_segs, height=24)}</div>'
        if grid_cols:
            bars_grid = f'<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:20px">{grid_cols}</div>'

        # Top patterns table
        patterns = friction.get("topPatterns", [])
        patterns_html = ""
        if patterns:
            p_rows = ""
            for i, pat in enumerate(patterns):
                bg = "#fffbeb" if i == 0 else ("#ffffff" if i % 2 == 1 else "#f8fafc")
                threads = ", ".join(pat.get("exampleThreadIds", [])[:3])
                p_rows += f"""
                <tr style="background:{bg}">
                  <td style="padding:8px;color:#64748b">{i + 1}</td>
                  <td style="padding:8px;font-weight:500;color:#0f172a">{_esc(pat.get('description'))}</td>
                  <td style="padding:8px;text-align:right;font-weight:600;color:#0f172a">{pat.get('count', 0)}</td>
                  <td style="padding:8px;font-family:monospace;font-size:10px;color:#64748b">{_esc(threads)}</td>
                </tr>"""
            patterns_html = f"""
            <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:10px">Top Friction Patterns</h4>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:12px">
              {_table_header(("#", "left", 28), ("Pattern", "left", None), ("Count", "right", None), ("Example Threads", "left", None))}
              <tbody>{p_rows}</tbody>
            </table>"""

        sections.append(f"""
        {_section_header("Friction & Efficiency Analysis", "Conversation friction points, causes, and recovery quality")}
        {stat_box}{bars_grid}{patterns_html}
        """)

    # ── Adversarial Breakdown ───────────────────────────────────
    if adversarial:
        by_goal = adversarial.get("byGoal", [])
        by_diff = adversarial.get("byDifficulty", [])

        if by_goal:
            sorted_goals = sorted(by_goal, key=lambda g: g.get("passRate", 0))
            goal_rows = ""
            for i, goal_entry in enumerate(sorted_goals):
                rate = round(goal_entry.get("passRate", 0) * 100)
                rc = _metric_color(rate)
                bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
                passed = goal_entry.get("passed", 0)
                total = goal_entry.get("total", 0)
                goal_rows += f"""
                <tr style="background:{bg}">
                  <td style="padding:8px;font-weight:500;color:#0f172a">{_esc(goal_entry.get('goal'))}</td>
                  <td style="padding:8px;text-align:center;color:#10b981">{passed}</td>
                  <td style="padding:8px;text-align:center;color:#ef4444">{total - passed}</td>
                  <td style="padding:8px;text-align:right"><span style="font-weight:600;color:{rc}">{rate}%</span></td>
                </tr>"""
            # Caption line
            caption = ", ".join(
                f'{_esc(g.get("goal"))}: <b>{g.get("passed", 0)}/{g.get("total", 0)}</b> ({round(g.get("passRate", 0)*100)}%)'
                for g in sorted_goals
            )

            goal_html = f"""
            <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:10px">Pass Rate by Goal</h4>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:12px;margin-bottom:8px">
              {_table_header(("Goal", "left", None), ("Passed", "center", None), ("Failed", "center", None), ("Rate", "right", None))}
              <tbody>{goal_rows}</tbody>
            </table>
            <p style="font-size:11px;color:#475569;margin-bottom:16px">{caption}</p>"""
        else:
            goal_html = ""

        diff_html = ""
        if by_diff:
            d_order = ["EASY", "MEDIUM", "HARD"]
            sorted_diff = sorted(by_diff, key=lambda d: d_order.index(d.get("difficulty", "")) if d.get("difficulty", "") in d_order else 99)
            items = ""
            for d in sorted_diff:
                total = d.get("total", 0)
                rate = round(d.get("passed", 0) / total * 100) if total > 0 else 0
                color = _DIFFICULTY_COLORS.get(d.get("difficulty", ""), _metric_color(rate))
                items += f"""
                <div style="margin-right:24px">
                  <span style="font-size:11px;color:#64748b">{_esc(d.get('difficulty'))}</span>
                  <span style="font-size:13px;font-weight:700;color:{color};margin-left:4px">{rate}%</span>
                </div>"""
            diff_html = f'<div style="display:flex;align-items:center;padding:8px 0">{items}</div>'

        sections.append(f"""
        {_section_header("Adversarial Testing Results", "How the bot handled adversarial test scenarios by category and difficulty")}
        {goal_html}{diff_html}
        """)

    # ── Exemplar Threads ────────────────────────────────────────
    analysis_map = {}
    for ea in narrative.get("exemplarAnalysis", []):
        analysis_map[ea.get("threadId", "")] = ea

    def _render_exemplars(threads: list[dict], section_label: str, type_: str) -> str:
        if not threads:
            return ""
        is_good = type_ == "good"
        accent = "#10b981" if is_good else "#ef4444"
        accent_bg = "#f0fdf4" if is_good else "#fef2f2"
        tag_label = "Best" if is_good else "Worst"
        cards = ""
        for t in threads:
            tid = t.get("threadId", "")
            analysis = analysis_map.get(tid)
            valid_msgs = [m for m in t.get("transcript", []) if m.get("content", "").strip()]

            # Header badges
            badges = ""
            if t.get("category"):
                badges += f'<span style="padding:1px 6px;font-size:10px;font-weight:600;border-radius:10px;background:#f3e8ff;color:#7c3aed">{_esc(t["category"])}</span> '
            if t.get("difficulty"):
                dc = {"HARD": ("#fee2e2", "#dc2626"), "MEDIUM": ("#fef3c7", "#d97706"), "EASY": ("#d1fae5", "#059669")}
                dbg, dtx = dc.get(t["difficulty"], ("#f1f5f9", "#475569"))
                badges += f'<span style="padding:1px 6px;font-size:10px;font-weight:600;border-radius:10px;background:{dbg};color:{dtx}">{_esc(t["difficulty"])}</span> '
            if t.get("correctnessVerdict"):
                vc = _VERDICT_COLORS.get(t["correctnessVerdict"], "#6b7280")
                badges += f'<span style="padding:1px 6px;font-size:10px;font-weight:600;border-radius:10px;background:#f1f5f9;color:{vc}">{_esc(t["correctnessVerdict"])}</span> '
            tc = t.get("taskCompleted", False)
            ga = t.get("goalAchieved")
            is_adv_ex = is_adversarial or t.get("category")
            if is_adv_ex:
                tc_label = "Goal Achieved" if ga else "Goal Failed"
            else:
                tc_label = "Complete" if tc else "Incomplete"
            tc_color = "#10b981" if (ga if is_adv_ex else tc) else "#ef4444"
            tc_bg = "#d1fae5" if (ga if is_adv_ex else tc) else "#fee2e2"
            badges += f'<span style="padding:1px 6px;font-size:10px;font-weight:600;border-radius:10px;background:{tc_bg};color:{tc_color}">{tc_label}</span>'

            # AI analysis
            analysis_html = ""
            if analysis:
                what_label = "What happened" if is_good else "What went wrong"
                why_label = "Why it worked" if is_good else "Why it failed"
                analysis_html += f"""
                <div style="margin-bottom:10px">
                  <p style="font-size:12px;color:#0f172a;line-height:1.5;margin-bottom:8px">
                    <span style="display:block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;margin-bottom:2px">{what_label}</span>
                    {_esc(analysis.get('whatHappened'))}
                  </p>
                  <p style="font-size:12px;color:#475569;line-height:1.5">
                    <span style="display:block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;margin-bottom:2px">{why_label}</span>
                    {_esc(analysis.get('why'))}
                  </p>"""
                if analysis.get("promptGap"):
                    analysis_html += f'<p style="font-size:11px;color:#64748b;font-style:italic;margin-top:6px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#f59e0b;margin-right:4px;vertical-align:middle"></span>Prompt gap: {_esc(analysis["promptGap"])}</p>'
                analysis_html += "</div>"
            elif is_adv_ex and t.get("reasoning"):
                analysis_html = f"""
                <div style="margin-bottom:10px">
                  <p style="font-size:12px;color:#475569;line-height:1.5">
                    <span style="display:block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;margin-bottom:2px">Reasoning</span>
                    {_esc(t.get('reasoning'))}
                  </p>
                </div>"""
            else:
                no_analysis_label = "test case" if is_adv_ex else "thread"
                analysis_html = f"""
                <div style="margin-bottom:10px">
                  <p style="font-size:11px;color:#94a3b8;font-style:italic">AI analysis not available for this {no_analysis_label}.</p>
                </div>"""

            # Rule violations (bad only)
            violations_html = ""
            if not is_good and t.get("ruleViolations"):
                chips = " ".join(
                    f'<span style="display:inline-block;padding:2px 6px;font-size:10px;font-family:monospace;font-weight:600;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:4px" title="{_esc(v.get("evidence"))}">{_esc(v.get("ruleId"))}</span>'
                    for v in t["ruleViolations"]
                )
                violations_html = f"""
                <div style="margin-bottom:10px">
                  <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;font-weight:600;margin-bottom:6px">Rule Violations</p>
                  <div style="display:flex;flex-wrap:wrap;gap:4px">{chips}</div>
                </div>"""

            # Failure modes (adversarial)
            fm_html = ""
            if t.get("failureModes"):
                chips = " ".join(
                    f'<span style="display:inline-block;padding:2px 6px;font-size:10px;font-weight:500;background:#ffedd5;color:#c2410c;border-radius:4px">{_esc(m)}</span>'
                    for m in t["failureModes"]
                )
                fm_html = f"""
                <div style="margin-bottom:10px">
                  <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;font-weight:600;margin-bottom:6px">Failure Modes</p>
                  <div style="display:flex;flex-wrap:wrap;gap:4px">{chips}</div>
                </div>"""

            # Transcript
            transcript_html = ""
            if valid_msgs:
                msgs_html = ""
                for msg in valid_msgs[:12]:
                    is_user = msg.get("role") == "user"
                    border_color = "#60a5fa" if is_user else ("#4ade80" if is_good else "#f87171")
                    msg_bg = "#eff6ff" if is_user else ("#f0fdf4" if is_good else "#fef2f2")
                    content = _esc(msg.get("content", "")[:500])
                    msgs_html += f"""
                    <div style="border-left:2px solid {border_color};border-radius:0 4px 4px 0;padding:6px 10px;background:{msg_bg};margin-bottom:4px">
                      <p style="font-size:9px;text-transform:uppercase;letter-spacing:0.3px;font-weight:600;color:#64748b;margin:0 0 2px">{msg.get('role', 'user')}</p>
                      <p style="font-size:11px;font-family:monospace;white-space:pre-wrap;color:#0f172a;line-height:1.4;margin:0">{content}</p>
                    </div>"""
                transcript_html = f"""
                <div style="border-top:1px solid #e2e8f0;padding-top:10px;margin-top:4px">
                  <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;color:#64748b;margin-bottom:6px">Transcript ({len(valid_msgs)} messages)</p>
                  {msgs_html}
                </div>"""

            cards += f"""
            <div class="exemplar-card" style="border:1px solid #e2e8f0;border-left:3px solid {accent};border-radius:8px;overflow:hidden;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:{accent_bg}">
                <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:{accent}">{tag_label}</span>
                <span style="font-size:11px;font-family:monospace;color:#64748b">{_esc(tid[:12])}</span>
                <div style="margin-left:auto;display:flex;align-items:center;gap:4px">{badges}</div>
              </div>
              <div style="padding:12px 14px;background:#ffffff">
                {analysis_html}{fm_html}{violations_html}{transcript_html}
              </div>
            </div>"""

        color = "#10b981" if is_good else "#ef4444"
        return f"""
        <div style="margin-bottom:20px">
          <h3 style="font-size:13px;font-weight:600;color:{color};margin-bottom:10px">{section_label}</h3>
          {cards}
        </div>"""

    exemplar_title = "Exemplar Test Cases" if is_adversarial else "Exemplar Threads"
    exemplar_desc = "Representative best and worst adversarial test cases with AI analysis" if is_adversarial else "Representative best and worst threads with AI analysis"
    best_html = _render_exemplars(exemplars.get("best", []), "Best Examples", "good")
    worst_html = _render_exemplars(exemplars.get("worst", []), "Worst Examples", "bad")
    if best_html or worst_html:
        sections.append(f"""
        {_section_header(exemplar_title, exemplar_desc)}
        {best_html}{worst_html}
        """)

    # ── Prompt Gap Analysis ─────────────────────────────────────
    gaps = narrative.get("promptGaps", [])
    if gaps:
        type_counts: dict[str, int] = {}
        for g in gaps:
            gt = g.get("gapType", "")
            type_counts[gt] = type_counts.get(gt, 0) + 1

        gap_order = ["UNDERSPEC", "SILENT", "LEAKAGE", "CONFLICTING"]
        bar_segs = [
            (f"{_verdict_label(t)}: {type_counts[t]}", type_counts[t], _GAP_DOT.get(t, "#6b7280"))
            for t in gap_order if type_counts.get(t, 0) > 0
        ]

        # Legend
        legend_items = ""
        for t in gap_order:
            if type_counts.get(t, 0) > 0:
                legend_items += f"""
                <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px">
                  <span style="width:8px;height:8px;border-radius:50%;background:{_GAP_DOT.get(t, '#6b7280')};flex-shrink:0;margin-top:3px"></span>
                  <p style="font-size:11px;color:#475569;line-height:1.3;margin:0"><span style="font-weight:600;color:#0f172a">{_verdict_label(t)}</span> — {_GAP_DESC.get(t, '')}</p>
                </div>"""

        gap_rows = ""
        for i, gap in enumerate(gaps):
            bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
            gt = gap.get("gapType", "")
            gap_rows += f"""
            <tr style="background:{bg}">
              <td style="padding:8px;width:20px;vertical-align:top"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{_GAP_DOT.get(gt, '#6b7280')}"></span></td>
              <td style="padding:8px;font-weight:500;color:#0f172a;vertical-align:top">{_esc(gap.get('promptSection')) or '<span style="color:#94a3b8;font-style:italic">(no section)</span>'}</td>
              <td style="padding:8px;font-family:monospace;font-size:11px;color:#475569;vertical-align:top">{_esc(gap.get('evalRule'))}</td>
              <td style="padding:8px;vertical-align:top"><span style="display:inline-block;padding:1px 6px;font-size:9px;font-weight:600;border-radius:10px;background:{_GAP_BG.get(gt, '#f1f5f9')};color:{_GAP_TEXT.get(gt, '#475569')}">{_esc(gt)}</span></td>
              <td style="padding:8px;font-size:11px;color:#475569;vertical-align:top">{_esc(gap.get('description'))}</td>
            </tr>"""
            if gap.get("suggestedFix"):
                gap_rows += f"""
                <tr>
                  <td colspan="5" style="padding:4px 8px 10px;background:{bg}">
                    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:#eff6ff;border-radius:6px;border-left:3px solid #3b82f6;font-size:11px;color:#475569;line-height:1.4;margin-left:28px">
                      <span style="color:#3b82f6;flex-shrink:0;font-size:14px">💡</span>
                      <span>{_esc(gap['suggestedFix'])}</span>
                    </div>
                  </td>
                </tr>"""

        sections.append(f"""
        {_section_header("Prompt Gap Analysis", "Where production prompts may be missing or conflicting with evaluation rules")}
        <div style="margin-bottom:12px">
          <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:8px">Gap Types: {len(gaps)} gap{'s' if len(gaps) != 1 else ''} found</p>
          {_segmented_bar(bar_segs, height=8, show_values=False)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px">{legend_items}</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:12px">
          {_table_header(("", "left", 20), ("Prompt Section", "left", None), ("Rule", "left", None), ("", "left", None), ("Description", "left", None))}
          <tbody>{gap_rows}</tbody>
        </table>
        """)

    # ── Recommendations ─────────────────────────────────────────
    recs = narrative.get("recommendations", [])
    if recs:
        grouped: dict[str, list] = {}
        for r in recs:
            p = r.get("priority", "P2")
            grouped.setdefault(p, []).append(r)

        recs_html = ""
        for priority in ["P0", "P1", "P2"]:
            group = grouped.get(priority, [])
            if not group:
                continue
            recs_html += f'<h4 style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin:16px 0 8px">{_PRIORITY_LABEL.get(priority, priority)}</h4>'
            rows = ""
            for i, rec in enumerate(group):
                bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
                impact = _parse_impact(rec.get("estimatedImpact", ""))
                rows += f"""
                <tr style="background:{bg}">
                  <td style="padding:8px 8px;width:20px;vertical-align:top"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{_PRIORITY_DOT.get(rec.get('priority','P2'), '#6b7280')}"></span></td>
                  <td style="padding:8px;font-weight:500;color:#0f172a;vertical-align:top">{_esc(rec.get('action'))}</td>
                  <td style="padding:8px;color:#64748b;vertical-align:top">{_esc(rec.get('area'))}</td>
                  <td style="padding:8px;text-align:right;vertical-align:top;font-size:11px">{impact}</td>
                </tr>"""
            recs_html += f"""
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:12px">
              {_table_header(("", "left", 20), ("Action", "left", None), ("Focus Area", "left", 90), ("Projected Reduction", "right", None))}
              <tbody>{rows}</tbody>
            </table>"""

        sections.append(f"""
        {_section_header("Recommendations", "AI-generated improvement actions prioritized by impact")}
        {recs_html}
        """)

    # ── Scoring & Grading Reference ────────────────────────────
    ref_html = '<div style="page-break-before:always">'
    ref_html += _section_header("Scoring & Grading Reference", "Definitions for grades, verdicts, metrics, and priorities used in this report")

    # 1. Health Score Grades
    grade_rows = ""
    grade_data = [
        ("A+", "95–100"), ("A", "90–94"), ("A-", "85–89"),
        ("B+", "80–84"), ("B", "75–79"), ("B-", "70–74"),
        ("C+", "65–69"), ("C", "60–64"), ("C-", "55–59"),
        ("D+", "50–54"), ("D", "45–49"), ("F", "0–44"),
    ]
    for i, (g, rng) in enumerate(grade_data):
        bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
        grade_rows += f'<tr style="background:{bg}"><td style="padding:4px 8px;font-weight:700;color:{_grade_hex(g)}">{g}</td><td style="padding:4px 8px;color:#475569">{rng}</td></tr>'
    ref_html += f"""
    <div class="ref-subsection">
      <h3 style="font-size:12px;font-weight:600;color:#0f172a;margin-bottom:8px">Health Score Grades</h3>
      <p style="font-size:11px;color:#64748b;margin-bottom:8px;line-height:1.5">
        The health score is an equally-weighted average of four dimensions (Intent Accuracy, Correctness Rate,
        Efficiency Rate, and Task Completion), each scored 0–100%. If a dimension has no data, its weight is
        redistributed among the remaining active dimensions. The composite score maps to a letter grade:
      </p>
      <table style="width:auto;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:12px;margin-bottom:20px">
        {_table_header(("Grade", "left", 60), ("Score Range", "left", 100))}
        <tbody>{grade_rows}</tbody>
      </table>
    </div>"""

    # 2. Verdict Definitions
    correctness_verdicts = [
        ("PASS", "All evaluation rules satisfied; response is correct."),
        ("NOT APPLICABLE", "Thread could not be meaningfully evaluated (e.g. no bot response)."),
        ("SOFT FAIL", "Minor rule violations that don't break the core task."),
        ("HARD FAIL", "Significant rule violations; response is substantially wrong."),
        ("CRITICAL", "Severe failure — safety, compliance, or data-integrity violation."),
    ]
    efficiency_verdicts = [
        ("EFFICIENT", "Task completed in the minimum expected turns."),
        ("ACCEPTABLE", "Slightly more turns than optimal, but reasonable."),
        ("INCOMPLETE", "Conversation ended before the task was finished."),
        ("FRICTION", "Unnecessary back-and-forth that delayed task completion."),
        ("BROKEN", "Conversation loop or dead-end; task could not progress."),
    ]

    def _verdict_ref_rows(items: list[tuple[str, str]]) -> str:
        rows = ""
        for i, (v, desc) in enumerate(items):
            bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
            color = _VERDICT_COLORS.get(v, "#6b7280")
            rows += f'<tr style="background:{bg}"><td style="padding:4px 8px;width:20px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{color}"></span></td><td style="padding:4px 8px;font-weight:600;color:#0f172a">{v}</td><td style="padding:4px 8px;color:#475569">{desc}</td></tr>'
        return rows

    ref_html += f"""
    <div class="ref-subsection">
      <h3 style="font-size:12px;font-weight:600;color:#0f172a;margin-bottom:8px">Verdict Definitions</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div>
          <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:6px">Correctness</h4>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:11px">
            {_table_header(("", "left", 20), ("Verdict", "left", 90), ("Description", "left", None))}
            <tbody>{_verdict_ref_rows(correctness_verdicts)}</tbody>
          </table>
        </div>
        <div>
          <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:6px">Efficiency</h4>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:11px">
            {_table_header(("", "left", 20), ("Verdict", "left", 90), ("Description", "left", None))}
            <tbody>{_verdict_ref_rows(efficiency_verdicts)}</tbody>
          </table>
        </div>
      </div>
    </div>"""

    # 3. Metric Definitions
    metric_defs = [
        ("Intent Accuracy", "Pass Rate", "How well the bot understood what the user was asking for."),
        ("Correctness Rate", "Goal Achievement", "Percentage of threads where the bot's response satisfied all evaluation rules."),
        ("Efficiency Rate", "Rule Compliance", "Percentage of threads rated EFFICIENT or ACCEPTABLE (no unnecessary friction)."),
        ("Task Completion", "Difficulty Score", "Percentage of threads where the user's task was fully completed."),
    ]
    m_rows = ""
    for i, (std, adv, desc) in enumerate(metric_defs):
        bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
        m_rows += f'<tr style="background:{bg}"><td style="padding:4px 8px;font-weight:600;color:#0f172a">{std}</td><td style="padding:4px 8px;color:#64748b">{adv}</td><td style="padding:4px 8px;color:#475569">{desc}</td></tr>'
    ref_html += f"""
    <div class="ref-subsection">
      <h3 style="font-size:12px;font-weight:600;color:#0f172a;margin-bottom:8px">Metric Definitions</h3>
      <p style="font-size:11px;color:#64748b;margin-bottom:8px;line-height:1.5">Each metric is scored 0–100% and weighted equally in the overall health score. Adversarial runs reinterpret the same four dimensions with different semantics.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:11px;margin-bottom:20px">
        {_table_header(("Standard", "left", None), ("Adversarial", "left", None), ("Description", "left", None))}
        <tbody>{m_rows}</tbody>
      </table>
    </div>"""

    # 4. Priority & Gap Types
    priority_defs = [
        ("P0", "CRITICAL", "Must fix immediately — high user impact or safety concern."),
        ("P1", "HIGH", "Should fix soon — noticeable quality or compliance gap."),
        ("P2", "MEDIUM", "Improvement opportunity — nice-to-have refinement."),
    ]
    p_rows = ""
    for i, (code, severity, desc) in enumerate(priority_defs):
        bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
        p_rows += f'<tr style="background:{bg}"><td style="padding:4px 8px;width:20px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{_PRIORITY_DOT.get(code, "#6b7280")}"></span></td><td style="padding:4px 8px;font-weight:600;color:#0f172a">{code}</td><td style="padding:4px 8px;color:#475569">{severity}</td><td style="padding:4px 8px;color:#475569">{desc}</td></tr>'

    gap_types = ["UNDERSPEC", "SILENT", "LEAKAGE", "CONFLICTING"]
    g_rows = ""
    for i, gt in enumerate(gap_types):
        bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
        g_rows += f'<tr style="background:{bg}"><td style="padding:4px 8px;width:20px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{_GAP_DOT.get(gt, "#6b7280")}"></span></td><td style="padding:4px 8px;font-weight:600;color:#0f172a">{gt}</td><td style="padding:4px 8px;color:#475569">{_GAP_DESC.get(gt, "")}</td></tr>'

    ref_html += f"""
    <div class="ref-subsection">
      <h3 style="font-size:12px;font-weight:600;color:#0f172a;margin-bottom:8px">Priority & Gap Types</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div>
          <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:6px">Recommendation Priority</h4>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:11px">
            {_table_header(("", "left", 20), ("Priority", "left", 50), ("Severity", "left", 80), ("Description", "left", None))}
            <tbody>{p_rows}</tbody>
          </table>
        </div>
        <div>
          <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;margin-bottom:6px">Prompt Gap Types</h4>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:11px">
            {_table_header(("", "left", 20), ("Type", "left", 100), ("Description", "left", None))}
            <tbody>{g_rows}</tbody>
          </table>
        </div>
      </div>
    </div>"""

    ref_html += '</div>'
    sections.append(ref_html)

    # ── Footer ──────────────────────────────────────────────────
    sections.append("""
    <div style="text-align:center;font-size:9px;color:#9ca3af;padding:16px 0;margin-top:24px;border-top:1px solid #e2e8f0">
      CONFIDENTIAL &mdash; AI Evals Platform &middot; Tatvacare
    </div>""")

    body = "\n".join(sections)

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    color: #1e293b;
    font-size: 13px;
    line-height: 1.5;
    padding: 0;
  }}
  table {{ page-break-inside: auto; }}
  tr {{ page-break-inside: avoid; page-break-after: auto; }}
  thead {{ display: table-header-group; }}
  h2, h3, h4 {{ page-break-after: avoid; }}
  .section-header {{ page-break-inside: avoid; page-break-after: avoid; }}
  .exemplar-card {{ page-break-inside: avoid; }}
  .section-block {{ page-break-inside: avoid; }}
  .ref-subsection {{ page-break-inside: avoid; }}
  code {{ font-family: 'SF Mono', 'Menlo', 'Monaco', monospace; }}
</style>
</head>
<body>
{body}
</body>
</html>"""
