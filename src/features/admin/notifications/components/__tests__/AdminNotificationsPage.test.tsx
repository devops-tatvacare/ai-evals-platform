import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationsPage } from '../../pages/AdminNotificationsPage';

vi.mock('@/services/api/client', () => ({
  apiRequest: vi.fn().mockResolvedValue({
    defaults: [
      {
        eventType: 'scheduled_job.failed',
        group: 'scheduled_job',
        isRequiredForAll: false,
        alwaysNotifyEmails: [],
      },
    ],
  }),
}));

vi.mock('@/services/api/queryFn', async () => {
  const actual = await import('@/services/api/queryFn');
  return {
    ...actual,
    apiQueryFn: vi.fn().mockResolvedValue({
      defaults: [
        {
          eventType: 'scheduled_job.failed',
          group: 'scheduled_job',
          isRequiredForAll: false,
          alwaysNotifyEmails: [],
        },
      ],
    }),
  };
});

describe('AdminNotificationsPage', () => {
  it('renders the title + tabs', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminNotificationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByText(/^Defaults$/)).toBeInTheDocument();
    expect(screen.getByText(/^Subscribers$/)).toBeInTheDocument();
    expect(screen.getByText(/^Send log$/)).toBeInTheDocument();
  });
});
