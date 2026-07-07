import { useEffect } from 'react';

/**
 * Keeps a global `--app-vh` CSS variable in sync with the visual viewport
 * height.
 *
 * iOS Safari does not shrink `100vh` / `position: fixed; inset: 0` when the
 * on-screen keyboard opens, so a bottom-anchored composer or approval bar gets
 * covered. Driving the mobile shell height from `window.visualViewport.height`
 * (which *does* shrink for the keyboard) fixes this. We write the value to a CSS
 * variable via the DOM rather than React state so viewport changes during the
 * keyboard animation don't re-render the (heavy) app shell.
 *
 * Consumers read it as `height: var(--app-vh, 100dvh)` — the `100dvh` fallback
 * covers the first paint before this effect runs and non-mobile teardown.
 *
 * Pass `enabled = isMobile`; the variable is cleared when disabled.
 */
export function useVisualViewportHeightVar(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      document.documentElement.style.removeProperty('--app-vh');
      return;
    }

    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-vh', `${height}px`);
    };

    update();

    if (viewport) {
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
    } else {
      window.addEventListener('resize', update);
    }

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
      } else {
        window.removeEventListener('resize', update);
      }
      document.documentElement.style.removeProperty('--app-vh');
    };
  }, [enabled]);
}
