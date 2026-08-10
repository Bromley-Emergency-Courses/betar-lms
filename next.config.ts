import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
