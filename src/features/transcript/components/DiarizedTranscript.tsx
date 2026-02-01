import { useRef, useEffect, useCallback } from 'react';
import { TranscriptSegment } from './TranscriptSegment';
import type { TranscriptSegment as TranscriptSegmentType } from '@/types';

interface DiarizedTranscriptProps {
  segments: TranscriptSegmentType[];
  activeIndex: number | null;
  onSegmentClick: (index: number) => void;
  className?: string;
}

export function DiarizedTranscript({
  segments,
  activeIndex,
  onSegmentClick,
  className,
}: DiarizedTranscriptProps) {
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  
  // Auto-scroll to active segment
  useEffect(() => {
    if (activeIndex !== null) {
      const segmentEl = segmentRefs.current[activeIndex];
      if (segmentEl) {
        segmentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeIndex]);

  const setSegmentRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    segmentRefs.current[index] = el;
  }, []);

  return (
    <div className={className}>
      <div className="space-y-2">
        {segments.map((segment, index) => (
          <div key={index} ref={setSegmentRef(index)}>
            <TranscriptSegment
              segment={segment}
              isActive={index === activeIndex}
              onClick={() => onSegmentClick(index)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
