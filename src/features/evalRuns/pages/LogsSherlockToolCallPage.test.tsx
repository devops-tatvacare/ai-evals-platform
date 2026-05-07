// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { SherlockToolCallDetail } from '@/services/api/sherlock';

const { getToolCallMock } = vi.hoisted(() => ({
  getToolCallMock: vi.fn(),
}));

vi.mock('@/services/api/sherlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/sherlock')>();
  return {
    ...actual,
    getToolCall: getToolCallMock,
  };
});

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  return {
    ...actual,
    useCurrentAppId: () => 'inside-sales',
  };
});

import LogsSherlockToolCallPage from './LogsSherlockToolCallPage';

function makeDetail(overrides: Partial<SherlockToolCallDetail> = {}): SherlockToolCallDetail {
  return {
    id: 'tc-1',
    sessionId: 'sess-abc',
    dbSessionId: null,
    appId: 'inside-sales',
    toolName: 'execute_canonical_sql',
    status: 'success',
    errorMessage: null,
    executionMs: 142,
    rowCount: 7,
    llmModel: 'gpt-5-mini',
    llmTokensIn: 100,
    llmTokensOut: 50,
    cacheHit: false,
    arguments: { sql: 'SELECT 1' },
    generatedSql: 'SELECT 1',
    validatedSql: 'SELECT 1 LIMIT 100',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/inside-sales/logs/sherlock/:toolCallId"
          element={<LogsSherlockToolCallPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  getToolCallMock.mockResolvedValue(makeDetail());
});

test('renders the back button and core sections', async () => {
  renderAt('/inside-sales/logs/sherlock/tc-1');

  // Wait for the data load — the tool name renders as the PageSurface title.
  expect(await screen.findByText('execute_canonical_sql')).toBeInTheDocument();

  // PageSurface back button uses imperative navigate(); assert by aria-label.
  expect(
    screen.getByRole('button', { name: 'Back to Sherlock' }),
  ).toBeInTheDocument();

  // Status, duration, rows are rendered in the summary grid.
  expect(screen.getByText('success')).toBeInTheDocument();
  expect(screen.getByText(/142 ms/)).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument();

  // Full payloads come through on detail (not list).
  expect(screen.getByText(/"sql": "SELECT 1"/)).toBeInTheDocument();
  expect(getToolCallMock).toHaveBeenCalledWith('tc-1', { appId: 'inside-sales' });
});

test('renders error section when present', async () => {
  getToolCallMock.mockResolvedValue(
    makeDetail({ status: 'error', errorMessage: 'syntax error at column 7' }),
  );
  renderAt('/inside-sales/logs/sherlock/tc-1');

  expect(await screen.findByText('syntax error at column 7')).toBeInTheDocument();
  expect(screen.getByText('error')).toBeInTheDocument();
});
