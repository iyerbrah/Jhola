import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating dev badge (it only shows in `npm run dev` and gets into screenshots).
  devIndicators: false,
  // The eval results and the live stats became one Results page.
  async redirects() {
    return [
      { source: "/evals", destination: "/results", permanent: true },
      { source: "/stats", destination: "/results", permanent: true },
    ];
  },
};

export default nextConfig;
