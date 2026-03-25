export type ServerConfig = {
  wsUrl: string;
  userId: string;
  displayName: string;
};

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  // for Android emulator: ws://10.0.2.2:8080
  // for real phone: use ws://<PC_LAN_IP>:8080
  wsUrl: '',
  userId: '',
  displayName: 'Я',
};

