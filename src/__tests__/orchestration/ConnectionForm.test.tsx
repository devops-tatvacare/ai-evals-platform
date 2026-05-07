import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestrationConnections', () => ({
  createConnection: vi.fn(),
  getProviderSchema: vi.fn(),
  updateConnection: vi.fn(),
}));

vi.mock('@/services/notifications', () => ({
  notificationService: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import {
  type Connection,
  getProviderSchema,
  updateConnection,
} from '@/services/api/orchestrationConnections';
import { ConnectionForm } from '@/features/orchestration/components/connections/ConnectionForm';

const mockedGetProviderSchema = getProviderSchema as ReturnType<typeof vi.fn>;
const mockedUpdateConnection = updateConnection as ReturnType<typeof vi.fn>;

const WATI_SCHEMA = {
  provider: 'wati',
  label: 'WATI',
  supportsWebhook: true,
  fields: [
    {
      name: 'base_url',
      title: 'API Endpoint',
      secret: false,
      required: true,
      description: 'WATI endpoint',
      default: '',
    },
    {
      name: 'wati_tenant_id',
      title: 'WATI Tenant ID',
      secret: false,
      required: true,
      description: 'Tenant identifier',
      default: '',
    },
    {
      name: 'api_token',
      title: 'API Token',
      secret: true,
      required: true,
      description: 'Stored encrypted.',
      default: '',
    },
    {
      name: 'channel_numbers',
      title: 'Channel Numbers',
      secret: false,
      required: false,
      description: 'WhatsApp sender numbers for this workspace.',
      default: [],
    },
  ],
  jsonSchema: {
    type: 'object',
    properties: {
      base_url: { type: 'string', title: 'API Endpoint' },
      wati_tenant_id: { type: 'string', title: 'WATI Tenant ID' },
      api_token: { type: 'string', title: 'API Token', 'x-secret': true },
      channel_numbers: {
        type: 'array',
        title: 'Channel Numbers',
        items: { type: 'string', 'x-format': 'e164' },
      },
    },
    required: ['base_url', 'wati_tenant_id', 'api_token'],
  },
};

const EXISTING_CONNECTION: Connection = {
  id: 'conn-1',
  tenantId: 'tenant-1',
  appId: 'inside-sales',
  provider: 'wati',
  name: 'WATI Production',
  active: true,
  lastUsedAt: null,
  webhookUrl: null,
  configRedacted: {
    base_url: 'https://live-mt-server.wati.io/123',
    wati_tenant_id: '123',
    channel_numbers: ['+919999990000'],
  },
  fields: WATI_SCHEMA.fields,
  createdBy: 'user-1',
  visibility: 'private',
  sharedBy: null,
  sharedAt: null,
  createdAt: '2026-05-04T10:00:00Z',
  updatedAt: '2026-05-04T10:00:00Z',
};

describe('ConnectionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetProviderSchema.mockResolvedValue(WATI_SCHEMA);
    mockedUpdateConnection.mockResolvedValue(EXISTING_CONNECTION);
  });

  it('renders the dedicated WATI channel-numbers editor and trims values on save', async () => {
    render(
      <ConnectionForm
        appId="inside-sales"
        existing={EXISTING_CONNECTION}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(await screen.findByText('Channel Numbers')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+919999990000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add channel number' }));
    const inputs = screen.getAllByPlaceholderText('+919999990000');
    fireEvent.change(inputs[1], { target: { value: ' +918888880000 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(mockedUpdateConnection).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({
          name: 'WATI Production',
          config: expect.objectContaining({
            channel_numbers: ['+919999990000', '+918888880000'],
          }),
        }),
      ),
    );
  });

  it('blocks saving when a WATI channel number is invalid', async () => {
    render(
      <ConnectionForm
        appId="inside-sales"
        existing={EXISTING_CONNECTION}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const input = await screen.findByDisplayValue('+919999990000');
    fireEvent.change(input, { target: { value: 'not-a-number' } });

    expect(screen.getByText(/Must be E\.164/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});
