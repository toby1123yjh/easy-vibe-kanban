import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import LoginPage from '../../../../packages/remote-web/src/pages/LoginPage';
import HomePage from '../../../../packages/remote-web/src/pages/HomePage';
import InvitationPage from '../../../../packages/remote-web/src/pages/InvitationPage';
import '../../../../packages/web-core/src/i18n/config';
import '../../../../packages/ui/src/styles/tokens.css';
import './style.css';

const page = new URLSearchParams(window.location.search).get('page');
const Component =
  page === 'home'
    ? HomePage
    : page === 'invitation'
      ? InvitationPage
      : LoginPage;
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const root = document.getElementById('root');
if (!root) throw new Error('Remote surface fixture root is missing');

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <Component />
  </QueryClientProvider>
);
