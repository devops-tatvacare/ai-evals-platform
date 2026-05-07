import { Lock, Share2 } from 'lucide-react';
import { Badge } from './Badge';
import type { AssetVisibility } from '@/types';

interface VisibilityBadgeProps {
  visibility: AssetVisibility;
  compact?: boolean;
}

export function VisibilityBadge({ visibility, compact = false }: VisibilityBadgeProps) {
  if (visibility === 'shared') {
    return (
      <Badge variant="info" size={compact ? 'sm' : 'md'} icon={Share2}>
        Shared
      </Badge>
    );
  }

  return (
    <Badge variant="neutral" size={compact ? 'sm' : 'md'} icon={Lock}>
      Private
    </Badge>
  );
}
