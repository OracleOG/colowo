import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Bank files are uploaded through a server action (files are ~50 KB; limit is 5 MB).
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
