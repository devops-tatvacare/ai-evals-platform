import { useEffect, useCallback, useRef } from 'react';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
}

export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { enabled = true } = options;
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Ignore when typing in inputs, textareas, or contenteditable
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // Allow Cmd/Ctrl + S even in inputs
      const isSaveShortcut = 
        event.key.toLowerCase() === 's' && 
        (event.metaKey || event.ctrlKey);
      
      if (!isSaveShortcut) {
        return;
      }
    }

    for (const shortcut of shortcutsRef.current) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase() ||
        event.code.toLowerCase() === shortcut.key.toLowerCase();
      
      const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
      const altMatch = shortcut.alt ? event.altKey : !event.altKey;

      // For meta/ctrl shortcuts, accept either
      const modifierMatch = shortcut.ctrl || shortcut.meta
        ? (event.ctrlKey || event.metaKey)
        : !(event.ctrlKey || event.metaKey);

      if (keyMatch && modifierMatch && shiftMatch && altMatch) {
        event.preventDefault();
        shortcut.action();
        return;
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}

// Pre-defined shortcut keys for display
export const SHORTCUT_DISPLAY = {
  isMac: typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent),
  
  formatKey(key: string, ctrl?: boolean, shift?: boolean, alt?: boolean): string {
    const parts: string[] = [];
    const isMac = this.isMac;
    
    if (ctrl) parts.push(isMac ? '⌘' : 'Ctrl');
    if (shift) parts.push(isMac ? '⇧' : 'Shift');
    if (alt) parts.push(isMac ? '⌥' : 'Alt');
    
    // Format special keys
    const keyDisplay = key === ' ' ? 'Space' : 
      key === 'ArrowLeft' ? '←' :
      key === 'ArrowRight' ? '→' :
      key === 'ArrowUp' ? '↑' :
      key === 'ArrowDown' ? '↓' :
      key === 'Escape' ? 'Esc' :
      key.charAt(0).toUpperCase() + key.slice(1);
    
    parts.push(keyDisplay);
    return parts.join(isMac ? '' : '+');
  },
};
