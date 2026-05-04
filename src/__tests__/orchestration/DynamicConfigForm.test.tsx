import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/features/orchestration/components/connections/WatiTemplatePicker', () => ({
  WatiTemplatePicker: ({
    value,
    onChange,
    onTemplateLoaded,
  }: {
    value: string;
    onChange(next: string): void;
    onTemplateLoaded?(template: {
      name: string;
      language: string;
      status: string;
      parameters: string[];
    } | null): void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onChange('document_approved_latest');
        onTemplateLoaded?.({
          name: 'document_approved_latest',
          language: 'en',
          status: 'APPROVED',
          parameters: ['name', 'documentType'],
        });
      }}
    >
      {value || 'Select mock WATI template'}
    </button>
  ),
}));

import { DynamicConfigForm } from '@/features/orchestration/components/DynamicConfigForm';
import type { JsonSchema } from '@/features/orchestration/components/DynamicConfigForm';

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    template_slug: { type: 'string', title: 'Template', description: 'Runtime-selected template slug.' },
    duration_hours: { type: 'number', title: 'Hours' },
    require_explicit_optin: { type: 'boolean', title: 'Strict opt-in', default: false },
    channel: { type: 'string', enum: ['wa', 'sms', 'voice'], title: 'Channel' },
  },
  required: ['template_slug', 'channel'],
};

describe('DynamicConfigForm', () => {
  it('renders one field per schema property', () => {
    const onChange = vi.fn();
    render(<DynamicConfigForm schema={SCHEMA} value={{}} onChange={onChange} />);
    expect(screen.getByRole('textbox', { name: /Template/ })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Hours/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Channel/i })).toBeInTheDocument();
  });

  it('emits onChange with full new value object on edit', () => {
    const onChange = vi.fn();
    render(<DynamicConfigForm schema={SCHEMA} value={{ template_slug: 'x' }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Template/ }), { target: { value: 'welcome_v1' } });
    expect(onChange).toHaveBeenLastCalledWith({ template_slug: 'welcome_v1' });
  });

  it('renders a Select trigger for enum fields', () => {
    const onChange = vi.fn();
    render(<DynamicConfigForm schema={SCHEMA} value={{}} onChange={onChange} />);
    // Radix Select renders its trigger as an aria combobox-like button.
    const trigger = screen.getByRole('combobox', { name: /Channel/i });
    expect(trigger).toBeInTheDocument();
  });

  it('moves field descriptions into hover tooltips instead of inline helper text', () => {
    render(<DynamicConfigForm schema={SCHEMA} value={{}} onChange={vi.fn()} />);
    expect(screen.queryByText('Runtime-selected template slug.')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'More info about Template' }));
    expect(screen.getByText('Runtime-selected template slug.')).toBeInTheDocument();
  });

  it('reconciles variable mappings when the selected WATI template changes', async () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        template_name: {
          type: 'string',
          title: 'WATI Template',
          'x-type': 'wati_template_picker',
        },
        variable_mappings: {
          type: 'array',
          title: 'Variable Mappings',
          'x-type': 'variable_mapping_list',
        },
      },
    };

    function Harness() {
      const [value, setValue] = useState({
        template_name: 'legacy_template',
        variable_mappings: [
          {
            agent_variable: 'legacy_var',
            source_kind: 'payload' as const,
            payload_field: 'legacy_field',
          },
        ],
      });

      return (
        <DynamicConfigForm
          schema={schema}
          value={value}
          onChange={setValue}
          connectionIdForVariables="conn-1"
          templateNameForVariables={value.template_name}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /legacy_template/i }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^name$/i }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('button', { name: /^documentType$/i }).length).toBeGreaterThan(0);
    });
    expect(screen.queryByDisplayValue('legacy_field')).not.toBeInTheDocument();
  });
});
