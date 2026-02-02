import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MainLayout } from '@/components/layout';
import { VoiceRxSettingsPage } from '@/features/voiceRx';
import { KairaBotSettingsPage } from '@/features/kairaBotSettings';
import { HomePage } from './pages/HomePage';
import { ListingPage } from './pages/ListingPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { KairaBotHomePage, KairaBotListingPage } from './pages/kaira';

function RouteDebug() {
  const location = useLocation();
  console.log('[Router] Current path:', location.pathname);
  return null;
}

export function Router() {
  return (
    <BrowserRouter>
      <RouteDebug />
      <MainLayout>
        <Routes>
          {/* Voice Rx routes */}
          <Route path="/" element={<HomePage />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path="/settings" element={<VoiceRxSettingsPage />} />
          
          {/* Kaira Bot routes */}
          <Route path="/kaira" element={<KairaBotHomePage />} />
          <Route path="/kaira/listing/:id" element={<KairaBotListingPage />} />
          <Route path="/kaira/settings" element={<KairaBotSettingsPage />} />
          
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MainLayout>
    </BrowserRouter>
  );
}
