import { Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useMemo, useState } from 'react';

import { SafeScreen } from '@/components/safe-screen';
import { ThemedTextInput } from '@/components/themed-text-input';
import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/icon';
import type { AppColorScheme } from '@/constants/app-theme';
import { useServerConfig } from '@/hooks/use-server-config';
import { useThemeSettings } from '@/hooks/use-theme-settings';
import { t } from '@/i18n';
import { useWs } from '@/providers/ws-provider';

const PRESET_ACCENTS = ['#0a7ea4', '#7c3aed', '#ef4444', '#10b981', '#f59e0b'];

export default function SettingsScreen() {
  const { settings, update, colorScheme } = useThemeSettings();
  const { config, update: updateServer } = useServerConfig();
  const { status: wsStatus, error: wsError, debug } = useWs();
  const [wsDraft, setWsDraft] = useState(config.wsUrl);

  useEffect(() => {
    setWsDraft(config.wsUrl);
  }, [config.wsUrl]);

  const wsDirty = useMemo(() => wsDraft.trim() !== config.wsUrl, [config.wsUrl, wsDraft]);
  const wsDraftTrim = useMemo(() => wsDraft.trim(), [wsDraft]);
  const wsLooksValid = useMemo(() => /^wss?:\/\/.+/i.test(wsDraftTrim), [wsDraftTrim]);

  return (
    <SafeScreen style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="title">{t('screens.settingsTitle')}</ThemedText>
        <AppIcon name="palette-outline" size={22} color={settings.accent} />
      </View>

      <ThemedText type="subtitle">{t('settings.theme')}</ThemedText>
      <ThemedText style={styles.muted}>
        {t('settings.activeScheme')}: {colorScheme}
      </ThemedText>

      <View style={styles.row}>
        {(['system', 'light', 'dark'] as const satisfies readonly AppColorScheme[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => update({ scheme: s })}
            style={[styles.chip, settings.scheme === s && styles.chipActive]}>
            <ThemedText type="defaultSemiBold">
              {s === 'system' ? t('settings.system') : s === 'light' ? t('settings.light') : t('settings.dark')}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText type="subtitle">{t('settings.accent')}</ThemedText>
      <View style={styles.row}>
        {PRESET_ACCENTS.map((c) => (
          <Pressable
            key={c}
            onPress={() => update({ accent: c })}
            style={[styles.swatch, { backgroundColor: c }, settings.accent === c && styles.swatchActive]}
          />
        ))}
      </View>

      <ThemedText style={styles.muted}>{t('settings.enterHex')}</ThemedText>
      <ThemedTextInput
        value={settings.accent}
        onChangeText={(t) => update({ accent: t.trim() })}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="#0a7ea4"
      />

      <ThemedText type="subtitle">{t('settings.server')}</ThemedText>
      <ThemedText style={styles.muted}>
        WS: {wsStatus === 'online' ? 'онлайн' : wsStatus === 'connecting' ? 'подключение' : 'оффлайн'}
        {wsError ? ` · ошибка: ${wsError === 'bad_ws_url' ? 'неверный адрес' : 'не удалось подключиться'}` : ''}
      </ThemedText>
      <ThemedText style={styles.muted}>
        URL: {debug.url || '(пусто)'}
        {debug.lastCloseCode !== null ? ` · close=${debug.lastCloseCode}` : ''}
        {debug.lastCloseReason ? ` · reason=${debug.lastCloseReason}` : ''}
      </ThemedText>
      <ThemedText style={styles.muted}>{t('settings.wsUrl')}</ThemedText>
      <ThemedTextInput
        value={wsDraft}
        onChangeText={setWsDraft}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="ws://192.168.1.50:8080"
      />
      <Pressable
        disabled={!wsDirty || !wsLooksValid}
        onPress={() => updateServer({ wsUrl: wsDraftTrim })}
        style={[styles.primaryBtn, (!wsDirty || !wsLooksValid) && styles.primaryBtnDisabled]}>
        <ThemedText type="defaultSemiBold">Применить адрес</ThemedText>
      </Pressable>
      {!wsLooksValid ? (
        <ThemedText style={styles.muted}>Адрес должен начинаться с ws:// или wss://</ThemedText>
      ) : null}

      <ThemedText style={styles.muted}>{t('settings.displayName')}</ThemedText>
      <ThemedTextInput
        value={config.displayName}
        onChangeText={(v) => updateServer({ displayName: v })}
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="Саша"
      />

      <ThemedText style={styles.muted}>
        {t('settings.userId')}: {config.userId}
      </ThemedText>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { opacity: 0.7 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#99999955' },
  chipActive: { borderColor: '#999999cc' },
  swatch: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#00000022' },
  swatchActive: { borderColor: '#00000088' },
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99999933',
  },
  primaryBtnDisabled: { opacity: 0.5 },
});

