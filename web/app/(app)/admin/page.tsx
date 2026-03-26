import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Admin — App" };

export default async function AdminPage() {
  // Admin queries use the service role client to bypass RLS.
  const admin = createAdminClient();
  const [{ count: userCount }, { count: workspaceCount }] = await Promise.all([
    admin.from("user_profiles").select("id", { count: "exact", head: true }),
    admin.from("workspaces").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Users</p>
          <p className="text-2xl font-semibold tabular-nums text-right">{userCount ?? 0}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Workspaces</p>
          <p className="text-2xl font-semibold tabular-nums text-right">{workspaceCount ?? 0}</p>
        </div>
      </div>
    </div>
  );
}
