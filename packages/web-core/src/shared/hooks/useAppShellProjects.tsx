import { useContext, type ReactNode } from 'react';
import type { ProjectListItem } from 'shared/types';

import { createHmrContext } from '@/shared/lib/hmrContext';

export interface AppShellProjectsState {
  scopeKey: string;
  deployment: 'local' | 'remote';
  hostId: string | null;
  items: readonly ProjectListItem[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  retry(): Promise<void>;
  loadNextPage(): Promise<void>;
}

const AppShellProjectsContext = createHmrContext<AppShellProjectsState | null>(
  'AppShellProjectsContext',
  null
);

export function AppShellProjectsProvider({
  value,
  children,
}: {
  value: AppShellProjectsState;
  children: ReactNode;
}) {
  return (
    <AppShellProjectsContext.Provider value={value}>
      {children}
    </AppShellProjectsContext.Provider>
  );
}

export function useAppShellProjects(): AppShellProjectsState | null {
  return useContext(AppShellProjectsContext);
}
