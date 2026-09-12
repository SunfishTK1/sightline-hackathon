import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep Turbopack rooted at the app, not a parent lockfile outside the git repo
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
