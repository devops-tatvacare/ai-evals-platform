export { kairaChatService, KairaChatServiceError } from './kairaChatService';
export type { StreamMessageParams } from './kairaChatService';

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
