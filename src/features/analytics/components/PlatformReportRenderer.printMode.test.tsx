import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlatformReportView } from '@/features/analytics/components/PlatformReportRenderer';
import type { PlatformRunReportPayload } from '@/types/platformReports';

function makeMinimalReport(): PlatformRunReportPayload {
  return {
    schemaVersion: 'v1',
    metadata: {
      appId: 'kaira-bot',
      reportKind: 'single_run',
      reportId: null,
      reportName: 'Test Report',
      reportRunId: null,
      runId: 'run-1',
      runName: 'Test Run',
      evalType: 'batch_adversarial',
      createdAt: '2026-05-01T00:00:00Z',
      computedAt: '2026-05-01T00:00:00Z',
      sourceRunCount: 1,
      llmProvider: null,
      llmModel: null,
      narrativeModel: null,
      cacheKey: null,
    },
    presentation: {
      sections: [
        {
          sectionId: 'callout-1',
          componentId: 'callout',
          title: 'Heads Up',
          description: null,
          variant: 'default',
          printable: true,
        },
      ],
      rendererId: 'kaira-run-v1',
      layoutGroups: [
        { id: 'detailed-default', tab: 'detailed', layout: 'stack', sectionIds: ['callout-1'] },
      ],
      density: 'comfortable',
      designTokens: {},
      themeTokens: {},
    },
    sections: [
      {
        id: 'callout-1',
        type: 'callout',
        title: 'Heads Up',
        description: null,
        variant: 'default',
        data: { tone: 'info', message: 'Print mode test message' },
      },
    ],
    exportDocument: {
      schemaVersion: 'v1',
      title: 'Test Report',
      subtitle: null,
      theme: {
        accent: '#0f766e',
        accentMuted: '#ccfbf1',
        border: '#cbd5e1',
        textPrimary: '#0f172a',
        textSecondary: '#475569',
        background: '#ffffff',
      },
      blocks: [],
    },
  };
}

describe('PlatformReportView printMode', () => {
  it('renders Summary and Detailed Analysis tabs by default', () => {
    render(<PlatformReportView report={makeMinimalReport()} actions={null} />);
    expect(screen.getByRole('button', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detailed Analysis' })).toBeInTheDocument();
  });

  it('hides tabs and renders detailed sections inline when printMode is true', () => {
    render(<PlatformReportView report={makeMinimalReport()} printMode />);
    expect(screen.queryByRole('button', { name: 'Summary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Detailed Analysis' })).toBeNull();
    expect(screen.getByText('Print mode test message')).toBeInTheDocument();
  });

  it('does not render the actions slot when printMode is true', () => {
    render(
      <PlatformReportView
        report={makeMinimalReport()}
        actions={<button type="button">Export PDF</button>}
        printMode
      />,
    );
    expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull();
  });

  it('excludes sections marked printable=false from the print output', () => {
    const report = makeMinimalReport();
    // Add a second section that the backend has flagged as non-printable.
    report.sections.push({
      id: 'callout-2',
      type: 'callout',
      title: 'Internal Note',
      description: null,
      variant: 'default',
      data: { tone: 'warning', message: 'Hidden from PDF' },
    });
    report.presentation.sections.push({
      sectionId: 'callout-2',
      componentId: 'callout',
      title: 'Internal Note',
      description: null,
      variant: 'default',
      printable: false,
    });
    (report.presentation.layoutGroups[0] as { sectionIds: string[] }).sectionIds.push('callout-2');

    render(<PlatformReportView report={report} printMode />);

    expect(screen.getByText('Print mode test message')).toBeInTheDocument();
    expect(screen.queryByText('Hidden from PDF')).toBeNull();
  });

  it('still renders the same printable=false section in the live UI Detailed tab', () => {
    const report = makeMinimalReport();
    report.sections.push({
      id: 'callout-2',
      type: 'callout',
      title: 'Internal Note',
      description: null,
      variant: 'default',
      data: { tone: 'warning', message: 'Visible only on screen' },
    });
    report.presentation.sections.push({
      sectionId: 'callout-2',
      componentId: 'callout',
      title: 'Internal Note',
      description: null,
      variant: 'default',
      printable: false,
    });
    (report.presentation.layoutGroups[0] as { sectionIds: string[] }).sectionIds.push('callout-2');

    render(<PlatformReportView report={report} actions={null} />);

    // Tabs default `mountStrategy='all'`, so both panels exist in the DOM —
    // we just need to assert the printable=false section is reachable in the
    // live UI somewhere (it'll show in the detailed tab when activated).
    expect(screen.queryAllByText('Visible only on screen').length).toBeGreaterThan(0);
  });
});
