import { useRouterState } from '@tanstack/react-router';

/** Keep route-derived UI aligned with the matches currently rendered by Outlet. */
export function useRenderedPathname(): string {
  return useRouterState({
    // location changes before lazy routes finish loading; matches change with
    // the rendered page. resolvedLocation can lag behind that render instead.
    select: (state) =>
      state.matches.at(-1)?.pathname ?? state.location.pathname,
  });
}
