import { useParams } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';

export function KairaBotListingPage() {
  const { id } = useParams();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/10">
        <MessageSquare className="h-10 w-10 text-[var(--text-brand)]" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Chat Evaluation
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          Chat ID: {id}
        </p>
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          Coming Soon
        </p>
      </div>
    </div>
  );
}
