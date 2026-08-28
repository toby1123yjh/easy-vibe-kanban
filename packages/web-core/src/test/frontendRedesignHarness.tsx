import type { ReactNode } from 'react';
import {
  type AgentProviderCapability,
  type AgentProviderPolicy,
  ThemeMode,
} from 'shared/types';
import {
  AppRuntimeProvider,
  type AppRuntime,
  useAppRuntime,
} from '@/shared/hooks/useAppRuntime';
import {
  getResolvedTheme,
  ThemeProviderContext,
  useTheme,
} from '@/shared/hooks/useTheme';
import { getAgentProviderBlockedReason } from '@/shared/lib/agentProviderOptions';

export type FrontendRedesignHarnessProps = {
  /**
   * A source route ID from the Phase 0 inventory. This is evidence metadata,
   * not a second route registry.
   */
  routeId: string;
  runtime: AppRuntime;
  theme: ThemeMode;
  providerPolicy?: AgentProviderPolicy | null;
  requiredCapabilities?: readonly AgentProviderCapability[];
  children?: ReactNode;
};

type FrontendRedesignContractProbeProps = Omit<
  FrontendRedesignHarnessProps,
  'runtime' | 'theme'
>;

function FrontendRedesignContractProbe({
  routeId,
  providerPolicy = null,
  requiredCapabilities = [],
  children,
}: FrontendRedesignContractProbeProps) {
  const runtime = useAppRuntime();
  const { theme } = useTheme();
  const effectiveTheme = getResolvedTheme(theme);
  const providerBlockedReason = getAgentProviderBlockedReason(
    providerPolicy,
    requiredCapabilities
  );

  return (
    <section
      data-component="frontend-redesign-harness"
      data-route-id={routeId}
      data-runtime={runtime}
      data-theme-mode={theme}
      data-effective-theme={effectiveTheme}
      data-provider-policy={providerPolicy ? 'present' : 'absent'}
      data-provider-capability-state={
        providerBlockedReason === null ? 'available' : 'blocked'
      }
      data-provider-blocked-reason={providerBlockedReason ?? undefined}
    >
      <header data-slot="app-shell" />
      <main data-slot="page-canvas">{children}</main>
    </section>
  );
}

/**
 * Test-only adapter around the current shared runtime, theme, and Agent
 * provider contracts. It deliberately owns no route, theme, or capability
 * enum, so production contract drift is visible to characterization tests.
 */
export function FrontendRedesignHarness({
  routeId,
  runtime,
  theme,
  providerPolicy,
  requiredCapabilities,
  children,
}: FrontendRedesignHarnessProps) {
  return (
    <AppRuntimeProvider runtime={runtime}>
      <ThemeProviderContext.Provider
        value={{ theme, setTheme: () => undefined }}
      >
        <FrontendRedesignContractProbe
          routeId={routeId}
          providerPolicy={providerPolicy}
          requiredCapabilities={requiredCapabilities}
        >
          {children}
        </FrontendRedesignContractProbe>
      </ThemeProviderContext.Provider>
    </AppRuntimeProvider>
  );
}
