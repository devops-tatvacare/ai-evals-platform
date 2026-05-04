import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { FieldMappingEditor } from '@/features/orchestration/components/editors/FieldMappingEditor';

describe('FieldMappingEditor', () => {
  it('shows an empty-state hint with the custom target label', () => {
    const onChange = vi.fn();
    render(
      <FieldMappingEditor
        value={[]}
        onChange={onChange}
        targetLabel="LSQ field"
      />,
    );
    expect(screen.getByText(/No mappings/)).toBeInTheDocument();
    expect(screen.getAllByText(/LSQ field/).length).toBeGreaterThan(0);
  });

  it('appends a new mapping in payload mode by default', () => {
    const onChange = vi.fn();
    render(<FieldMappingEditor value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('Add mapping'));
    expect(onChange).toHaveBeenCalledWith([
      { target_field: '', source_kind: 'payload', payload_field: '' },
    ]);
  });

  it('renders a row in payload-source mode by default', () => {
    const onChange = vi.fn();
    render(
      <FieldMappingEditor
        value={[
          {
            target_field: 'note',
            source_kind: 'payload',
            payload_field: 'note_template',
          },
        ]}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByPlaceholderText('recipient payload field'),
    ).toBeInTheDocument();
  });

  it('renders a static-value row when source_kind=static', () => {
    const onChange = vi.fn();
    render(
      <FieldMappingEditor
        value={[
          {
            target_field: 'note',
            source_kind: 'static',
            static_value: 'literal',
          },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByPlaceholderText('literal value')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('recipient payload field'),
    ).not.toBeInTheDocument();
  });

  it('removes a mapping row when the trash icon is clicked', () => {
    const onChange = vi.fn();
    render(
      <FieldMappingEditor
        value={[
          {
            target_field: 'note',
            source_kind: 'payload',
            payload_field: 'x',
          },
        ]}
        onChange={onChange}
      />,
    );
    const removeButton = screen.getByLabelText(/Remove mapping 1/);
    fireEvent.click(removeButton);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('clears stale source-specific fields when switching source kind', async () => {
    const onChange = vi.fn();
    render(
      <FieldMappingEditor
        value={[
          {
            target_field: 'note',
            source_kind: 'payload',
            payload_field: 'note_template',
            static_value: 'legacy',
          },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('combobox', { name: /Recipient field/i }));
    fireEvent.click(await screen.findByRole('option', { name: /^Static value$/i }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        {
          target_field: 'note',
          source_kind: 'static',
          static_value: 'legacy',
        },
      ]);
    });
  });
});
