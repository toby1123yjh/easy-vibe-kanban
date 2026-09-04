import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import {
  BaseCodingAgent,
  EditorType,
  SoundFile,
  ThemeMode,
} from 'shared/types';
import { LandingPage } from '../../../../packages/web-core/src/features/onboarding/ui/LandingPage';
import { OnboardingSignInPage } from '../../../../packages/web-core/src/features/onboarding/ui/OnboardingSignInPage';
import { AppNavigationProvider } from '../../../../packages/web-core/src/shared/hooks/useAppNavigation';
import type { AppNavigation } from '../../../../packages/web-core/src/shared/lib/routes/appNavigation';
import { ThemeProviderContext } from '../../../../packages/web-core/src/shared/hooks/useTheme';
import {
  UserSystemContext,
  type UserSystemContextType,
} from '../../../../packages/web-core/src/shared/hooks/useUserSystem';
import i18n from '../../../../packages/web-core/src/i18n/config';
import '../../../../packages/ui/src/styles/tokens.css';
import './style.css';

const config = {
  config_version: 'fixture',
  theme: ThemeMode.SYSTEM,
  executor_profile: { executor: BaseCodingAgent.CODEX, variant: null },
  disclaimer_acknowledged: false,
  onboarding_acknowledged: false,
  remote_onboarding_acknowledged: false,
  notifications: {
    sound_enabled: false,
    sound_file: SoundFile.ABSTRACT_SOUND1,
    push_enabled: false,
  },
  editor: {
    editor_type: EditorType.VS_CODE,
    custom_command: null,
    remote_ssh_host: null,
    remote_ssh_user: null,
    auto_install_extension: true,
  },
  github: {
    pat: null,
    oauth_token: null,
    username: null,
    primary_email: null,
    default_pr_base: null,
  },
  analytics_enabled: false,
  workspace_dir: null,
  last_app_version: null,
  show_release_notes: false,
  language: 'EN',
  git_branch_prefix: '',
  showcases: { seen_features: [] },
  pr_auto_description_enabled: false,
  pr_auto_description_prompt: null,
  commit_reminder_enabled: false,
  commit_reminder_prompt: null,
  send_message_shortcut: 'ModifierEnter',
  relay_enabled: false,
  host_nickname: null,
  hidden_agents: [],
} as const;

const navigation: AppNavigation = {
  resolveFromPath: () => ({ kind: 'onboarding' }),
  goToRoot: () => undefined,
  goToOnboarding: () => undefined,
  goToOnboardingSignIn: () => undefined,
  goToWorkspaces: () => undefined,
  goToWorkspacesCreate: () => undefined,
  goToWorkspace: () => undefined,
  goToWorkspaceVsCode: () => undefined,
  goToExport: () => undefined,
  goToProject: () => undefined,
  goToProjectWorkflows: () => undefined,
  goToProjectWorkflowEdit: () => undefined,
  goToProjectWorkflowRun: () => undefined,
  goToProjectIssue: () => undefined,
  goToProjectIssueArena: () => undefined,
  goToProjectIssueWorkspace: () => undefined,
  goToProjectIssueWorkspaceCreate: () => undefined,
  goToProjectWorkspaceCreate: () => undefined,
};

function Fixture() {
  const params = new URLSearchParams(window.location.search);
  const page = params.get('page') === 'signin' ? 'signin' : 'landing';
  const loading = params.get('mode') === 'loading';
  const userSystem: UserSystemContextType = {
    system: {
      appVersion: 'fixture',
      previewProxyPort: null,
      config: config as never,
      environment: null,
      profiles: null,
      capabilities: null,
      machineId: 'onboarding-fixture',
      loginStatus: { status: 'loggedout' },
      remoteAuthDegraded: null,
    },
    appVersion: 'fixture',
    previewProxyPort: null,
    config: config as never,
    environment: null,
    profiles: null,
    capabilities: null,
    machineId: 'onboarding-fixture',
    loginStatus: { status: 'loggedout' },
    remoteAuthDegraded: null,
    updateConfig: () => undefined,
    updateAndSaveConfig: async () => true,
    saveConfig: async () => true,
    setEnvironment: () => undefined,
    setProfiles: () => undefined,
    setCapabilities: () => undefined,
    reloadSystem: async () => undefined,
    loading,
  };

  return (
    <UserSystemContext.Provider value={userSystem}>
      <ThemeProviderContext.Provider
        value={{
          theme: ThemeMode.SYSTEM,
          effectiveTheme: 'light',
          setTheme: () => undefined,
        }}
      >
        <AppNavigationProvider value={navigation}>
          {page === 'signin' ? <OnboardingSignInPage /> : <LandingPage />}
        </AppNavigationProvider>
      </ThemeProviderContext.Provider>
    </UserSystemContext.Provider>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const root = document.getElementById('root');
if (!root) throw new Error('Onboarding fixture root is missing');

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
  new URLSearchParams(window.location.search).get('mode') === 'signin-degraded'
) {
  window.setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'methods'] });
  }, 500);
}
