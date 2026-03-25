export type AppColorScheme = 'light' | 'dark' | 'system';

export type ThemeSettings = {
  scheme: AppColorScheme;
  accent: string; // hex
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  scheme: 'system',
  accent: '#0a7ea4',
};

export function resolveScheme(system: 'light' | 'dark' | null | undefined, scheme: AppColorScheme) {
  if (scheme === 'system') return system ?? 'light';
  return scheme;
}

