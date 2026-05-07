// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const {
  fetchLogsMock,
  fetchRunMock,
  listWorkflowActionsMock,
  listWorkflowsMock,
  listRunsMock,
  listToolCallsMock,
  listDistinctToolNamesMock,
} = vi.hoisted(() => ({
  fetchLogsMock: vi.fn(),
  fetchRunMock: vi.fn(),
  listWorkflowActionsMock: vi.fn(),
  listWorkflowsMock: vi.fn(),
  listRunsMock: vi.fn(),
  listToolCallsMock: vi.fn(),
  listDistinctToolNamesMock: vi.fn(),
}));

vi.mock('@/services/api/evalRunsApi', () => ({
  fetchLogs: fetchLogsMock,
  fetchRun: fetchRunMock,
  deleteLogs: vi.fn(),
}));

vi.mock('@/services/api/orchestration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/orchestration')>();
  return {
    ...actual,
    listWorkflowActions: listWorkflowActionsMock,
    listWorkflows: listWorkflowsMock,
    listRuns: listRunsMock,
  };
});

vi.mock('@/services/api/sherlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/sherlock')>();
  return {
    ...actual,
    listToolCalls: listToolCallsMock,
    listDistinctToolNames: listDistinctToolNamesMock,
  };
});

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  return {
    ...actual,
    useCurrentAppId: () => 'voice-rx',
    usePoll: () => undefined,
  };
});

import Logs from './Logs';

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/voice-rx/logs" element={<Logs />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchLogsMock.mockResolvedValue({ logs: [] });
  fetchRunMock.mockResolvedValue({ status: 'completed' });
  listWorkflowActionsMock.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
  listWorkflowsMock.mockResolvedValue([]);
  listRunsMock.mockResolvedValue({ runs: [], total: 0, limit: 25, offset: 0 });
  listToolCallsMock.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
  listDistinctToolNamesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

test('lands on Evaluation runs tab by default', async () => {
  renderAt('/voice-rx/logs');
  expect(await screen.findByRole('button', { name: 'Evaluation runs' })).toBeInTheDocument();
  // Default-selected tab renders the toolbar from the eval runs tab; the
  // search affordance is the collapsed icon-button labelled "Search logs".
  expect(await screen.findByRole('button', { name: 'Search logs' })).toBeInTheDocument();
});

test('renders all four tab buttons in the documented order', async () => {
  renderAt('/voice-rx/logs');
  const buttons = await screen.findAllByRole('button');
  const labels = buttons.map((b) => b.textContent?.trim()).filter(Boolean);
  const evalIdx = labels.indexOf('Evaluation runs');
  const wfRunsIdx = labels.indexOf('Workflow runs');
  const wfActionsIdx = labels.indexOf('Workflow actions');
  const sherlockIdx = labels.indexOf('Sherlock');
  expect(evalIdx).toBeGreaterThanOrEqual(0);
  expect(wfRunsIdx).toBeGreaterThan(evalIdx);
  expect(wfActionsIdx).toBeGreaterThan(wfRunsIdx);
  expect(sherlockIdx).toBeGreaterThan(wfActionsIdx);
});

test('clicking Workflow actions tab fetches the global actions endpoint', async () => {
  const user = userEvent.setup();
  renderAt('/voice-rx/logs');
  await user.click(await screen.findByRole('button', { name: 'Workflow actions' }));
  // The empty-state copy from WorkflowActionsTab confirms the real tab mounted
  // (the Phase A placeholder is gone).
  expect(await screen.findByText(/No workflow actions/i)).toBeInTheDocument();
  expect(listWorkflowActionsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'voice-rx' }),
  );
});

test('clicking Workflow runs tab fetches the cross-workflow runs endpoint', async () => {
  const user = userEvent.setup();
  renderAt('/voice-rx/logs');
  await user.click(await screen.findByRole('button', { name: 'Workflow runs' }));
  // Empty-state copy confirms WorkflowRunsTab mounted (no Phase A placeholder).
  expect(await screen.findByText(/No workflow runs/i)).toBeInTheDocument();
  expect(listRunsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'voice-rx' }),
  );
});

test('?type=sherlock deep-link mounts the Sherlock tab and fetches tool calls', async () => {
  renderAt('/voice-rx/logs?type=sherlock');
  // Empty-state copy confirms SherlockTab mounted (no Phase A placeholder).
  expect(
    await screen.findByText(/No Sherlock tool calls/i),
  ).toBeInTheDocument();
  expect(listToolCallsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'voice-rx' }),
  );
});

test('legacy ?run_id=<id> redirects to the runs sub-route', async () => {
  // Pre-Phase-A bookmarks point at /logs?run_id=<id>; Phase E maps them to
  // the routed sub-page so old links keep working.
  render(
    <MemoryRouter initialEntries={['/logs?run_id=abc-123']}>
      <Routes>
        <Route path="/logs" element={<Logs />} />
        <Route
          path="/logs/runs/:runId"
          element={<div data-testid="redirect-target" />}
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId('redirect-target')).toBeInTheDocument();
});

test('Evaluation runs tab fetches all logs without a run filter (multi-run only)', async () => {
  renderAt('/voice-rx/logs');
  // Wait for the toolbar so the fetch has fired.
  await screen.findByRole('button', { name: 'Search logs' });
  expect(fetchLogsMock).toHaveBeenCalledWith(
    expect.objectContaining({ app_id: 'voice-rx' }),
  );
  // Single-run drill-down lives on the new sub-route, not the tab.
  expect(fetchLogsMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ run_id: expect.any(String) }),
  );
});
