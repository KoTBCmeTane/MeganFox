import { createContext, useContext } from 'react';

import type { ServerConfig } from '@/constants/server-config';

export type ServerConfigContextValue = {
  hydrated: boolean;
  config: ServerConfig;
  update: (patch: Partial<ServerConfig>) => void;
};

export const ServerConfigContext = createContext<ServerConfigContextValue | null>(null);

export function useServerConfig(): ServerConfigContextValue {
  const ctx = useContext(ServerConfigContext);
  if (!ctx) {
    throw new Error('ServerConfigContext is missing. Wrap the app in <ServerConfigProvider>.');
  }
  return ctx;
}

