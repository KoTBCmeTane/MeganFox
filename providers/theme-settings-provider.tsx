import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import {
  DEFAULT_THEME_SETTINGS,
  type ThemeSettings,
  resolveScheme,
} from '@/constants/app-theme';
import { ThemeSettingsContext } from '@/hooks/use-theme-settings';

const STORAGE_KEY = 'themeSettings:v1';

export function ThemeSettingsProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [settings, setSettings] = useState<ThemeSettings>(DEFAULT_THEME_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
        if (cancelled) return;
        setSettings((prev) => ({
          ...prev,
          ...parsed,
          accent: typeof parsed.accent === 'string' ? parsed.accent : prev.accent,
          scheme:
            parsed.scheme === 'light' || parsed.scheme === 'dark' || parsed.scheme === 'system'
              ? parsed.scheme
              : prev.scheme,
        }));
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [hydrated, settings]);

  const colorScheme = useMemo(
    () => resolveScheme(systemScheme, settings.scheme),
    [systemScheme, settings.scheme]
  );

  const update = useCallback((patch: Partial<ThemeSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(
    () => ({ hydrated, settings, update, colorScheme }),
    [hydrated, settings, update, colorScheme]
  );

  return <ThemeSettingsContext.Provider value={value}>{children}</ThemeSettingsContext.Provider>;
}

