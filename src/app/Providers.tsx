import { Toaster } from 'sonner';
import { ThemeProvider } from './ThemeProvider';
import { BackgroundTaskIndicator } from '@/components/feedback';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <BackgroundTaskIndicator />
      <Toaster 
        position="bottom-right"
        toastOptions={{
          style: {
            borderRadius: '6px',
            fontSize: '13px',
          },
        }}
        visibleToasts={3}
      />
    </ThemeProvider>
  );
}
