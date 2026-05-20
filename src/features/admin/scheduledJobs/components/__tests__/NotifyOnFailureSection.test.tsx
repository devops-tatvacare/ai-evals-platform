import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NotifyOnFailureSection } from '../NotifyOnFailureSection';

interface RenderArgs {
  notifyOwnerOnFailure?: boolean;
  notifyEmailsOnFailure?: string[];
  ownerEmail?: string | null;
  allowedDomains?: string[];
  onChange?: ReturnType<typeof vi.fn>;
}

function renderSection(opts: RenderArgs = {}) {
  const fallback = vi.fn();
  const onChange = (opts.onChange ?? fallback) as unknown as Parameters<
    typeof NotifyOnFailureSection
  >[0]['onChange'];
  render(
    <NotifyOnFailureSection
      notifyOwnerOnFailure={opts.notifyOwnerOnFailure ?? false}
      notifyEmailsOnFailure={opts.notifyEmailsOnFailure ?? []}
      ownerEmail={opts.ownerEmail === undefined ? 'admin@allowed.com' : opts.ownerEmail}
      allowedDomains={opts.allowedDomains ?? []}
      onChange={onChange}
    />,
  );
  return { onChange };
}

function expand() {
  // Section title doubles as the disclosure toggle.
  fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
}

describe('NotifyOnFailureSection', () => {
  it('starts collapsed when nothing is configured', () => {
    renderSection();
    expect(screen.queryByText(/Email me when this job fails/i)).not.toBeInTheDocument();
  });

  it('starts open when at least one notification is configured', () => {
    renderSection({ notifyOwnerOnFailure: true });
    expect(screen.getByText(/Email me when this job fails/i)).toBeInTheDocument();
  });

  it('owner checkbox toggles and emits onChange with the new value', () => {
    const onChange = vi.fn();
    renderSection({ onChange });
    expand();
    const checkbox = screen.getByLabelText(/Email me when this job fails/i, {
      selector: 'input[type="checkbox"]',
    });
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({
      notifyOwnerOnFailure: true,
      notifyEmailsOnFailure: [],
    });
  });

  it('chip input accepts a valid email on Enter', () => {
    const onChange = vi.fn();
    renderSection({ onChange });
    expand();
    const input = screen.getByLabelText(/Also notify/i);
    fireEvent.change(input, { target: { value: 'ops@allowed.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({
      notifyOwnerOnFailure: false,
      notifyEmailsOnFailure: ['ops@allowed.com'],
    });
  });

  it('chip input shows inline error for an invalid email', () => {
    renderSection();
    expand();
    const input = screen.getByLabelText(/Also notify/i);
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/valid email/i)).toBeInTheDocument();
  });

  it('warns (does not block) when domain is outside allowed list', () => {
    renderSection({ allowedDomains: ['@allowed.com'] });
    expand();
    const input = screen.getByLabelText(/Also notify/i);
    fireEvent.change(input, { target: { value: 'someone@evil.com' } });
    // Warning appears even before commit because the draft is parseable.
    expect(screen.getByText(/may not be allowed/i)).toBeInTheDocument();
  });

  it('disables the input once 10 chips are present', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `addr${i}@allowed.com`);
    renderSection({ notifyEmailsOnFailure: ten });
    // Section auto-opens when configured — do not toggle.
    const input = screen.getByLabelText(/Also notify/i) as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it('removes a chip via the X button and emits the new list', () => {
    const onChange = vi.fn();
    renderSection({
      notifyEmailsOnFailure: ['a@allowed.com', 'b@allowed.com'],
      onChange,
    });
    // Section auto-opens when configured; chip X button is visible.
    fireEvent.click(screen.getByLabelText('Remove a@allowed.com'));
    expect(onChange).toHaveBeenCalledWith({
      notifyOwnerOnFailure: false,
      notifyEmailsOnFailure: ['b@allowed.com'],
    });
  });

  it('shows owner help when no email snapshot is available', () => {
    renderSection({ ownerEmail: null });
    expand();
    expect(screen.getByText(/does not have an email on file/i)).toBeInTheDocument();
    const checkbox = screen.getByLabelText(/Email me when this job fails/i, {
      selector: 'input[type="checkbox"]',
    });
    expect(checkbox).toBeDisabled();
  });
});
