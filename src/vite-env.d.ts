/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QK_TEST?: string;
  readonly VITE_DROPBOX_CLIENT_ID?: string;
  readonly VITE_GDRIVE_WEB_CLIENT_ID?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
