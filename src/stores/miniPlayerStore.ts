import { create } from 'zustand';
import type { AppId } from '@/types';

interface MiniPlayerState {
  isOpen: boolean;

  // Listing context
  listingId: string | null;
  listingTitle: string | null;
  audioFileId: string | null;
  appId: AppId | null;

  // Playback state (synced from mini player's WaveSurfer)
  isPlaying: boolean;
  isReady: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;

  // Position transfer: when mini player closes, the main AudioPlayer
  // consumes this to seek its WaveSurfer to the right position
  pendingTransfer: { currentTime: number; playbackRate: number } | null;
}

interface MiniPlayerActions {
  open: (params: {
    listingId: string;
    listingTitle: string;
    audioFileId: string;
    appId: AppId;
    currentTime: number;
    playbackRate: number;
  }) => void;
  close: () => void;
  setPlaybackState: (partial: Partial<Pick<MiniPlayerState, 'isPlaying' | 'isReady' | 'currentTime' | 'duration' | 'playbackRate'>>) => void;
  closeIfAppChanged: (newAppId: AppId) => void;
  consumeTransfer: () => { currentTime: number; playbackRate: number } | null;
}

const initialState: MiniPlayerState = {
  isOpen: false,
  listingId: null,
  listingTitle: null,
  audioFileId: null,
  appId: null,
  isPlaying: false,
  isReady: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  pendingTransfer: null,
};

export const useMiniPlayerStore = create<MiniPlayerState & MiniPlayerActions>()((set, get) => ({
  ...initialState,

  open: ({ listingId, listingTitle, audioFileId, appId, currentTime, playbackRate }) => {
    set({
      isOpen: true,
      listingId,
      listingTitle,
      audioFileId,
      appId,
      // Seed with the main player's position — mini player will seek here on ready
      currentTime,
      playbackRate,
      isPlaying: false,
      isReady: false,
      duration: 0,
      pendingTransfer: null,
    });
  },

  close: () => {
    const { currentTime, playbackRate } = get();
    // Save position so the main AudioPlayer can resume here
    set({
      ...initialState,
      pendingTransfer: { currentTime, playbackRate },
    });
  },

  setPlaybackState: (partial) => {
    set(partial);
  },

  closeIfAppChanged: (newAppId) => {
    const { appId, isOpen } = get();
    if (isOpen && appId && appId !== newAppId) {
      // Hard reset — no transfer needed when switching apps
      set(initialState);
    }
  },

  consumeTransfer: () => {
    const { pendingTransfer } = get();
    if (pendingTransfer) {
      set({ pendingTransfer: null });
    }
    return pendingTransfer;
  },
}));
