import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { SafeScreen } from '@/components/safe-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedTextInput } from '@/components/themed-text-input';
import { AppIcon } from '@/components/ui/icon';
import { useServerConfig } from '@/hooks/use-server-config';
import { useThemeSettings } from '@/hooks/use-theme-settings';
import { t } from '@/i18n';
import { useWs } from '@/providers/ws-provider';

// react-native-webrtc: используется в dev-build/APK (не Expo Go)
import { RTCView, mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } from 'react-native-webrtc';

type CallState = 'idle' | 'calling' | 'ringing' | 'in_call' | 'ended';

type IncomingCall = {
  callId: string;
  fromUserId: string;
  fromDisplayName: string;
};

type ActiveCall = {
  callId: string;
  peerUserId: string;
};

export default function CallsScreen() {
  const { settings } = useThemeSettings();
  const { config } = useServerConfig();
  const { status, send, subscribe } = useWs();

  const [toUserId, setToUserId] = useState('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  const [remoteStreamURL, setRemoteStreamURL] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<any>(null); // MediaStream

  const canCall = useMemo(
    () =>
      status === 'online' && toUserId.trim().length > 0 && toUserId.trim() !== config.userId,
    [status, toUserId, config.userId]
  );

  function cleanupPeer() {
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      localStreamRef.current?.getTracks?.().forEach((tr: any) => tr.stop());
    } catch {}
    localStreamRef.current = null;
    setRemoteStreamURL(null);
    setIsMuted(false);
  }

  async function ensureLocalStream() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    localStreamRef.current = stream;
    return stream;
  }

  function createPeerConnection(peerUserId: string) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pcRef.current = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !activeCall) return;
      send({
        type: 'signal',
        toUserId: peerUserId,
        payload: { kind: 'ice', callId: activeCall.callId, candidate: ev.candidate },
      });
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0];
      if (stream?.toURL) setRemoteStreamURL(stream.toURL());
    };

    return pc;
  }

  async function startOutgoingCall() {
    if (!canCall) return;
    const callId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const peer = toUserId.trim();

    setActiveCall({ callId, peerUserId: peer });
    setCallState('calling');
    setIncoming(null);
    cleanupPeer();

    send({ type: 'call:invite', toUserId: peer, callId });
  }

  async function acceptIncomingCall() {
    if (!incoming) return;
    const peer = incoming.fromUserId;
    const callId = incoming.callId;

    setActiveCall({ callId, peerUserId: peer });
    setCallState('in_call');
    setIncoming(null);
    cleanupPeer();

    // notify caller
    send({ type: 'call:accept', toUserId: peer, callId });

    const pc = createPeerConnection(peer);
    const localStream = await ensureLocalStream();
    localStream.getTracks?.().forEach((tr: any) => pc.addTrack(tr, localStream));
  }

  function rejectIncomingCall() {
    if (!incoming) return;
    send({ type: 'call:reject', toUserId: incoming.fromUserId, callId: incoming.callId });
    setIncoming(null);
    setCallState('idle');
    setActiveCall(null);
    cleanupPeer();
  }

  function endCall() {
    if (!activeCall) return;
    send({ type: 'call:hangup', toUserId: activeCall.peerUserId, callId: activeCall.callId });
    setCallState('idle');
    setIncoming(null);
    setActiveCall(null);
    cleanupPeer();
  }

  useEffect(() => {
    return subscribe(async (data) => {
      if (data?.type === 'call:invite') {
        cleanupPeer();
        setActiveCall(null);
        setIncoming({
          callId: String(data.callId ?? ''),
          fromUserId: String(data.fromUserId ?? ''),
          fromDisplayName: String(data.fromDisplayName ?? ''),
        });
        setCallState('ringing');
        return;
      }

      if (data?.type === 'call:invite:error') {
        // callee offline
        setCallState('idle');
        setActiveCall(null);
        setIncoming(null);
        cleanupPeer();
        return;
      }

      if (data?.type === 'call:accept') {
        if (!activeCall) return;
        const callId = String(data.callId ?? '');
        if (callId !== activeCall.callId) return;

        setCallState('in_call');
        cleanupPeer();

        const peer = activeCall.peerUserId;
        const pc = createPeerConnection(peer);
        const localStream = await ensureLocalStream();
        localStream.getTracks?.().forEach((tr: any) => pc.addTrack(tr, localStream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({
          type: 'signal',
          toUserId: peer,
          payload: { kind: 'offer', callId, sdp: offer },
        });
        return;
      }

      if (data?.type === 'call:reject') {
        setCallState('idle');
        setActiveCall(null);
        setIncoming(null);
        cleanupPeer();
        return;
      }

      if (data?.type === 'call:hangup') {
        setCallState('idle');
        setActiveCall(null);
        setIncoming(null);
        cleanupPeer();
        return;
      }

      if (data?.type === 'signal') {
        const payload = data.payload ?? {};
        const callId = String(payload.callId ?? '');
        if (!activeCall || callId !== activeCall.callId) return;
        const pc = pcRef.current;
        if (!pc) return;

        const kind = payload.kind;
        if (kind === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          send({
            type: 'signal',
            toUserId: activeCall.peerUserId,
            payload: { kind: 'answer', callId, sdp: ans },
          });
          return;
        }

        if (kind === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          return;
        }

        if (kind === 'ice') {
          if (!payload.candidate) return;
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          return;
        }
      }
    });
  }, [activeCall, send, subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeScreen style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="title">{t('calls.title')}</ThemedText>
        <View style={styles.headerActions}>
          <AppIcon name="phone-fill" size={22} color={settings.accent} />
        </View>
      </View>

      <ThemedText style={styles.muted}>
        {`WS: ${
          status === 'online' ? 'онлайн' : status === 'connecting' ? 'подключение' : 'оффлайн'
        }`}
      </ThemedText>

      <View style={styles.card}>
        <ThemedText style={styles.label}>{t('calls.toUserId')}</ThemedText>
        <ThemedTextInput value={toUserId} onChangeText={setToUserId} placeholder="ID пользователя" />

        <Pressable disabled={!canCall} onPress={startOutgoingCall} style={[styles.primaryBtn, !canCall && styles.primaryBtnDisabled]}>
          <ThemedText type="defaultSemiBold" style={{ color: '#fff' }}>
            {t('calls.call')}
          </ThemedText>
        </Pressable>
      </View>

      {callState === 'ringing' && incoming ? (
        <View style={styles.callOverlay}>
          <ThemedText type="title">{t('calls.incoming')}</ThemedText>
          <ThemedText style={styles.mutedText}>{incoming.fromDisplayName}</ThemedText>
          <View style={styles.row}>
            <Pressable onPress={acceptIncomingCall} style={[styles.primaryBtn, { flex: 1 }]}>
              <ThemedText type="defaultSemiBold" style={{ color: '#fff' }}>
                {t('calls.accept')}
              </ThemedText>
            </Pressable>
            <Pressable onPress={rejectIncomingCall} style={[styles.secondaryBtn, { flex: 1 }]}>
              <ThemedText type="defaultSemiBold">{t('calls.reject')}</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {callState === 'calling' ? (
        <View style={styles.callOverlay}>
          <ThemedText type="title">{t('calls.ringing')}</ThemedText>
          <ThemedText style={styles.mutedText}>Ожидаем ответа…</ThemedText>
          <Pressable onPress={endCall} style={[styles.secondaryBtn, { marginTop: 12 }]}>
            <ThemedText type="defaultSemiBold">{t('calls.end')}</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {callState === 'in_call' ? (
        <View style={styles.callOverlay}>
          {/* RTCView нужно отрисовать, чтобы удаленный трек гарантированно начал играть */}
          {remoteStreamURL ? (
            <View style={styles.rtcCircle}>
              <RTCView streamURL={remoteStreamURL} style={styles.rtcCircleInner} mirror={true} />
            </View>
          ) : (
            <View style={styles.rtcCircle} />
          )}

          <ThemedText type="title">{t('calls.inCall')}</ThemedText>
          <ThemedText style={styles.mutedText}>
            {isMuted ? t('calls.micOff') : t('calls.micOn')}
          </ThemedText>

          <View style={styles.row}>
            <Pressable
              onPress={() => {
                setIsMuted((v) => {
                  const next = !v;
                  localStreamRef.current?.getAudioTracks?.().forEach((tr: any) => {
                    tr.enabled = !next;
                  });
                  return next;
                });
              }}
              style={[styles.secondaryBtn, { flex: 1 }]}
            >
              <ThemedText type="defaultSemiBold">{isMuted ? 'Вкл mic' : 'Выкл mic'}</ThemedText>
            </Pressable>
            <Pressable onPress={endCall} style={[styles.primaryBtn, { flex: 1 }]}>
              <ThemedText type="defaultSemiBold" style={{ color: '#fff' }}>
                {t('calls.end')}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muted: { opacity: 0.7 },
  label: { opacity: 0.7 },
  mutedText: { opacity: 0.8 },
  card: { padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#99999922', gap: 10 },
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a7ea4',
  },
  primaryBtnDisabled: { opacity: 0.6 },
  secondaryBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#99999955',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callOverlay: {
    marginTop: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#99999922',
    gap: 10,
  },
  row: { flexDirection: 'row', gap: 12 },
  rtcCircle: {
    width: 92,
    height: 92,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#99999922',
    alignSelf: 'center',
    backgroundColor: '#00000022',
  },
  rtcCircleInner: { width: '100%', height: '100%' },
});

