import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SafeScreen } from '@/components/safe-screen';
import { ThemedTextInput } from '@/components/themed-text-input';
import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/icon';
import { useThemeSettings } from '@/hooks/use-theme-settings';
import { useWs } from '@/providers/ws-provider';
import { t } from '@/i18n';

export default function ModalScreen() {
  const { settings } = useThemeSettings();
  const { status, send } = useWs();
  const [toUserId, setToUserId] = useState('');
  const canSend = useMemo(() => status === 'online' && toUserId.trim().length > 0, [status, toUserId]);

  return (
    <SafeScreen style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">{t('friends.addTitle')}</ThemedText>
        <AppIcon name="account-plus-outline" size={22} color={settings.accent} />
      </View>

      <ThemedText style={styles.muted}>
        Статус соединения: {status === 'online' ? 'онлайн' : status === 'connecting' ? 'подключение' : 'оффлайн'}
      </ThemedText>

      <ThemedTextInput
        value={toUserId}
        onChangeText={setToUserId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('friends.userIdPlaceholder')}
      />

      <Pressable
        disabled={!canSend}
        onPress={() => {
          send({ type: 'friends:request', toUserId: toUserId.trim() });
          router.back();
        }}
        style={[styles.primaryBtn, !canSend && styles.primaryBtnDisabled]}>
        <ThemedText type="defaultSemiBold">{t('friends.sendRequest')}</ThemedText>
      </Pressable>

      <Pressable onPress={() => router.back()} style={styles.secondaryBtn}>
        <ThemedText type="link">{t('friends.close')}</ThemedText>
      </Pressable>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { opacity: 0.7 },
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99999933',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  secondaryBtn: { height: 48, alignItems: 'center', justifyContent: 'center' },
});
