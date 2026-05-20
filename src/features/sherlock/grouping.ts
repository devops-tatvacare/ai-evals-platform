/** Render-time grouping of the flat typed Part stream into visual turns.
 *  Turn is a view model — never serialized, never persisted, NOT a contract. */
import type { SherlockPart, StepFinishPart } from './generated/sherlockContract';

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  parts: SherlockPart[];
  stepFinish?: StepFinishPart;
}

// Backend emits each step as: step_start → user_message → assistant parts → step_finish.
// One step_finish.turn_id spans both the question and the answer; we split it into a
// right-aligned user turn and a left-aligned assistant block for rendering.
export function groupPartsIntoTurns(parts: SherlockPart[]): Turn[] {
  const sorted = [...parts].sort((a, b) => a.seq - b.seq);
  const turns: Turn[] = [];
  let assistant: Turn | null = null;
  let currentTurnId: string | null = null;

  const openAssistant = (): Turn => {
    const turn: Turn = {
      id: `assistant:${currentTurnId ?? turns.length}`,
      role: 'assistant',
      parts: [],
    };
    turns.push(turn);
    assistant = turn;
    return turn;
  };

  for (const part of sorted) {
    switch (part.type) {
      case 'step_start':
        currentTurnId = part.turn_id;
        assistant = null;
        break;
      case 'user_message':
        turns.push({ id: part.id, role: 'user', parts: [part] });
        assistant = null;
        break;
      case 'step_finish':
        (assistant ?? openAssistant()).stepFinish = part;
        assistant = null;
        break;
      default:
        (assistant ?? openAssistant()).parts.push(part);
        break;
    }
  }

  return turns;
}
