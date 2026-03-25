import { Link, router } from 'expo-router';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
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

const GLOBAL_CHAT_ID = 'friends';

function dmChatId(a: string, b: string) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return '';
  const [p, q] = x < y ? [x, y] : [y, x];
  return `dm:${p}:${q}`;
}

type ChatItem = {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  audioDataUri?: string | null;
};

type FriendRow = { userId: string; displayName: string; online: boolean };

export default function ChatsScreen() {
  const { settings } = useThemeSettings();
  const { config } = useServerConfig();
  const { status, send, subscribe } = useWs();
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const cancelRecordRef = useRef(false);
  const [isRecordingUI, setIsRecordingUI] = useState(false);
  const [isPlayingId, setIsPlayingId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRow[]>([]);

  const canConnect = useMemo(() => Boolean(config.wsUrl && config.userId && config.displayName), [config]);

  useEffect(() => {
    if (!canConnect) return;
    if (status === 'online') {
      send({ type: 'join', chatId: GLOBAL_CHAT_ID });
      send({ type: 'friends:list' });
    }
    const unsub = subscribe((data) => {
      if (data?.type === 'friends:list') {
        const f = Array.isArray(data.friends) ? data.friends : [];
        const inc = Array.isArray(data.incoming) ? data.incoming : [];
        setFriends(
          f.map((x: any) => ({
            userId: String(x.userId ?? ''),
            displayName: String(x.displayName ?? ''),
            online: Boolean(x.online),
          }))
        );
        setIncoming(
          inc.map((x: any) => ({
            userId: String(x.userId ?? ''),
            displayName: String(x.displayName ?? ''),
            online: Boolean(x.online),
          }))
        );
        return;
      }

      if (data?.type === 'friends:incoming') {
        const row: FriendRow = {
          userId: String(data.fromUserId ?? ''),
          displayName: String(data.displayName ?? ''),
          online: true,
        };
        if (!row.userId) return;
        setIncoming((prev) => (prev.some((p) => p.userId === row.userId) ? prev : [row, ...prev]));
        return;
      }

      if (data?.type === 'friends:accepted') {
        const row: FriendRow = { userId: String(data.byUserId ?? ''), displayName: String(data.displayName ?? ''), online: true };
        if (!row.userId) return;
        setFriends((prev) => (prev.some((p) => p.userId === row.userId) ? prev : [row, ...prev]));
        return;
      }

      if (data?.type === 'chat:presence' && data.chatId === GLOBAL_CHAT_ID) {
        const userId = String(data.userId ?? '');
        const displayName = String(data.displayName ?? '');
        const online = String(data.status ?? '') === 'online';
        if (!userId) return;
        setFriends((prev) =>
          prev.map((p) => (p.userId === userId ? { ...p, displayName: displayName || p.displayName, online } : p))
        );
        setIncoming((prev) =>
          prev.map((p) => (p.userId === userId ? { ...p, displayName: displayName || p.displayName, online } : p))
        );
        return;
      }

      if (data?.type === 'chat:message' && data.chatId === GLOBAL_CHAT_ID) {
        const audioDataUri =
          data.audioBase64 && data.audioMime
            ? `data:${data.audioMime};base64,${data.audioBase64}`
            : null;
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
  }, [canConnect, status, send, subscribe]);

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    if (status !== 'online') return;
    const clientMsgId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    send({ type: 'chat:message', chatId: GLOBAL_CHAT_ID, clientMsgId, text });
    setDraft('');
  }

  async function startRecording() {
    try {
      // user might have already released the button while permissions were opening
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
      setRecording(rec);
    } catch {
      recordingRef.current = null;
      setRecording(null);
    }
  }

  async function stopRecordingAndSend() {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    setRecording(null);
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
        chatId: GLOBAL_CHAT_ID,
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
      const { sound } = await Audio.Sound.createAsync(
        { uri: item.audioDataUri },
        { shouldPlay: true }
      );
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
        <ThemedText type="title">{t('screens.chatsTitle')}</ThemedText>
        <View style={styles.headerActions}>
          <Link href="/modal">
            <Link.Trigger>
              <View style={styles.iconBtn}>
                <AppIcon name="account-plus-outline" size={22} color={settings.accent} />
              </View>
            </Link.Trigger>
          </Link>
          <Pressable style={styles.iconBtn} onPress={() => {}}>
            <AppIcon name="magnify" size={22} color={settings.accent} />
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={() => {}}>
            <AppIcon name="square-edit-outline" size={22} color={settings.accent} />
          </Pressable>
        </View>
      </View>

      <ThemedText style={styles.muted}>
        Сервер: {config.wsUrl} · Статус: {status === 'online' ? 'онлайн' : status === 'connecting' ? 'подключение' : 'оффлайн'}
      </ThemedText>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <ThemedText type="subtitle">{t('friends.friendsTitle')}</ThemedText>
          <Pressable
            style={styles.smallBtn}
            onPress={() => {
              if (status === 'online') send({ type: 'friends:list' });
            }}>
            <AppIcon name="refresh" size={18} color={settings.accent} />
          </Pressable>
        </View>

        {incoming.length > 0 ? (
          <View style={styles.section}>
            <ThemedText style={styles.muted}>{t('friends.incomingTitle')}</ThemedText>
            {incoming.slice(0, 10).map((f) => (
              <View key={`inc-${f.userId}`} style={styles.friendRow}>
                <View style={styles.friendLeft}>
                  <View style={[styles.dot, { backgroundColor: f.online ? '#10b981' : '#999' }]} />
                  <View style={{ gap: 1 }}>
                    <ThemedText type="defaultSemiBold">{f.displayName || f.userId}</ThemedText>
                    <ThemedText style={styles.muted}>{f.userId}</ThemedText>
                  </View>
                </View>
                <Pressable
                  style={styles.acceptBtn}
                  onPress={() => {
                    if (status !== 'online') return;
                    send({ type: 'friends:accept', fromUserId: f.userId });
                    setIncoming((prev) => prev.filter((x) => x.userId !== f.userId));
                    setFriends((prev) => (prev.some((x) => x.userId === f.userId) ? prev : [f, ...prev]));
                  }}>
                  <ThemedText type="defaultSemiBold">{t('friends.accept')}</ThemedText>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {friends.length === 0 ? (
          <ThemedText style={styles.muted}>{t('friends.empty')}</ThemedText>
        ) : (
          <View style={styles.section}>
            {friends.slice(0, 20).map((f) => (
              <Pressable
                key={`fr-${f.userId}`}
                onPress={() => {
                  const chatId = dmChatId(config.userId, f.userId);
                  if (!chatId) return;
                  router.push({
                    pathname: '/chat/[chatId]',
                    params: { chatId, title: f.displayName || f.userId },
                  });
                }}
                style={styles.friendRowBtn}>
                <View style={styles.friendLeft}>
                  <View style={[styles.dot, { backgroundColor: f.online ? '#10b981' : '#999' }]} />
                  <View style={{ gap: 1 }}>
                    <ThemedText type="defaultSemiBold">{f.displayName || f.userId}</ThemedText>
                    <ThemedText style={styles.muted}>{f.online ? t('ws.online') : t('ws.offline')}</ThemedText>
                  </View>
                </View>
                <AppIcon name="chevron-right" size={20} color={settings.accent} />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={styles.list}>
        {messages.slice(-25).map((m) => (
          <View key={m.id} style={styles.msgRow}>
            <ThemedText type="defaultSemiBold">{m.name || '...'}</ThemedText>
            {m.text ? <ThemedText>{m.text}</ThemedText> : null}
            {m.audioDataUri ? (
              <Pressable style={styles.audioBtn} onPress={() => playAudio(m)}>
                <AppIcon
                  name={isPlayingId === m.id ? 'pause-circle' : 'play-circle'}
                  size={24}
                  color={settings.accent}
                />
                <ThemedText style={styles.audioText}>
                  {isPlayingId === m.id ? 'Идёт воспроизведение' : 'Голосовое сообщение'}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ))}
        {messages.length === 0 ? (
          <ThemedText style={styles.muted}>
            Пока пусто. Отправь сообщение — оно придёт всем, кто в комнате "{GLOBAL_CHAT_ID}".
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.composer}>
        <ThemedTextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Сообщение…"
          style={styles.input}
        />
        <Pressable
          onPress={draft.trim() ? sendMessage : undefined}
          onPressIn={() => {
            if (draft.trim()) return; // text mode
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
            (recording || isRecordingUI) && {
              backgroundColor: settings.accent,
              borderColor: settings.accent,
            },
          ]}>
          <AppIcon
            name={recording || isRecordingUI ? 'microphone' : draft.trim() ? 'send' : 'microphone-outline'}
            size={20}
            color={recording || isRecordingUI ? '#fff' : settings.accent}
          />
        </Pressable>
      </View>

      {(recording || isRecordingUI) && (
        <ThemedText style={styles.recordingLabel}>Запись… отпусти, чтобы отправить</ThemedText>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99999933',
  },
  muted: { opacity: 0.7 },
  card: { padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#99999922', gap: 10, marginTop: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  smallBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99999933',
  },
  section: { gap: 8 },
  friendRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#99999922',
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#99999922',
  },
  friendLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 999 },
  acceptBtn: {
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99999933',
  },
  list: { flex: 1, gap: 10, paddingTop: 8 },
  msgRow: { gap: 2, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#99999922' },
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

