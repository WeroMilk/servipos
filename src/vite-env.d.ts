/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Dominio corporativo para login corto (ej. usuario → usuario@dominio) */
  readonly VITE_SERVIPARTZ_EMAIL_DOMAIN: string;
  /** Ids de sucursal permitidos en la app (coma-separados) */
  readonly VITE_SUCURSAL_IDS?: string;
  readonly VITE_DEFAULT_SUCURSAL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
