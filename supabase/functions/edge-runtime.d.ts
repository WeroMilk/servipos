/** Tipos mínimos para Edge Functions (Deno). Solo para el IDE; el runtime es Supabase/Deno. */
declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

/** Import URL de Deno — tipado laxo (Edge Functions sin schema Database del frontend). */
declare module 'https://esm.sh/@supabase/supabase-js@2.49.1' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(...args: any[]): any;
}
