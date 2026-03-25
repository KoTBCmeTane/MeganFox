import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useServerConfig } from '@/hooks/use-server-config';

type WsStatus = 'offline' | 'connecting' | 'online';

type WsContextValue = {
  status: WsStatus;
  error: string | null;
  debug: {
    url: string;
    lastCloseCode: number | null;
    lastCloseReason: string | null;
  };
  send: (obj: any) => void;
  subscribe: (handler: (msg: any) => void) => () => void;
};

const WsContext = createContext<WsContextValue | null>(null);

export function useWs(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('WsContext is missing. Wrap the app in <WsProvider>.');
  return ctx;
}

export function WsProvider({ children }: { children: React.ReactNode }) {
  const { config } = useServerConfig();
  const wsRef = useRef<WebSocket | null>(null);
  const subsRef = useRef(new Set<(msg: any) => void>());
  const [status, setStatus] = useState<WsStatus>('offline');
  const [error, setError] = useState<string | null>(null);
  const [lastCloseCode, setLastCloseCode] = useState<number | null>(null);
  const [lastCloseReason, setLastCloseReason] = useState<string | null>(null);

  const subscribe = useCallback((handler: (msg: any) => void) => {
    subsRef.current.add(handler);
    return () => subsRef.current.delete(handler);
  }, []);

  const send = useCallback((obj: any) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(obj));
  }, []);

  useEffect(() => {
    if (!config.wsUrl || !config.userId || !config.displayName) return;
    setStatus('connecting');
    setError(null);
    setLastCloseCode(null);
    setLastCloseReason(null);

    let ws;
    try {
      ws = new WebSocket(config.wsUrl);
    } catch {
      setStatus('offline');
      setError('bad_ws_url');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('online');
      setError(null);
      try {
        ws.send(JSON.stringify({ type: 'hello', userId: config.userId, displayName: config.displayName }));
      } catch {}
    };
    ws.onclose = (ev) => {
      setStatus('offline');
      setLastCloseCode(typeof ev?.code === 'number' ? ev.code : null);
      setLastCloseReason(typeof ev?.reason === 'string' ? ev.reason : null);
    };
    ws.onerror = () => {
      setStatus('offline');
      setError('connect_error');
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      for (const h of subsRef.current) h(msg);
    };

    return () => {
      try {
        ws.close();
      } catch {}
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [config.displayName, config.userId, config.wsUrl]);

  const value = useMemo(
    () => ({
      status,
      error,
      debug: { url: config.wsUrl, lastCloseCode, lastCloseReason },
      send,
      subscribe,
    }),
    [status, error, config.wsUrl, lastCloseCode, lastCloseReason, send, subscribe]
  );
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

