import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
