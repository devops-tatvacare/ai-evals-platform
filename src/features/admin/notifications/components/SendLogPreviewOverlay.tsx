import { X } from 'lucide-react';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { adminNotificationsCopy } from '../adminNotifications.copy';
import { useSendLogPreview } from '../queries';

interface Props {
  sendLogId: string | null;
  onClose: () => void;
}

export function SendLogPreviewOverlay({ sendLogId, onClose }: Props) {
  const isOpen = sendLogId !== null;
  const query = useSendLogPreview(sendLogId);

  return (
    <RightSlideOverShell
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="send-log-preview-title"
      widthClassName="w-[var(--overlay-width-lg,720px)] max-w-[92vw]"
    >
      <header className="flex items-start justify-between border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="min-w-0">
          <h2
            id="send-log-preview-title"
            className="text-[15px] font-semibold text-[var(--text-primary)]"
          >
            {adminNotificationsCopy.sendLog.preview.title}
          </h2>
          {query.data ? (
            <p className="mt-1 truncate text-[12px] text-[var(--text-tertiary)]">
              {query.data.recipient} · {query.data.subject}
            </p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)]"
          aria-label={adminNotificationsCopy.sendLog.preview.cancel}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {query.isLoading ? (
          <div className="p-5">
            <LoadingState />
          </div>
        ) : query.isError || !query.data ? (
          <p className="p-5 text-[13px] text-[var(--color-error)]">
            {adminNotificationsCopy.sendLog.preview.loadFailed}
          </p>
        ) : (
          <PreviewBody data={query.data} />
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {adminNotificationsCopy.sendLog.preview.cancel}
        </Button>
      </footer>
    </RightSlideOverShell>
  );
}

function PreviewBody({ data }: { data: NonNullable<ReturnType<typeof useSendLogPreview>['data']> }) {
  return (
    <div className="flex flex-col gap-4 p-5">
      {data.html ? (
        <iframe
          srcDoc={data.html}
          sandbox=""
          title={adminNotificationsCopy.sendLog.preview.title}
          className="h-[460px] w-full rounded-[8px] border border-[var(--border-default)] bg-white"
        />
      ) : (
        <p className="rounded-[8px] border border-dashed border-[var(--border-default)] bg-[var(--bg-tertiary)] px-3 py-3 text-[12px] text-[var(--text-tertiary)]">
          {adminNotificationsCopy.sendLog.preview.noHtml}
        </p>
      )}

      {data.errorMessage ? (
        <section>
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-error)]">
            {adminNotificationsCopy.sendLog.preview.errorHeading}
          </h3>
          <pre className="overflow-x-auto rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-2 text-[12px] text-[var(--text-primary)]">
            {data.errorMessage}
          </pre>
        </section>
      ) : null}

      {data.providerResponse ? (
        <section>
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {adminNotificationsCopy.sendLog.preview.providerResponseHeading}
          </h3>
          <pre className="overflow-x-auto rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-2 text-[12px] text-[var(--text-primary)]">
            {JSON.stringify(data.providerResponse, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
