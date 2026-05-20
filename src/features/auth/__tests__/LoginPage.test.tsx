import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/services/api/apiError';

const loginMock = vi.fn();

vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { login: typeof loginMock }) => unknown) => selector({ login: loginMock }),
    { getState: () => ({ user: null }) },
  ),
}));

vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => true,
}));

import { LoginPage } from '../LoginPage';

async function submitAndExpect(rejection: unknown, copy: string) {
  loginMock.mockRejectedValue(rejection);
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByPlaceholderText('Email address'), {
    target: { value: 'user@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  await waitFor(() => expect(screen.getByText(copy)).toBeInTheDocument());
}

describe('LoginPage error messaging', () => {
  it('shows connection copy when the server is unreachable', async () => {
    await submitAndExpect(
      new TypeError('Failed to fetch'),
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it('shows credential copy on a 401', async () => {
    await submitAndExpect(new ApiError(401, 'Invalid credentials'), 'Incorrect email or password.');
  });

  it('shows a server-error message on a 500', async () => {
    await submitAndExpect(
      new ApiError(500, 'boom'),
      'Something went wrong on our end. Please try again in a moment.',
    );
  });
});
