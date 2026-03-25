/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVE_MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
