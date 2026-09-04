import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentCenterPage } from '../../../../packages/web-core/src/features/agent-center/ui/AgentCenterPage';
import '../../../../packages/web-core/src/i18n/config';
import '../../../../packages/ui/src/styles/tokens.css';
import './style.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('Agent Center fixture root is missing');

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <main className="fixture-shell">
      <AgentCenterPage />
    </main>
  </QueryClientProvider>
);
