import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot() {
  return window.matchMedia(query).matches;
}

/** For imperative animations that cannot be disabled by a CSS media query. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
