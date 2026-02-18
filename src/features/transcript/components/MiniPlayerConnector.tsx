import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMiniPlayerStore } from '@/stores';
import { useMiniPlayerAudio } from '../hooks/useMiniPlayerAudio';
import { MiniPlayer } from './MiniPlayer';

export function MiniPlayerConnector() {
  const isOpen = useMiniPlayerStore((s) => s.isOpen);
  const audioFileId = useMiniPlayerStore((s) => s.audioFileId);

  if (!isOpen || !audioFileId) return null;

  return <MiniPlayerInner audioFileId={audioFileId} />;
}

function MiniPlayerInner({ audioFileId }: { audioFileId: string }) {
  const navigate = useNavigate();
  const { containerRef, togglePlayPause, seekForward, seekBackward, setPlaybackRate } =
    useMiniPlayerAudio(audioFileId);

  const handlePopIn = useCallback(() => {
    const { listingId } = useMiniPlayerStore.getState();
    if (!listingId) return;

    // Navigate to the listing's transcript tab, then close to transfer position
    navigate(`/listing/${listingId}?tab=transcript`);
    useMiniPlayerStore.getState().close();
  }, [navigate]);

  return (
    <MiniPlayer
      waveformRef={containerRef}
      onTogglePlayPause={togglePlayPause}
      onSeekForward={seekForward}
      onSeekBackward={seekBackward}
      onSetPlaybackRate={setPlaybackRate}
      onPopIn={handlePopIn}
    />
  );
}
