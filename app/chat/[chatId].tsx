import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SafeScreen } from '@/components/safe-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedTextInput } from '@/components/themed-text-input';
import { AppIcon } from '@/components/ui/icon';
import { useServerConfig } from '@/hooks/use-server-config';
import { useThemeSettings } from '@/hooks/use-theme-settings';
import { t } from '@/i18n';
import { useWs } from '@/providers/ws-provider';

type ChatItem = {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  audioDataUri?: string | null;
};

export default function ChatScreen() {
  const params = useLocalSearchParams<{ chatId?: string; title?: string }>();
  const chatId = typeof params.chatId === 'string' ? params.chatId : '';
  const title = typeof params.title === 'string' ? params.title : '';

  const { settings } = useThemeSettings();
  const { config } = useServerConfig();
  const { status, send, subscribe } = useWs();

  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [isPlayingId, setIsPlayingId] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const cancelRecordRef = useRef(false);
  const [isRecordingUI, setIsRecordingUI] = useState(false);

  const canJoin = useMemo(
    () => Boolean(chatId && config.wsUrl && config.userId && config.displayName),
    [chatId, config]
  );

  useEffect(() => {
    if (!canJoin) return;
    if (status === 'online') send({ type: 'join', chatId });
    const unsub = subscribe((data) => {
      if (data?.type === 'chat:message' && data.chatId === chatId) {
        const audioDataUri =
          data.audioBase64 && data.audioMime ? `data:${data.audioMime};base64,${data.audioBase64}` : null;
        setMessages((prev) => [
          ...prev,
          {
            id: String(data.clientMsgId ?? data.ts ?? Math.random()),
            from: String(data.fromUserId ?? ''),
            name: String(data.displayName ?? ''),
            text: String(data.text ?? ''),
            ts: Number(data.ts ?? Date.now()),
            audioDataUri,
          },
        ]);
      }
    });
    return unsub;
  }, [canJoin, status, send, subscribe, chatId]);

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    if (status !== 'online') return;
    const clientMsgId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    send({ type: 'chat:message', chatId, clientMsgId, text });
    setDraft('');
  }

  async function startRecording() {
    try {
      if (cancelRecordRef.current) return;
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return;
      if (cancelRecordRef.current) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      if (cancelRecordRef.current) {
        await rec.stopAndUnloadAsync();
        return;
      }
      recordingRef.current = rec;
    } catch {
      recordingRef.current = null;
    }
  }

  async function stopRecordingAndSend() {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) return;
      if (status !== 'online') return;
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const clientMsgId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      send({
        type: 'chat:message',
        chatId,
        clientMsgId,
        text: '',
        audioBase64: base64,
        audioMime: 'audio/m4a',
      });
    } catch {
      // ignore
    }
  }

  async function playAudio(item: ChatItem) {
    if (!item.audioDataUri) return;
    setIsPlayingId(item.id);
    try {
      const { sound } = await Audio.Sound.createAsync({ uri: item.audioDataUri }, { shouldPlay: true });
      sound.setOnPlaybackStatusUpdate((st) => {
        if (!st.isLoaded) return;
        if (st.didJustFinish) {
          setIsPlayingId(null);
          sound.unloadAsync();
        }
      });
    } catch {
      setIsPlayingId(null);
    }
  }

  return (
    <SafeScreen style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="title">{title || t('chat.title')}</ThemedText>
        <ThemedText style={styles.muted}>{status === 'online' ? t('ws.online') : status === 'connecting' ? t('ws.connecting') : t('ws.offline')}</ThemedText>
      </View>

      <View style={styles.list}>
        {messages.slice(-40).map((m) => (
          <View key={m.id} style={[styles.msgRow, m.from === config.userId && styles.msgRowMe]}>
            <ThemedText type="defaultSemiBold">{m.name || '...'}</ThemedText>
            {m.text ? <ThemedText>{m.text}</ThemedText> : null}
            {m.audioDataUri ? (
              <Pressable style={styles.audioBtn} onPress={() => playAudio(m)}>
                <AppIcon name={isPlayingId === m.id ? 'pause-circle' : 'play-circle'} size={24} color={settings.accent} />
                <ThemedText style={styles.audioText}>
                  {isPlayingId === m.id ? t('chat.playing') : t('chat.voice')}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ))}
        {messages.length === 0 ? <ThemedText style={styles.muted}>{t('chat.empty')}</ThemedText> : null}
      </View>

      <View style={styles.composer}>
        <ThemedTextInput value={draft} onChangeText={setDraft} placeholder={t('chat.placeholder')} style={styles.input} />
        <Pressable
          onPress={draft.trim() ? sendMessage : undefined}
          onPressIn={() => {
            if (draft.trim()) return;
            cancelRecordRef.current = false;
            setIsRecordingUI(true);
            startRecording();
          }}
          onPressOut={() => {
            cancelRecordRef.current = true;
            setIsRecordingUI(false);
            if (recordingRef.current) stopRecordingAndSend();
          }}
          style={[
            styles.sendBtn,
            isRecordingUI && {
              backgroundColor: settings.accent,
              borderColor: settings.accent,
            },
          ]}>
          <AppIcon
            name={isRecordingUI ? 'microphone' : draft.trim() ? 'send' : 'microphone-outline'}
            size={20}
            color={isRecordingUI ? '#fff' : settings.accent}
          />
        </Pressable>
      </View>

      {isRecordingUI ? <ThemedText style={styles.recordingLabel}>{t('chat.recording')}</ThemedText> : null}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  muted: { opacity: 0.7, paddingTop: 6 },
  list: { flex: 1, gap: 10, paddingTop: 8 },
  msgRow: { gap: 2, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#99999922' },
  msgRowMe: { borderColor: '#99999944' },
  audioBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  audioText: { opacity: 0.8 },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1 },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99999933',
  },
  recordingLabel: { textAlign: 'center', opacity: 0.9 },
});

