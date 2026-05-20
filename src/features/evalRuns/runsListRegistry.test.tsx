import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EvalRun } from '@/types';
import {
  buildRunsListRow,
  getRunsListConfig,
  type ColumnFactoryDeps,
} from './runsListRegistry';

const KAIRA = getRunsListConfig('kaira-bot');

const NOOP_DEPS: ColumnFactoryDeps = {
  menuOpenId: null,
  setMenuOpenId: () => {},
  onDelete: () => {},
  onCancel: () => {},
};

function run(overrides: Partial<EvalRun>): EvalRun {
  return {
    id: 'run-1',
    appId: 'kaira-bot',
    evalType: 'batch_adversarial',
    status: 'completed',
    config: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  } as EvalRun;
}

function passRateColumn() {
  const col = KAIRA.buildColumns(NOOP_DEPS).find((c) => c.key === 'passRate');
  if (!col) throw new Error('Kaira config has no passRate column');
  return col;
}

describe('Kaira runs list — pass-rate column', () => {
  it('replaces the score column', () => {
    const keys = KAIRA.buildColumns(NOOP_DEPS).map((c) => c.key);
    expect(keys).toContain('passRate');
    expect(keys).not.toContain('score');
  });

  it('carries the backend passRate onto the row', () => {
    const row = buildRunsListRow({ run: run({ passRate: 0.75 }), config: KAIRA });
    expect(row.passRate).toBe(0.75);
  });

  it('renders a percentage for adversarial runs', () => {
    const row = buildRunsListRow({ run: run({ passRate: 0.75 }), config: KAIRA });
    render(<>{passRateColumn().render(row)}</>);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders N/A when passRate is null (non-adversarial)', () => {
    const row = buildRunsListRow({
      run: run({ evalType: 'batch_thread', passRate: null }),
      config: KAIRA,
    });
    render(<>{passRateColumn().render(row)}</>);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });
});
