// Server-side Supabase client — use in Server Components, layouts, pages.
// Reads cookies (read-only in server components).
// RLS is ENFORCED — uses the anon key + user JWT from cookie.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server components can't set cookies — silently ignore.
            // The proxy.ts middleware handles session refresh.
          }
        },
      },
    },
  );
}
