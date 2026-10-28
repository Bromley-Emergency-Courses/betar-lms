import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.ASSESSMENT_LOCAL_LIVE_REHEARSAL === "true" ? ".context/assessment-live-next" : ".next",
  experimental: {
    // Registration evidence accepts files up to 25 MiB. Leave multipart
    // overhead below the framework and proxy request limits.
    serverActions: {
      bodySizeLimit: "30mb"
    },
    proxyClientMaxBodySize: "30mb"
  }
};

export default nextConfig;
