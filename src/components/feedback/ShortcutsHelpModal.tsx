import { Modal } from '@/components/ui';
import { SHORTCUT_DISPLAY } from '@/hooks';

interface ShortcutsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'Space', description: 'Play/Pause audio' },
  { key: 'ArrowLeft', description: 'Seek backward 5 seconds' },
  { key: 'ArrowRight', description: 'Seek forward 5 seconds' },
  { key: 'S', ctrl: true, description: 'Save current work' },
  { key: 'Escape', description: 'Close modals' },
  { key: '?', shift: true, description: 'Show this help' },
];

export function ShortcutsHelpModal({ isOpen, onClose }: ShortcutsHelpModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard Shortcuts">
      <div className="space-y-1">
        {SHORTCUTS.map((shortcut, index) => (
          <div
            key={index}
            className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-[var(--bg-secondary)]"
          >
            <span className="text-[13px] text-[var(--text-secondary)]">
              {shortcut.description}
            </span>
            <kbd className="ml-4 rounded bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)] border border-[var(--border-default)]">
              {SHORTCUT_DISPLAY.formatKey(shortcut.key, shortcut.ctrl, shortcut.shift)}
            </kbd>
          </div>
        ))}
      </div>
      <div className="mt-6 text-center text-[12px] text-[var(--text-muted)]">
        Press <kbd className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[11px] border border-[var(--border-default)]">?</kbd> anytime to show this help
      </div>
    </Modal>
  );
}
