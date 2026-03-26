// proxy.ts — Next.js 16 (renamed from middleware.ts)
// Runs on Node.js runtime. Do NOT add `export const runtime = "edge"`.
//
// Refreshes the Supabase session on every request so the user's auth
// cookie stays valid. Only intercepts routes that need auth checking.
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

// Only run on app routes — exclude static assets and API routes that
// handle their own auth. Be specific; catch-all matchers cause loops.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/(app)/:path*",
  ],
};
