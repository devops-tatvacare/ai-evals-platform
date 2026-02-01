import { useMemo } from 'react';
import { calculateEditDistanceMetrics, getRatingColor, type EditDistanceResult } from '../metrics';
import { cn } from '@/utils';

interface EditDistanceBadgeProps {
  original: string;
  generated: string;
  className?: string;
}

export function EditDistanceBadge({ original, generated, className }: EditDistanceBadgeProps) {
  const metrics = useMemo<EditDistanceResult>(
    () => calculateEditDistanceMetrics(original, generated),
    [original, generated]
  );

  const colors = getRatingColor(metrics.rating);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium border',
          colors.bg,
          colors.text,
          colors.border
        )}
      >
        <span className="opacity-70">ED:</span>
        <span>{metrics.distance}</span>
        <span className="opacity-50">|</span>
        <span>{(metrics.similarity * 100).toFixed(0)}%</span>
      </span>
    </div>
  );
}
