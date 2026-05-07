// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { ActionRow } from '@/features/orchestration/types';

const { getRunActionMock } = vi.hoisted(() => ({
  getRunActionMock: vi.fn(),
}));

vi.mock('@/services/api/orchestration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/orchestration')>();
  return {
    ...actual,
    getRunAction: getRunActionMock,
  };
});

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  return {
    ...actual,
    useCurrentAppId: () => 'inside-sales',
  };
});

import LogsWorkflowActionPage from './LogsWorkflowActionPage';

function makeAction(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: 'action-1',
    recipientId: '+15555550100',
    channel: 'sms',
    actionType: 'send_sms',
    status: 'success',
    idempotencyKey: 'idem-1',
    payload: { body: 'hello' },
    response: { status: 'queued' },
    providerCorrelationId: 'sms-msg-1',
    providerStatus: null,
    providerTerminal: true,
    error: null,
    parentActionId: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/inside-sales/logs/workflow-actions/:actionId"
          element={<LogsWorkflowActionPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getRunActionMock.mockResolvedValue(makeAction());
});

afterEach(() => {
  vi.clearAllMocks();
});

test('fetches the run-scoped action detail and renders the shared body', async () => {
  renderAt('/inside-sales/logs/workflow-actions/action-1?run=run-1');

  expect(await screen.findByText('Action summary')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back to Workflow actions' })).toBeInTheDocument();
  expect(screen.getByText('sms')).toBeInTheDocument();
  expect(screen.getByText('success')).toBeInTheDocument();
  expect(getRunActionMock).toHaveBeenCalledWith('run-1', 'action-1');
});
