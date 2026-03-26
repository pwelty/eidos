import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PostHog CORS proxy — prevents ad-blocker blocking of analytics
  // Initialize PostHog with api_host: "/ingest" in your provider
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
};

export default nextConfig;
