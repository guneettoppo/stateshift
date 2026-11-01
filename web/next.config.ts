import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Next 16 blocks dev resources for hosts not listed here; without this the
     page loads but never hydrates when opened via 127.0.0.1 instead of
     localhost. */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  /* Route all /api/* traffic to the StateShift coordinator. */
  async rewrites() {
    const backend = process.env.STATESHIFT_API || "http://127.0.0.1:9100";
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
