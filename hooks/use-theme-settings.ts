import { createContext, useContext } from 'react';

import type { ThemeSettings } from '@/constants/app-theme';

export type ThemeSettingsContextValue = {
  hydrated: boolean;
  settings: ThemeSettings;
  update: (patch: Partial<ThemeSettings>) => void;
  colorScheme: 'light' | 'dark';
};

export const ThemeSettingsContext = createContext<ThemeSettingsContextValue | null>(null);

export function useThemeSettings(): ThemeSettingsContextValue {
  const ctx = useContext(ThemeSettingsContext);
  if (!ctx) {
    throw new Error('ThemeSettingsContext is missing. Wrap the app in <ThemeSettingsProvider>.');
  }
  return ctx;
}

