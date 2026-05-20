/** User-initials and Sherlock gradient avatars for chat turns. */

interface AvatarProps {
  role: 'user' | 'assistant';
  initials: string;
}

export function Avatar({ role, initials }: AvatarProps) {
  if (role === 'user') {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--interactive-primary)] text-[11px] font-bold text-[var(--text-on-color)]">
        {initials}
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--color-brand-primary),var(--color-brand-primary-deep))]">
      <img src="/sherlock-icon.svg" alt="Sherlock" className="h-4 w-4 brightness-0 invert" />
    </div>
  );
}
