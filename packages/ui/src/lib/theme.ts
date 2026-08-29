export const THEME_STORAGE_KEY = 'vibe-kanban.theme-mode';
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export type ThemeMode = 'system' | 'light' | 'dark';
export type EffectiveTheme = Exclude<ThemeMode, 'system'>;

export interface ThemeRoot {
  classList: Pick<DOMTokenList, 'remove' | 'add'>;
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, 'colorScheme'>;
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeMediaQuery {
  matches: boolean;
  addEventListener(
    type: 'change',
    listener: (event: MediaQueryListEvent) => void
  ): void;
  removeEventListener(
    type: 'change',
    listener: (event: MediaQueryListEvent) => void
  ): void;
}

export interface ThemeControllerOptions {
  root: ThemeRoot;
  storage?: ThemeStorage | null;
  mediaQuery?: ThemeMediaQuery | null;
  initialMode?: unknown;
}

export interface ThemeController {
  getMode(): ThemeMode;
  getEffectiveTheme(): EffectiveTheme;
  setMode(mode: unknown): EffectiveTheme;
  subscribe(listener: (theme: EffectiveTheme) => void): () => void;
  destroy(): void;
}

export function normalizeThemeMode(value: unknown): ThemeMode | null {
  if (typeof value !== 'string') {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case 'system':
      return 'system';
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    default:
      return null;
  }
}

export function readThemeMode(
  storage?: ThemeStorage | null,
  fallback: ThemeMode = 'system'
): ThemeMode {
  if (!storage) {
    return fallback;
  }

  try {
    return normalizeThemeMode(storage.getItem(THEME_STORAGE_KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function persistThemeMode(
  mode: ThemeMode,
  storage?: ThemeStorage | null
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function resolveEffectiveTheme(
  mode: ThemeMode,
  prefersDark = false
): EffectiveTheme {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}

export function applyTheme(
  root: ThemeRoot,
  mode: ThemeMode,
  prefersDark = false
): EffectiveTheme {
  const effectiveTheme = resolveEffectiveTheme(mode, prefersDark);

  root.classList.remove('light', 'dark');
  root.classList.add(effectiveTheme);
  root.dataset.theme = effectiveTheme;
  root.dataset.themeMode = mode;
  root.style.colorScheme = effectiveTheme;

  return effectiveTheme;
}

export function createThemeController({
  root,
  storage,
  mediaQuery,
  initialMode,
}: ThemeControllerOptions): ThemeController {
  let mode =
    normalizeThemeMode(initialMode) ?? readThemeMode(storage, 'system');
  let effectiveTheme = applyTheme(root, mode, mediaQuery?.matches ?? false);
  let subscribedToSystem = false;
  const listeners = new Set<(theme: EffectiveTheme) => void>();

  const setEffectiveTheme = (nextTheme: EffectiveTheme) => {
    if (effectiveTheme === nextTheme) {
      return;
    }

    effectiveTheme = nextTheme;
    listeners.forEach((listener) => listener(effectiveTheme));
  };

  const handleSystemThemeChange = (event: MediaQueryListEvent) => {
    if (mode === 'system') {
      setEffectiveTheme(applyTheme(root, mode, event.matches));
    }
  };

  const syncSystemSubscription = () => {
    if (!mediaQuery) {
      return;
    }

    if (mode === 'system' && !subscribedToSystem) {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      subscribedToSystem = true;
    } else if (mode !== 'system' && subscribedToSystem) {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
      subscribedToSystem = false;
    }
  };

  syncSystemSubscription();

  return {
    getMode: () => mode,
    getEffectiveTheme: () => effectiveTheme,
    setMode(value) {
      mode = normalizeThemeMode(value) ?? 'system';
      persistThemeMode(mode, storage);
      syncSystemSubscription();
      setEffectiveTheme(applyTheme(root, mode, mediaQuery?.matches ?? false));
      return effectiveTheme;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (mediaQuery && subscribedToSystem) {
        mediaQuery.removeEventListener('change', handleSystemThemeChange);
        subscribedToSystem = false;
      }
      listeners.clear();
    },
  };
}

export function createBrowserThemeController(
  initialMode?: unknown
): ThemeController | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  let storage: Storage | null = null;
  let mediaQuery: MediaQueryList | null = null;

  try {
    storage = window.localStorage;
  } catch {
    // Storage access can throw before getItem in restricted browser contexts.
  }

  try {
    mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
  } catch {
    // Light is the deterministic fallback when matchMedia is unavailable.
  }

  return createThemeController({
    root: document.documentElement,
    storage,
    mediaQuery,
    initialMode,
  });
}

/**
 * Synchronous bootstrap for Vite's HTML transform. Keep this dependency-free:
 * it executes before React and the app stylesheet are evaluated.
 */
export function getThemeBootstrapScript(): string {
  return `(function(){var r=document.documentElement,m='system',d=false;try{var v=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});m=typeof v==='string'?v.toLowerCase():'system';}catch(_){}if(m!=='light'&&m!=='dark'&&m!=='system')m='system';try{d=!!window.matchMedia&&window.matchMedia(${JSON.stringify(THEME_MEDIA_QUERY)}).matches;}catch(_){}var e=m==='system'?(d?'dark':'light'):m;r.classList.remove('light','dark');r.classList.add(e);r.dataset.theme=e;r.dataset.themeMode=m;r.style.colorScheme=e;})();`;
}

export function getThemeBootstrapTag(): string {
  return `<script>${getThemeBootstrapScript()}</script>`;
}
