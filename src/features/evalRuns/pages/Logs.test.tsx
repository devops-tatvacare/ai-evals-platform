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
} = vi.hoisted(() => ({
  fetchLogsMock: vi.fn(),
  fetchRunMock: vi.fn(),
  listWorkflowActionsMock: vi.fn(),
  listWorkflowsMock: vi.fn(),
  listRunsMock: vi.fn(),
}));

// Mutable per-test override so we can render Logs as either voice-rx
// (no orchestration) or inside-sales (orchestration on). The hooks mock
// reads this on every call.
let currentAppIdForTest: 'voice-rx' | 'inside-sales' = 'voice-rx';

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

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  // The Zustand `appStore` isn't seeded in unit tests, so
  // `useCurrentAppConfig` would otherwise resolve via the global default
  // ('voice-rx') even when we override `useCurrentAppId`. Wire both to
  // the same mutable test variable so capability flags follow the app.
  const { APP_CONFIG_FALLBACKS } = await import('@/types/app.types');
  return {
    ...actual,
    useCurrentAppId: () => currentAppIdForTest,
    useCurrentAppConfig: () => APP_CONFIG_FALLBACKS[currentAppIdForTest],
    usePoll: () => undefined,
  };
});

import Logs from './Logs';

function renderAt(initialEntry: string, basePath = '/voice-rx/logs') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={basePath} element={<Logs />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  currentAppIdForTest = 'voice-rx';
  fetchLogsMock.mockResolvedValue({ logs: [] });
  fetchRunMock.mockResolvedValue({ status: 'completed' });
  listWorkflowActionsMock.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
  listWorkflowsMock.mockResolvedValue([]);
  listRunsMock.mockResolvedValue({ runs: [], total: 0, limit: 25, offset: 0 });
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

test('voice-rx (no orchestration capability) shows only the Evaluation runs tab', async () => {
  renderAt('/voice-rx/logs');
  expect(await screen.findByRole('button', { name: 'Evaluation runs' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Workflow runs' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Workflow actions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sherlock' })).not.toBeInTheDocument();
});

test('inside-sales (orchestration on) renders the three tabs in documented order', async () => {
  currentAppIdForTest = 'inside-sales';
  renderAt('/inside-sales/logs', '/inside-sales/logs');
  const buttons = await screen.findAllByRole('button');
  const labels = buttons.map((b) => b.textContent?.trim()).filter(Boolean);
  const evalIdx = labels.indexOf('Evaluation runs');
  const wfRunsIdx = labels.indexOf('Workflow runs');
  const wfActionsIdx = labels.indexOf('Workflow actions');
  expect(evalIdx).toBeGreaterThanOrEqual(0);
  expect(wfRunsIdx).toBeGreaterThan(evalIdx);
  expect(wfActionsIdx).toBeGreaterThan(wfRunsIdx);
  // Sherlock has moved to the admin surface — must not appear in any
  // per-app /logs tab list.
  expect(labels).not.toContain('Sherlock');
});

test('clicking Workflow actions tab fetches the global actions endpoint', async () => {
  currentAppIdForTest = 'inside-sales';
  const user = userEvent.setup();
  renderAt('/inside-sales/logs', '/inside-sales/logs');
  await user.click(await screen.findByRole('button', { name: 'Workflow actions' }));
  // The empty-state copy from WorkflowActionsTab confirms the real tab mounted
  // (the Phase A placeholder is gone).
  expect(await screen.findByText(/No workflow actions/i)).toBeInTheDocument();
  expect(listWorkflowActionsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'inside-sales' }),
  );
});

test('clicking Workflow runs tab fetches the cross-workflow runs endpoint', async () => {
  currentAppIdForTest = 'inside-sales';
  const user = userEvent.setup();
  renderAt('/inside-sales/logs', '/inside-sales/logs');
  await user.click(await screen.findByRole('button', { name: 'Workflow runs' }));
  // Empty-state copy confirms WorkflowRunsTab mounted (no Phase A placeholder).
  expect(await screen.findByText(/No workflow runs/i)).toBeInTheDocument();
  expect(listRunsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'inside-sales' }),
  );
});

test('legacy ?type=sherlock deep-link redirects to Evaluation runs (sherlock now lives in admin)', async () => {
  // Sherlock has moved to /admin/sherlock; visiting an app's /logs surface
  // with the old query param should drop the param and land on the
  // default tab rather than render an empty shell. Voice Rx's `logsPath`
  // is `/logs` (see APP_CONFIG_FALLBACKS), so the redirect target must
  // also be mounted under `/logs` for MemoryRouter to render it.
  render(
    <MemoryRouter initialEntries={['/logs?type=sherlock']}>
      <Routes>
        <Route path="/logs" element={<Logs />} />
      </Routes>
    </MemoryRouter>,
  );
  // The redirect lands on the same path with no `?type`; the default
  // tab is Evaluation runs and its toolbar mounts.
  expect(await screen.findByRole('button', { name: 'Search logs' })).toBeInTheDocument();
});

test('?type=workflow-runs on a non-orchestration app redirects to Evaluation runs', async () => {
  render(
    <MemoryRouter initialEntries={['/logs?type=workflow-runs']}>
      <Routes>
        <Route path="/logs" element={<Logs />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('button', { name: 'Search logs' })).toBeInTheDocument();
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
