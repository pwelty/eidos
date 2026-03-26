// Browser-side Supabase client — singleton.
// Use in Client Components ('use client').
// RLS is ENFORCED — uses user JWT from cookie.
// NEVER import this in Server Components or API routes.
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (client) return client;
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}
