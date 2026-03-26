"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import Sentry from "@sentry/nextjs";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createWorkspace({ name }: { name: string }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .insert({ name, slug })
    .select("id")
    .single();

  if (wsError) {
    Sentry.captureException(new Error(`createWorkspace failed: ${wsError.message}`), {
      extra: { userId: user.id, name },
    });
    return { error: "Failed to create workspace. Please try again." };
  }

  const { error: memberError } = await supabase.from("memberships").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner",
  });

  if (memberError) {
    Sentry.captureException(new Error(`createWorkspace membership failed: ${memberError.message}`), {
      extra: { userId: user.id, workspaceId: workspace.id },
    });
    return { error: "Workspace created but membership failed. Contact support." };
  }

  revalidatePath("/dashboard");
  return { workspaceId: workspace.id };
}
