/** Picks thinking phrases for the trailing in-flight part so the shimmer reads
 *  like Sherlock is doing the specific work in front of it. Rebuilt against the
 *  typed SherlockPart union — no relation to the deleted phrasesForContext. */
import type { SherlockPart } from './generated/sherlockContract';
import { SHERLOCK_THINKING_PHRASES } from '@/features/chat-widget/thinkingPhrases';

const SPECIALIST_PHRASES: Record<string, readonly string[]> = {
  data_specialist: ['Querying the data…', 'Interrogating the data…', 'Cross-referencing rows…'],
  query_synthesis_specialist: ['Composing the query…', 'Shaping the question…', 'Mapping it to the schema…'],
  authoring_specialist: ['Drafting the answer…', 'Composing the narrative…', 'Writing it up…'],
};

function lastInFlight(parts: SherlockPart[]): SherlockPart | undefined {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part.type === 'subtask') return part;
    if (part.type === 'tool') return part;
  }
  return undefined;
}

export function phrasesForContext(parts: SherlockPart[]): readonly string[] {
  const trailing = lastInFlight(parts);
  if (trailing?.type === 'subtask') {
    return SPECIALIST_PHRASES[trailing.specialist] ?? SHERLOCK_THINKING_PHRASES;
  }
  if (trailing?.type === 'tool') {
    // A submit_sql tool always belongs to the data specialist's pipe.
    return SPECIALIST_PHRASES.data_specialist;
  }
  return SHERLOCK_THINKING_PHRASES;
}
