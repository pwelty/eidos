// Admin Supabase client — bypasses RLS via service role key.
// Use ONLY in server-side API routes and server actions for admin operations.
// NEVER import this in client components or expose to the browser.
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// For API key authentication (external integrations).
// Keys are stored as SHA-256 hashes; verify by hashing the incoming token.
export async function lookupApiKey(token: string) {
  const { createHash } = await import("crypto");
  const keyHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id, workspace_id, scopes")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .single();
  if (error || !data) return null;
  return data;
}

// PGRST116 = "row not found" — often a valid no-data case, not an error worth capturing.
export const PGRST116 = "PGRST116";
