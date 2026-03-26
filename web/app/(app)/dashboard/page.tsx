import { getUserProfile, getUserWorkspace } from "@/lib/auth";

export const metadata = { title: "Dashboard — App" };

export default async function DashboardPage() {
  // Parallel fetches — both are React.cache()-deduplicated against the layout's calls.
  const [profile, workspace] = await Promise.all([
    getUserProfile(),
    getUserWorkspace(),
  ]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">
        Welcome back, {profile?.name ?? "there"} — {workspace?.workspaces?.name}
      </p>
      {/* Replace with your actual dashboard content */}
    </div>
  );
}
