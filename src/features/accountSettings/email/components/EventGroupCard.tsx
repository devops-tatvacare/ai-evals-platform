import type { ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
}

export function EventGroupCard({ title, children }: Props) {
  return (
    <section className="rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)]">
      <header className="border-b border-[var(--border-subtle)] px-4 py-2.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {title}
        </h3>
      </header>
      <div className="flex flex-col gap-1 p-2">{children}</div>
    </section>
  );
}
