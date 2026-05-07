import type { DragEvent } from 'react';

import type { NodeTypeDescriptor } from '@/features/orchestration/types';

import { NodeCard } from './NodeCard';

interface Props {
  desc: NodeTypeDescriptor;
}

/** Drag-source tile rendered in the left rail. Composes the shared
 *  `NodeCard` primitive in `palette` density so the palette and canvas
 *  stay in lockstep — change the visual once in `NodeCard`, both
 *  surfaces follow. */
export function PaletteItem({ desc }: Props) {
  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData('application/orchestration-node', JSON.stringify(desc));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <NodeCard
      variant="palette"
      label={desc.displayLabel}
      description={desc.description}
      category={desc.displayCategory}
      draggable
      onDragStart={onDragStart}
    />
  );
}
