export { kairaChatService, KairaChatServiceError } from './kairaChatService';
export type { SendMessageParams, StreamMessageParams } from './kairaChatService';

export {
  createSessionState,
  buildStreamRequest,
  processChunk,
  applySessionUpdate,
} from './kairaSessionProtocol';
export type {
  KairaSessionState,
  SessionUpdate,
  ChunkContent,
  ChunkProcessingResult,
} from './kairaSessionProtocol';
