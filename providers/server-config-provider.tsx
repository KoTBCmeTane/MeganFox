import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@/constants/server-config';
import { ServerConfigContext } from '@/hooks/use-server-config';

const STORAGE_KEY = 'serverConfig:v1';

function randomId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function normalizeWsUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  // handle values like '""' or '"ws://host:8080"'
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1).trim();
  if (!s) return null;
  if (!/^wss?:\/\/.+/i.test(s)) return null;
  return s;
}

export function ServerConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ServerConfig>(() => ({
    ...DEFAULT_SERVER_CONFIG,
    userId: randomId(),
  }));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<ServerConfig>;
        if (cancelled) return;
        setConfig((prev) => ({
          ...prev,
          ...parsed,
          wsUrl: normalizeWsUrl(parsed.wsUrl) ?? prev.wsUrl,
          fallbackWsUrl: normalizeWsUrl(parsed.fallbackWsUrl) ?? prev.fallbackWsUrl,
          userId: typeof parsed.userId === 'string' && parsed.userId ? parsed.userId : prev.userId,
          displayName: typeof parsed.displayName === 'string' && parsed.displayName ? parsed.displayName : prev.displayName,
        }));
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config)).catch(() => {});
  }, [hydrated, config]);

  const update = useCallback((patch: Partial<ServerConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      const normalized = normalizeWsUrl(next.wsUrl);
      if (normalized) next.wsUrl = normalized;
      const normalizedFallback = normalizeWsUrl(next.fallbackWsUrl);
      if (normalizedFallback) next.fallbackWsUrl = normalizedFallback;
      return next;
    });
  }, []);

  const value = useMemo(() => ({ hydrated, config, update }), [hydrated, config, update]);

  return <ServerConfigContext.Provider value={value}>{children}</ServerConfigContext.Provider>;
}

