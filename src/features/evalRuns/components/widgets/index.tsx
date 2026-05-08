/**
 * Widget renderer registry for the adversarial transcript pane.
 *
 * Adding a new widget = (1) add a registry entry in
 * `src/services/kaira/widgetGrammar.ts` and the BE mirror, (2) add a renderer
 * file in this directory, (3) wire it here. Three short steps; reviewer
 * verifies all three landed.
 *
 * Unknown kinds fall through to `UnsupportedWidgetPlaceholder` so the run is
 * never silently dropped — engineers see the gap on the transcript.
 */

import type { ComponentType } from 'react';
import { ActionPressBubble } from './ActionPressBubble';
import { BPCardWidget } from './BPCardWidget';
import { FoodCardBatchWidget } from './FoodCardBatchWidget';
import { UnsupportedWidgetPlaceholder } from './UnsupportedWidgetPlaceholder';
import { VitalsCardWidget } from './VitalsCardWidget';
import { FoodCardMessage } from '@/features/kaira/components/FoodCardMessage';
import type { FoodCard } from '@/types';

export interface WidgetRendererProps {
  kind: string;
  data: Record<string, unknown>;
}

function FoodCardWidgetReadOnly({ data }: WidgetRendererProps) {
  return (
    <FoodCardMessage
      foodCard={data as unknown as FoodCard}
      status={undefined}
      onConfirm={() => undefined}
      onEdit={() => undefined}
      readOnly
    />
  );
}
function BPCardRenderer({ data }: WidgetRendererProps) {
  return <BPCardWidget data={data} />;
}
function VitalsCardRenderer({ data }: WidgetRendererProps) {
  return <VitalsCardWidget data={data} />;
}
function FoodCardBatchRenderer({ data }: WidgetRendererProps) {
  return <FoodCardBatchWidget data={data as { isBatch?: boolean; sessions?: FoodCard[] }} />;
}
function UnsupportedRenderer({ kind, data }: WidgetRendererProps) {
  return <UnsupportedWidgetPlaceholder kind={kind} data={data} />;
}

export const WIDGET_RENDERERS: Record<string, ComponentType<WidgetRendererProps>> = {
  food_card: FoodCardWidgetReadOnly,
  food_card_batch: FoodCardBatchRenderer,
  bp_card: BPCardRenderer,
  vitals_card: VitalsCardRenderer,
};

export function rendererFor(kind: string): ComponentType<WidgetRendererProps> {
  return WIDGET_RENDERERS[kind] ?? UnsupportedRenderer;
}

export { ActionPressBubble, UnsupportedWidgetPlaceholder };
