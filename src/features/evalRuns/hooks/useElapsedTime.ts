import { useState, useEffect } from 'react';

function computeElapsed(startedAt: string): string {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (secs < 0) return '0s';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function useElapsedTime(startedAt: string | null, active: boolean): string {
  const [elapsed, setElapsed] = useState(() =>
    startedAt && active ? computeElapsed(startedAt) : '',
  );
  useEffect(() => {
    if (!startedAt || !active) return;
    const id = setInterval(() => setElapsed(computeElapsed(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt, active]);
  return startedAt && active ? elapsed : '';
}
