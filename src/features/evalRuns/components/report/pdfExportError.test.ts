import { describe, expect, it } from 'vitest';

import { formatPdfExportError } from '@/features/evalRuns/components/report/pdfExportError';

describe('formatPdfExportError', () => {
  it('replaces raw playwright timeout dumps with a safe timeout message', () => {
    const formatted = formatPdfExportError(
      new Error('PDF generation failed: Page.goto: Timeout 45000ms exceeded. Call log: navigating to "http://192.168.10.62:5173/print/report-runs/abc?token=secret-token" waiting until "networkidle"'),
    );

    expect(formatted.title).toBe("Couldn't export PDF");
    expect(formatted.message).toBe('The report print page did not finish loading in time. Please try again.');
    expect(formatted.message).not.toContain('token=');
  });

  it('preserves short backend messages that are already safe for users', () => {
    expect(
      formatPdfExportError(new Error('PDF generation failed: PDF export is not enabled for this report')),
    ).toEqual({
      title: "Couldn't export PDF",
      message: 'PDF export is not enabled for this report',
    });
  });
});
