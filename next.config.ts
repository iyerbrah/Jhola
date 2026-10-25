import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating dev badge (it only shows in `npm run dev` and gets into screenshots).
  devIndicators: false,
};

export default nextConfig;
