// Cached auth helpers for server components.
// React.cache() deduplicates calls within the same render pass —
// layout and page both calling getUser() only hits the DB once.
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export const getUser = cache(async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getUserProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("user_profiles")
    .select("id, name, avatar_url, admin")
    .eq("id", user.id)
    .single();
  return data;
});

export const getUserWorkspace = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  // Use .limit(1).single() — NOT bare .single() — to handle multiple memberships.
  const { data } = await supabase
    .from("memberships")
    .select("workspace_id, role, workspaces(id, name, slug)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  return data;
});
