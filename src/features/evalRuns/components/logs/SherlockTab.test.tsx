// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type {
  SherlockToolCallListResponse,
  SherlockToolCallRow,
} from '@/services/api/sherlock';

const { listToolCallsMock, listDistinctToolNamesMock } = vi.hoisted(() => ({
  listToolCallsMock: vi.fn(),
  listDistinctToolNamesMock: vi.fn(),
}));

vi.mock('@/services/api/sherlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/sherlock')>();
  return {
    ...actual,
    listToolCalls: listToolCallsMock,
    listDistinctToolNames: listDistinctToolNamesMock,
  };
});

import { SherlockTab } from './SherlockTab';

function makeRow(overrides: Partial<SherlockToolCallRow> = {}): SherlockToolCallRow {
  return {
    id: overrides.id ?? 'tc-1',
    sessionId: overrides.sessionId ?? 'sess-abc',
    dbSessionId: overrides.dbSessionId ?? null,
    appId: overrides.appId ?? 'inside-sales',
    toolName: overrides.toolName ?? 'execute_canonical_sql',
    status: overrides.status ?? 'success',
    errorMessage: overrides.errorMessage ?? null,
    executionMs: overrides.executionMs ?? 42,
    rowCount: overrides.rowCount ?? 3,
    llmModel: overrides.llmModel ?? 'gpt-5-mini',
    cacheHit: overrides.cacheHit ?? false,
    argsSummary: overrides.argsSummary ?? 'sql, limit',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/voice-rx/logs" element={<SherlockTab appId="inside-sales" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listToolCallsMock.mockResolvedValue({
    items: [
      makeRow({ id: 'tc-1', toolName: 'execute_canonical_sql', status: 'success' }),
      makeRow({ id: 'tc-2', toolName: 'sql_validate', status: 'error', errorMessage: 'bad column' }),
    ],
    total: 2,
    limit: 25,
    offset: 0,
  } satisfies SherlockToolCallListResponse);
  listDistinctToolNamesMock.mockResolvedValue([
    'execute_canonical_sql',
    'sql_validate',
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

test('renders rows from the tool-calls endpoint', async () => {
  renderAt('/voice-rx/logs');
  expect(await screen.findByText('execute_canonical_sql')).toBeInTheDocument();
  expect(screen.getByText('sql_validate')).toBeInTheDocument();
  expect(listToolCallsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'inside-sales', limit: 25, offset: 0 }),
  );
  expect(listDistinctToolNamesMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'inside-sales' }),
  );
});

test('?status=error deep-link forwards filter to backend', async () => {
  renderAt('/voice-rx/logs?status=error');
  await screen.findByText('execute_canonical_sql');
  expect(listToolCallsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'inside-sales', status: 'error' }),
  );
});

test('clicking a status pill re-fetches with the filter', async () => {
  const user = userEvent.setup();
  renderAt('/voice-rx/logs');
  await screen.findByText('execute_canonical_sql');
  await user.click(screen.getByRole('button', { name: 'Error' }));
  expect(listToolCallsMock).toHaveBeenLastCalledWith(
    expect.objectContaining({ appId: 'inside-sales', status: 'error' }),
  );
});

test('row click does not open an inline overlay', async () => {
  const user = userEvent.setup();
  const { container } = renderAt('/voice-rx/logs');
  await screen.findByText('execute_canonical_sql');
  const row = screen.getByText('execute_canonical_sql').closest('tr')!;
  await user.click(row);
  // Sub-route navigation; nothing should mount as a modal/overlay on the
  // current screen.
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
