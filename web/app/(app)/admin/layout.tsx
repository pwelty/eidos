// Admin layout guard — blocks non-admins with notFound() (no information leak).
// Every admin server action must ALSO check admin status independently —
// layout guards don't protect server actions called from arbitrary clients.
import { notFound } from "next/navigation";
import { getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) notFound();

  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("admin")
    .eq("id", user.id)
    .single();

  if (!profile?.admin) notFound();

  return (
    <div>
      <div className="border-b px-6 py-3 text-sm text-muted-foreground font-medium">
        Admin
      </div>
      {children}
    </div>
  );
}
