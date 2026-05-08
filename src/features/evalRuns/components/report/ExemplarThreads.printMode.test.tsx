import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import ExemplarThreads from '@/features/evalRuns/components/report/ExemplarThreads';
import type { Exemplars } from '@/types/reports';

function makeExemplars(): Exemplars {
  return {
    best: [
      {
        threadId: 'thread-best-1',
        transcript: [
          { role: 'user', content: 'How many calories in a banana?' },
          { role: 'assistant', content: 'A medium banana has about 105 kcal.' },
        ],
        ruleViolations: [],
        correctnessVerdict: 'pass',
        taskCompleted: true,
        goalAchieved: true,
        difficulty: 'EASY',
        goalFlow: ['question_answered'],
        reasoning: 'Direct, accurate answer to a factual question.',
        failureModes: [],
        compositeScore: 90,
        intentAccuracy: 1,
        efficiencyVerdict: 'optimal',
        frictionTurns: [],
      },
    ],
    worst: [],
  };
}

describe('ExemplarThreads printMode', () => {
  it('keeps the transcript collapsed by default (live UI)', () => {
    render(
      <MemoryRouter>
        <ExemplarThreads exemplars={makeExemplars()} narrative={null} isAdversarial />
      </MemoryRouter>,
    );
    expect(screen.queryByText('A medium banana has about 105 kcal.')).toBeNull();
  });

  it('renders the full transcript inline when printMode is true (PDF)', () => {
    render(
      <MemoryRouter>
        <ExemplarThreads exemplars={makeExemplars()} narrative={null} isAdversarial printMode />
      </MemoryRouter>,
    );
    expect(screen.getByText('A medium banana has about 105 kcal.')).toBeInTheDocument();
    expect(screen.getByText('How many calories in a banana?')).toBeInTheDocument();
  });

  it('hides the chevron toggle button in printMode (no clicking on paper)', () => {
    render(
      <MemoryRouter>
        <ExemplarThreads exemplars={makeExemplars()} narrative={null} isAdversarial printMode />
      </MemoryRouter>,
    );
    const toggle = screen.queryByRole('button', { name: /transcript/i });
    expect(toggle).toBeNull();
  });
});
