import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: { "/*": ["./generated/sqlite/**/*"] },
};

export default nextConfig;
