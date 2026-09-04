import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import HomePage from '../../../../packages/remote-web/src/pages/HomePage';
import InvitationPage from '../../../../packages/remote-web/src/pages/InvitationPage';
import LoginPage from '../../../../packages/remote-web/src/pages/LoginPage';
import i18n from '../../../../packages/web-core/src/i18n/config';
import '../../../../packages/ui/src/styles/tokens.css';
import './style.css';

function Fixture() {
  const page = new URLSearchParams(window.location.search).get('page');
  if (page === 'invite') return <InvitationPage />;
  if (page === 'home') {
    // Home is a descendant of RemoteAppShell in production, so the shell owns
    // the document landmark. The fixture supplies that composition boundary.
    return (
      <main className="fixture-home-shell">
        <HomePage />
      </main>
    );
  }
  return <LoginPage />;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const root = document.getElementById('root');
if (!root) throw new Error('Remote pages fixture root is missing');

const locale = new URLSearchParams(window.location.search).get('locale');
if (
  locale &&
  ['en', 'es', 'fr', 'ja', 'ko', 'zh-Hans', 'zh-Hant'].includes(locale)
) {
  document.documentElement.dataset.fixtureLocale = locale;
  void i18n.changeLanguage(locale);
}

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <Fixture />
  </QueryClientProvider>
);

if (
  new URLSearchParams(window.location.search).get('mode') === 'login-degraded'
) {
  window.setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: ['remote-auth-methods'] });
  }, 500);
}
