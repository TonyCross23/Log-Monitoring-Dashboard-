import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import { App } from './app';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

class ApplicationBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    if (this.state.failed) return <main className="fatal-error"><h1>Something interrupted your workspace.</h1><p>Reload to restore the dashboard. Your server data is safe.</p><button onClick={() => window.location.reload()}>Reload workspace</button></main>;
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ApplicationBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster position="bottom-right" richColors closeButton />
      </QueryClientProvider>
    </ApplicationBoundary>
  </React.StrictMode>,
);
