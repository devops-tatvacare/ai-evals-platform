import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/hooks';

export function OfflineBanner() {
  const { isOnline, wasOffline } = useNetworkStatus();

  if (isOnline && !wasOffline) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
        isOnline
          ? 'bg-green-500 text-white'
          : 'bg-amber-500 text-white'
      }`}
    >
      {isOnline ? (
        'Back online!'
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          You're offline. Some features may be unavailable.
        </>
      )}
    </div>
  );
}
