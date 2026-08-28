import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentProviderCapability,
  AgentProviderReadiness,
  BaseCodingAgent,
  ThemeMode,
  type AgentProviderPolicy,
} from 'shared/types';
import { FrontendRedesignHarness } from './frontendRedesignHarness';

function providerPolicy(
  overrides: Partial<AgentProviderPolicy> = {}
): AgentProviderPolicy {
  return {
    executor: BaseCodingAgent.CODEX,
    readiness: AgentProviderReadiness.READY,
    capabilities: [AgentProviderCapability.INITIAL_RUN],
    legacy: false,
    disabled: false,
    diagnostics: [],
    ...overrides,
  };
}

function renderHarness(
  props: Partial<React.ComponentProps<typeof FrontendRedesignHarness>> = {}
) {
  return renderToStaticMarkup(
    <FrontendRedesignHarness
      routeId="/_app/projects/$projectId"
      runtime="local"
      theme={ThemeMode.LIGHT}
      {...props}
    >
      <span>route fixture</span>
    </FrontendRedesignHarness>
  );
}

describe('FrontendRedesignHarness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['local', 'remote'] as const)(
    'reads the %s runtime from the shared AppRuntime provider',
    (runtime) => {
      const markup = renderHarness({ runtime });

      expect(markup).toContain(`data-runtime="${runtime}"`);
      expect(markup).toContain('data-route-id="/_app/projects/$projectId"');
      expect(markup).toContain('data-slot="app-shell"');
      expect(markup).toContain('data-slot="page-canvas"');
      expect(markup).toContain('route fixture');
    }
  );

  it.each([
    [ThemeMode.LIGHT, 'light'],
    [ThemeMode.DARK, 'dark'],
  ] as const)(
    'uses the shared resolver for fixed %s mode',
    (theme, effectiveTheme) => {
      const markup = renderHarness({ theme });

      expect(markup).toContain(`data-theme-mode="${theme}"`);
      expect(markup).toContain(`data-effective-theme="${effectiveTheme}"`);
    }
  );

  it.each([
    [false, 'light'],
    [true, 'dark'],
  ] as const)(
    'uses the shared resolver for System mode when prefers-dark is %s',
    (prefersDark, effectiveTheme) => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn(() => ({ matches: prefersDark })),
      });

      const markup = renderHarness({ theme: ThemeMode.SYSTEM });

      expect(markup).toContain(`data-theme-mode="${ThemeMode.SYSTEM}"`);
      expect(markup).toContain(`data-effective-theme="${effectiveTheme}"`);
    }
  );

  it('uses the shared provider policy for supported capabilities', () => {
    const markup = renderHarness({
      providerPolicy: providerPolicy(),
      requiredCapabilities: [AgentProviderCapability.INITIAL_RUN],
    });

    expect(markup).toContain('data-provider-policy="present"');
    expect(markup).toContain('data-provider-capability-state="available"');
    expect(markup).not.toContain('data-provider-blocked-reason');
  });

  it.each([
    [
      providerPolicy(),
      [AgentProviderCapability.FOLLOW_UP],
      'provider_capability_missing',
    ],
    [
      providerPolicy({ disabled: true }),
      [AgentProviderCapability.INITIAL_RUN],
      'provider_not_ready',
    ],
  ] as const)(
    'projects the shared provider block reason %s',
    (policy, requiredCapabilities, reason) => {
      const markup = renderHarness({
        providerPolicy: policy,
        requiredCapabilities,
      });

      expect(markup).toContain('data-provider-capability-state="blocked"');
      expect(markup).toContain(`data-provider-blocked-reason="${reason}"`);
    }
  );
});
