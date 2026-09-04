import type { ReactNode } from 'react';

export type OAuthProvider = 'github' | 'google';

export const OAuthDialog = {
  show: async () => null,
};

export const oauthApi = {
  authMethods: async () => {
    const mode = new URLSearchParams(window.location.search).get('mode');
    const calls = Number(
      sessionStorage.getItem('onboarding-auth-calls') ?? '0'
    );
    sessionStorage.setItem('onboarding-auth-calls', String(calls + 1));

    if (mode === 'signin-error' || (mode === 'signin-degraded' && calls > 0)) {
      throw new Error('Fixture sign-in method discovery failed');
    }

    return {
      local_auth_enabled: mode !== 'signin-empty',
      oauth_providers: mode === 'signin-empty' ? [] : ['github', 'google'],
    };
  },
};

export function isLocalRemoteApiEnabled() {
  return false;
}

export function isTauriApp() {
  return false;
}

export function useOrganizationStore<T>(
  selector: (state: { setSelectedOrgId: (id: string | null) => void }) => T
) {
  return selector({ setSelectedOrgId: () => undefined });
}

export async function getFirstProjectDestination() {
  return { kind: 'workspaces-create' as const };
}

export function usePostHog() {
  return { capture: () => undefined };
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  return children;
}
