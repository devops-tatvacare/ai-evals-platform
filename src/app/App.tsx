import { Providers } from './Providers';
import { Router } from './Router';
import { ErrorBoundary } from '@/components/feedback';

function App() {
  return (
    <ErrorBoundary>
      <Providers>
        <Router />
      </Providers>
    </ErrorBoundary>
  );
}

export default App;
