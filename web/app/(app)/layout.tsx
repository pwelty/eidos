import { redirect } from "next/navigation";
import { getUser, getUserProfile, getUserWorkspace } from "@/lib/auth";
import AppNav from "@/components/app-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Parallel fetches — layout + page both call getUser() but React.cache()
  // deduplicates within the same render pass (no extra DB round-trips).
  const [user, profile, workspace] = await Promise.all([
    getUser(),
    getUserProfile(),
    getUserWorkspace(),
  ]);

  if (!user) redirect("/login");

  // New users with no workspace go through onboarding.
  if (!workspace) redirect("/onboarding");

  return (
    <div className="flex min-h-screen">
      <AppNav profile={profile} workspace={workspace} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
