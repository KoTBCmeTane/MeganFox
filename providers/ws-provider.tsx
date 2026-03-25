import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useServerConfig } from '@/hooks/use-server-config';

type WsStatus = 'offline' | 'connecting' | 'online';

type WsContextValue = {
  status: WsStatus;
  error: string | null;
  debug: {
    url: string;
    activeUrlIndex: number;
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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldRunRef = useRef(false);
  const subsRef = useRef(new Set<(msg: any) => void>());
  const [status, setStatus] = useState<WsStatus>('offline');
  const [error, setError] = useState<string | null>(null);
  const [lastCloseCode, setLastCloseCode] = useState<number | null>(null);
  const [lastCloseReason, setLastCloseReason] = useState<string | null>(null);
  const [activeUrl, setActiveUrl] = useState('');
  const [activeUrlIndex, setActiveUrlIndex] = useState(0);

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
    const endpoints = [config.wsUrl, config.fallbackWsUrl].filter(Boolean);
    if (!endpoints.length || !config.userId || !config.displayName) return;

    shouldRunRef.current = true;
    setError(null);
    setLastCloseCode(null);
    setLastCloseReason(null);

    let attempt = 0;

    const clearRetry = () => {
      if (!retryTimerRef.current) return;
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };

    const clearPing = () => {
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (pongWatchdogRef.current) {
        clearTimeout(pongWatchdogRef.current);
        pongWatchdogRef.current = null;
      }
    };

    const closeCurrent = () => {
      const current = wsRef.current;
      if (!current) return;
      clearPing();
      wsRef.current = null;
      try {
        current.close();
      } catch {}
    };

    const scheduleRetry = () => {
      if (!shouldRunRef.current) return;
      const delayMs = Math.min(1500 + attempt * 1000, 8000);
      clearRetry();
      retryTimerRef.current = setTimeout(() => {
        connectNext();
      }, delayMs);
    };

    const connectNext = () => {
      if (!shouldRunRef.current) return;
      clearRetry();
      closeCurrent();

      const urlIndex = attempt % endpoints.length;
      const url = endpoints[urlIndex];
      attempt += 1;

      setStatus('connecting');
      setActiveUrl(url);
      setActiveUrlIndex(urlIndex);

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        setStatus('offline');
        setError('bad_ws_url');
        scheduleRetry();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!shouldRunRef.current) return;
        setStatus('online');
        setError(null);
        try {
          ws.send(JSON.stringify({ type: 'hello', userId: config.userId, displayName: config.displayName }));
        } catch {}
        clearPing();
        pingTimerRef.current = setInterval(() => {
          if (!shouldRunRef.current) return;
          if (wsRef.current !== ws || ws.readyState !== 1) return;
          try {
            ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
          } catch {}
          if (pongWatchdogRef.current) clearTimeout(pongWatchdogRef.current);
          pongWatchdogRef.current = setTimeout(() => {
            try {
              ws.close();
            } catch {}
          }, 15000);
        }, 20000);
      };
      ws.onclose = (ev) => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!shouldRunRef.current) return;
        setStatus('offline');
        setLastCloseCode(typeof ev?.code === 'number' ? ev.code : null);
        setLastCloseReason(typeof ev?.reason === 'string' ? ev.reason : null);
        scheduleRetry();
      };
      ws.onerror = () => {
        if (!shouldRunRef.current) return;
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
        if (msg?.type === 'pong') {
          if (pongWatchdogRef.current) {
            clearTimeout(pongWatchdogRef.current);
            pongWatchdogRef.current = null;
          }
          return;
        }
        for (const h of subsRef.current) h(msg);
      };
    };

    connectNext();

    return () => {
      shouldRunRef.current = false;
      clearRetry();
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      if (pongWatchdogRef.current) clearTimeout(pongWatchdogRef.current);
      closeCurrent();
    };
  }, [config.displayName, config.userId, config.wsUrl, config.fallbackWsUrl]);

  const value = useMemo(
    () => ({
      status,
      error,
      debug: { url: activeUrl || config.wsUrl, activeUrlIndex, lastCloseCode, lastCloseReason },
      send,
      subscribe,
    }),
    [status, error, activeUrl, activeUrlIndex, config.wsUrl, lastCloseCode, lastCloseReason, send, subscribe]
  );
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

