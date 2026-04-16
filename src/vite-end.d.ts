/// <reference types="vite/client" />
declare const GITHUB_RUNTIME_PERMANENT_NAME: string
declare const BASE_KV_SERVICE_URL: string

interface ImportMetaEnv {
  readonly VITE_HUGGINGFACE_API_KEY?: string
  readonly VITE_HUGGINGFACE_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
