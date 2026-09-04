import type { AnchorHTMLAttributes, ReactNode } from 'react';

export type OAuthProvider = 'github' | 'google';

export type InvitationLookupResponse = {
  organization_name: string | null;
  organization_slug: string;
  role: string;
  expires_at: string;
};

export const getAuthMethods = async () => {
  const mode = new URLSearchParams(window.location.search).get('mode');
  const callKey = `remote-auth-calls-${mode ?? 'ready'}`;
  const calls = Number(sessionStorage.getItem(callKey) ?? '0');
  sessionStorage.setItem(callKey, String(calls + 1));

  if (mode === 'login-error' || (mode === 'login-degraded' && calls > 0)) {
    throw new Error('Fixture authentication discovery failed');
  }

  return {
    local_auth_enabled: mode !== 'login-empty',
    oauth_providers: mode === 'login-empty' ? [] : ['github', 'google'],
  };
};

export async function initOAuth() {
  return { authorize_url: 'https://auth.fixture.example/authorize' };
}

export async function localLogin() {
  return { access_token: 'fixture-access', refresh_token: 'fixture-refresh' };
}

export async function getInvitation() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'invite-error') {
    throw new Error('Fixture invitation lookup failed');
  }
  if (mode === 'invite-loading') {
    return new Promise<never>(() => undefined);
  }
  return {
    organization_name: 'Fixture Organization',
    organization_slug: 'fixture-org',
    role: 'Member',
    expires_at: '2030-01-01T00:00:00.000Z',
  } satisfies InvitationLookupResponse;
}

export async function listOrganizationProjects() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'home-project-error') {
    throw new Error('Fixture project lookup failed');
  }
  if (mode === 'home-empty') return [];
  return [
    {
      id: 'fixture-project',
      organization_id: 'fixture-org',
      name: 'Fixture Project',
      color: '#ef7d32',
      sort_order: 0,
      created_at: '2030-01-01T00:00:00.000Z',
      updated_at: '2030-01-01T00:00:00.000Z',
    },
  ];
}

export function useUserOrganizations() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'home-loading') {
    return {
      data: undefined,
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: async () => undefined,
    };
  }
  if (mode === 'home-error') {
    return {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error('Fixture organization lookup failed'),
      refetch: async () => undefined,
    };
  }
  if (mode === 'home-empty') {
    return {
      data: { organizations: [] },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: async () => undefined,
    };
  }
  return {
    data: {
      organizations: [
        {
          id: 'fixture-org',
          name: 'Fixture Organization',
          slug: 'fixture-org',
          is_personal: false,
          issue_prefix: 'FIX',
          created_at: '2030-01-01T00:00:00.000Z',
          updated_at: '2030-01-01T00:00:00.000Z',
          user_role: 'MEMBER',
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    error: mode === 'home-degraded' ? new Error('Refresh unavailable') : null,
    refetch: async () => undefined,
  };
}

export function useAuth() {
  return { isSignedIn: true, userId: 'fixture-user' };
}

export function useIsMobile() {
  return window.innerWidth < 768;
}

export function useRelayHosts() {
  return {
    hosts: [
      {
        id: 'fixture-host',
        name: 'Fixture Host',
        status: 'online' as const,
      },
    ],
  };
}

export function resolveRelayNavigationHostId() {
  return 'fixture-host';
}

export function useSettingsNavigation() {
  return { openSettings: () => undefined };
}

export function sortProjectsByOrder<T>(projects: T[]) {
  return projects;
}

export function useOrganizationStore<T>(
  selector: (state: { setSelectedOrgId: (id: string | null) => void }) => T
) {
  return selector({ setSelectedOrgId: () => undefined });
}

export function useSearch() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return {
    next: mode === 'login-next' ? '/projects/fixture-project' : undefined,
  };
}

export function useParams() {
  return { token: 'fixture-token' };
}

export function useNavigate() {
  return () => undefined;
}

export function useLocation() {
  return { pathname: '/', search: {} };
}

export function Link({
  children,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  return (
    <a
      {...props}
      href="#fixture-project"
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}

export function storeTokens() {}
export function generateVerifier() {
  return 'fixture-verifier';
}
export async function generateChallenge() {
  return 'fixture-challenge';
}
export function storeVerifier() {}
export function storeInvitationToken() {}
