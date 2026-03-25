import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useThemeSettings } from '@/hooks/use-theme-settings';
import { ServerConfigProvider } from '@/providers/server-config-provider';
import { ThemeSettingsProvider } from '@/providers/theme-settings-provider';
import { WsProvider } from '@/providers/ws-provider';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutInner() {
  const { colorScheme } = useThemeSettings();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ServerConfigProvider>
      <ThemeSettingsProvider>
        <WsProvider>
          <RootLayoutInner />
        </WsProvider>
      </ThemeSettingsProvider>
    </ServerConfigProvider>
  );
}
