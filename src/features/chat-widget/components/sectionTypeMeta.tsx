import type { ReactNode } from 'react';
import type { AnalyticsSectionType } from '@/types/app.types';

interface SectionTypeMeta {
  label: string;
  glyph: ReactNode;
}

const accent = 'var(--color-accent-purple)';
const muted = 'color-mix(in srgb, var(--color-accent-purple) 45%, transparent)';

const svgProps = {
  width: 28,
  height: 16,
  viewBox: '0 0 28 16',
  fill: 'none',
  'aria-hidden': true,
} as const;

const summaryCardsGlyph = (
  <svg {...svgProps}>
    <rect x="0.5" y="3" width="7" height="10" rx="1.5" fill={muted} />
    <rect x="10.5" y="3" width="7" height="10" rx="1.5" fill={muted} />
    <rect x="20.5" y="3" width="7" height="10" rx="1.5" fill={accent} />
  </svg>
);

const narrativeGlyph = (
  <svg {...svgProps}>
    <rect x="1" y="3" width="22" height="1.5" rx="0.75" fill={muted} />
    <rect x="1" y="7.25" width="26" height="1.5" rx="0.75" fill={muted} />
    <rect x="1" y="11.5" width="18" height="1.5" rx="0.75" fill={accent} />
  </svg>
);

const metricBreakdownGlyph = (
  <svg {...svgProps}>
    <rect x="1" y="9" width="4" height="6" rx="1" fill={muted} />
    <rect x="7" y="5" width="4" height="10" rx="1" fill={accent} />
    <rect x="13" y="7" width="4" height="8" rx="1" fill={muted} />
    <rect x="19" y="2" width="4" height="13" rx="1" fill={accent} />
  </svg>
);

const distributionChartGlyph = (
  <svg {...svgProps}>
    <rect x="0.5" y="10" width="3" height="5" rx="0.75" fill={muted} />
    <rect x="4.5" y="6" width="3" height="9" rx="0.75" fill={accent} />
    <rect x="8.5" y="2" width="3" height="13" rx="0.75" fill={accent} />
    <rect x="12.5" y="5" width="3" height="10" rx="0.75" fill={accent} />
    <rect x="16.5" y="8" width="3" height="7" rx="0.75" fill={muted} />
    <rect x="20.5" y="11" width="3" height="4" rx="0.75" fill={muted} />
    <rect x="24.5" y="13" width="3" height="2" rx="0.75" fill={muted} />
  </svg>
);

const complianceTableGlyph = (
  <svg {...svgProps}>
    <rect x="0.5" y="1.5" width="27" height="13" rx="1.5" stroke={muted} strokeWidth="1" />
    <line x1="0.5" y1="5.5" x2="27.5" y2="5.5" stroke={muted} strokeWidth="1" />
    <line x1="0.5" y1="10" x2="27.5" y2="10" stroke={muted} strokeWidth="1" />
    <line x1="9.5" y1="1.5" x2="9.5" y2="14.5" stroke={muted} strokeWidth="1" />
    <line x1="18.5" y1="1.5" x2="18.5" y2="14.5" stroke={muted} strokeWidth="1" />
    <circle cx="23.5" cy="3.75" r="1" fill={accent} />
    <circle cx="14" cy="7.75" r="1" fill={accent} />
    <circle cx="5" cy="12.25" r="1" fill={accent} />
  </svg>
);

const frictionAnalysisGlyph = (
  <svg {...svgProps}>
    <path d="M1 3 H27 L22 8 L22 13 L6 13 L6 8 Z" fill={muted} />
    <path d="M6 8 L22 8" stroke={accent} strokeWidth="1.25" />
  </svg>
);

const heatmapGlyph = (
  <svg {...svgProps}>
    {[0, 1, 2, 3].flatMap((col) =>
      [0, 1, 2].map((row) => {
        const intensity = (col + row) % 4;
        const fill = intensity >= 2 ? accent : muted;
        const opacity = intensity === 0 ? 0.35 : intensity === 1 ? 0.6 : intensity === 2 ? 0.75 : 1;
        return (
          <rect
            key={`${col}-${row}`}
            x={col * 7 + 0.5}
            y={row * 5 + 0.5}
            width="6"
            height="4"
            rx="0.75"
            fill={fill}
            opacity={opacity}
          />
        );
      }),
    )}
  </svg>
);

const entitySlicesGlyph = (
  <svg {...svgProps}>
    <circle cx="8" cy="8" r="6.5" fill={muted} />
    <path d="M8 8 L8 1.5 A6.5 6.5 0 0 1 13.63 11.25 Z" fill={accent} />
    <rect x="18" y="5" width="9" height="1.5" rx="0.75" fill={muted} />
    <rect x="18" y="9.5" width="6" height="1.5" rx="0.75" fill={muted} />
  </svg>
);

const flagsGlyph = (
  <svg {...svgProps}>
    <line x1="4" y1="2" x2="4" y2="15" stroke={muted} strokeWidth="1.25" strokeLinecap="round" />
    <path d="M5 3 L14 3 L12 6 L14 9 L5 9 Z" fill={accent} />
    <line x1="17" y1="2" x2="17" y2="15" stroke={muted} strokeWidth="1.25" strokeLinecap="round" />
    <path d="M18 6 L25 6 L23.5 8.5 L25 11 L18 11 Z" fill={muted} />
  </svg>
);

const issuesRecommendationsGlyph = (
  <svg {...svgProps}>
    <path d="M9 1.5 L16.5 14 L1.5 14 Z" fill={muted} stroke={accent} strokeWidth="1" strokeLinejoin="round" />
    <line x1="9" y1="6" x2="9" y2="10" stroke={accent} strokeWidth="1.25" strokeLinecap="round" />
    <circle cx="9" cy="12" r="0.75" fill={accent} />
    <rect x="19" y="4" width="8" height="1.5" rx="0.75" fill={muted} />
    <rect x="19" y="7.25" width="8" height="1.5" rx="0.75" fill={muted} />
    <rect x="19" y="10.5" width="6" height="1.5" rx="0.75" fill={accent} />
  </svg>
);

const exemplarsGlyph = (
  <svg {...svgProps}>
    <rect x="1.5" y="3" width="11" height="10" rx="1.5" fill={muted} />
    <rect x="3.5" y="5.25" width="7" height="1.25" rx="0.5" fill={accent} opacity="0.7" />
    <rect x="3.5" y="7.75" width="6" height="1.25" rx="0.5" fill={accent} opacity="0.5" />
    <rect x="15.5" y="3" width="11" height="10" rx="1.5" fill={accent} opacity="0.35" />
    <rect x="17.5" y="5.25" width="7" height="1.25" rx="0.5" fill={accent} />
    <rect x="17.5" y="7.75" width="5" height="1.25" rx="0.5" fill={accent} opacity="0.7" />
  </svg>
);

const promptGapAnalysisGlyph = (
  <svg {...svgProps}>
    <rect x="0.5" y="2.5" width="10" height="11" rx="1.5" fill={muted} />
    <rect
      x="11.5"
      y="2.5"
      width="6"
      height="11"
      rx="1.5"
      stroke={accent}
      strokeWidth="1"
      strokeDasharray="2 2"
      fill="none"
    />
    <rect x="18.5" y="2.5" width="9" height="11" rx="1.5" fill={muted} />
  </svg>
);

const calloutGlyph = (
  <svg {...svgProps}>
    <circle cx="6" cy="8" r="4.5" fill={accent} />
    <rect x="5.25" y="5.5" width="1.5" height="1.5" rx="0.5" fill="var(--bg-secondary)" />
    <rect x="5.25" y="8" width="1.5" height="3" rx="0.5" fill="var(--bg-secondary)" />
    <rect x="13" y="5" width="14" height="1.5" rx="0.75" fill={muted} />
    <rect x="13" y="8" width="14" height="1.5" rx="0.75" fill={muted} />
    <rect x="13" y="11" width="9" height="1.5" rx="0.75" fill={muted} />
  </svg>
);

const fallbackGlyph = (
  <svg {...svgProps}>
    <rect x="0.5" y="3" width="27" height="10" rx="1.5" fill={muted} />
  </svg>
);

const META: Record<AnalyticsSectionType, SectionTypeMeta> = {
  summary_cards: { label: 'Headline KPI tiles', glyph: summaryCardsGlyph },
  narrative: { label: 'LLM-written narrative summary', glyph: narrativeGlyph },
  metric_breakdown: { label: 'Per-criterion score bars', glyph: metricBreakdownGlyph },
  distribution_chart: { label: 'Histogram across a dimension', glyph: distributionChartGlyph },
  compliance_table: { label: 'Pass/fail table per check', glyph: complianceTableGlyph },
  friction_analysis: { label: 'Drop-off and friction points', glyph: frictionAnalysisGlyph },
  heatmap: { label: 'Two-dimensional intensity grid', glyph: heatmapGlyph },
  entity_slices: { label: 'Breakdown by entity segment', glyph: entitySlicesGlyph },
  flags: { label: 'Flagged items roll-up', glyph: flagsGlyph },
  issues_recommendations: { label: 'Issues and recommended actions', glyph: issuesRecommendationsGlyph },
  exemplars: { label: 'Representative examples', glyph: exemplarsGlyph },
  prompt_gap_analysis: { label: 'Prompt coverage gaps', glyph: promptGapAnalysisGlyph },
  callout: { label: 'Inline callout note', glyph: calloutGlyph },
};

export function getSectionTypeMeta(type: string): SectionTypeMeta {
  return META[type as AnalyticsSectionType] ?? { label: type, glyph: fallbackGlyph };
}
