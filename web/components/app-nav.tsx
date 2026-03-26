"use client";

// Export NAV_GROUPS as a named constant so tests can assert completeness
// and catch desktop/mobile nav drift at commit time.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV_GROUPS = [
  {
    label: "Main",
    items: [{ href: "/dashboard", label: "Dashboard" }],
  },
  {
    label: "Settings",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

interface Props {
  profile: { name: string | null; admin: boolean | null } | null;
  workspace: { workspaces: { name: string } | null } | null;
}

export default function AppNav({ profile, workspace }: Props) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col w-56 border-r min-h-screen p-4 gap-1 shrink-0">
      <div className="mb-4 px-2">
        <p className="text-sm font-semibold truncate">
          {workspace?.workspaces?.name ?? "App"}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {profile?.name ?? ""}
        </p>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-2">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {group.label}
          </p>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center px-2 py-1.5 rounded-md text-sm transition-colors",
                pathname.startsWith(item.href)
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}

      {profile?.admin && (
        <div className="mt-auto">
          <Link
            href="/admin"
            className={cn(
              "flex items-center px-2 py-1.5 rounded-md text-sm transition-colors",
              pathname.startsWith("/admin")
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            Admin
          </Link>
        </div>
      )}
    </nav>
  );
}
