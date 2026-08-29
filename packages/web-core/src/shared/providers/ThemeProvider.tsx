import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createBrowserThemeController,
  normalizeThemeMode,
  readThemeMode,
  resolveEffectiveTheme,
  type EffectiveTheme,
  type ThemeController,
  type ThemeMode as UiThemeMode,
} from '@vibe/ui/lib/theme';
import { ThemeMode } from 'shared/types';

import { ThemeProviderContext } from '@/shared/hooks/useTheme';

export interface ThemeProviderProps {
  children: React.ReactNode;
  initialTheme?: ThemeMode;
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const controllerRef = useRef<ThemeController | null>(null);
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const initialMode = normalizeThemeMode(initialTheme);
    if (initialMode) {
      return toApiThemeMode(initialMode);
    }

    if (typeof window === 'undefined') {
      return ThemeMode.SYSTEM;
    }

    return toApiThemeMode(readThemeMode(getBrowserStorage()));
  });
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>(() =>
    resolveEffectiveTheme(toUiThemeMode(theme), getBrowserPrefersDark())
  );

  useEffect(() => {
    const controller = createBrowserThemeController(theme);
    if (!controller) {
      return;
    }

    controllerRef.current = controller;
    setEffectiveTheme(controller.getEffectiveTheme());
    const unsubscribe = controller.subscribe(setEffectiveTheme);

    return () => {
      unsubscribe();
      controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const nextMode = normalizeThemeMode(initialTheme);
    if (!nextMode) {
      return;
    }

    const nextTheme = toApiThemeMode(nextMode);
    setThemeState(nextTheme);
    controllerRef.current?.setMode(nextMode);
  }, [initialTheme]);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    const nextMode = normalizeThemeMode(newTheme) ?? 'system';
    setThemeState(toApiThemeMode(nextMode));
    controllerRef.current?.setMode(nextMode);
  }, []);

  const contextValue = useMemo(
    () => ({ theme, effectiveTheme, setTheme }),
    [effectiveTheme, setTheme, theme]
  );

  return (
    <ThemeProviderContext.Provider value={contextValue}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

function toApiThemeMode(mode: UiThemeMode): ThemeMode {
  switch (mode) {
    case 'light':
      return ThemeMode.LIGHT;
    case 'dark':
      return ThemeMode.DARK;
    case 'system':
      return ThemeMode.SYSTEM;
  }
}

function toUiThemeMode(mode: ThemeMode): UiThemeMode {
  switch (mode) {
    case ThemeMode.LIGHT:
      return 'light';
    case ThemeMode.DARK:
      return 'dark';
    case ThemeMode.SYSTEM:
      return 'system';
  }
}

function getBrowserPrefersDark(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  } catch {
    return false;
  }
}

function getBrowserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
