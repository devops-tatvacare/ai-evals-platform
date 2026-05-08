const PDF_EXPORT_TITLE = 'Couldn\'t export PDF';
const PDF_EXPORT_TIMEOUT_MESSAGE = 'The report print page did not finish loading in time. Please try again.';

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

export function formatPdfExportError(error: unknown): { title: string; message: string } {
  const rawMessage = error instanceof Error ? normalizeMessage(error.message) : '';
  const message = rawMessage.replace(/^PDF generation failed:\s*/i, '').trim();

  if (!message) {
    return {
      title: PDF_EXPORT_TITLE,
      message: 'PDF export failed. Please try again.',
    };
  }

  if (/session expired/i.test(message)) {
    return {
      title: 'Session expired',
      message: 'Please sign in again and retry the PDF export.',
    };
  }

  if (
    /timed out|timeout|networkidle|page\.goto/i.test(message)
    || /https?:\/\//i.test(message)
    || /token=/i.test(message)
    || /call log:/i.test(message)
    || message.length > 180
  ) {
    return {
      title: PDF_EXPORT_TITLE,
      message: PDF_EXPORT_TIMEOUT_MESSAGE,
    };
  }

  return {
    title: PDF_EXPORT_TITLE,
    message,
  };
}
