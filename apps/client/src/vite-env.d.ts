/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the room server, for example `wss://world-server.fly.dev`. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
