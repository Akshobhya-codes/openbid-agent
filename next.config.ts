import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Guava SDK holds a WebSocket for each call; keep it as a plain Node dependency.
  serverExternalPackages: ["@guava-ai/guava-sdk"],
};

export default nextConfig;
