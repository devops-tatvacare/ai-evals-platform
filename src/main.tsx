import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import App from '@/app/App'
import { runStartupMigration } from '@/services/storage'

// Suppress WaveSurfer AbortError in dev mode (React StrictMode double-invoke)
if (import.meta.env.DEV) {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.name === 'AbortError' && 
        event.reason?.message?.includes('signal is aborted')) {
      event.preventDefault();
    }
  });
}

// Run database migration on startup (async, non-blocking)
runStartupMigration().catch(console.error);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
