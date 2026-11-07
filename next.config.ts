import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Panel headshots are committed static WebP (800 / 320 square); next/image
  // only ever needs to serve them at or below those sizes.
  images: {
    formats: ["image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [72, 96, 144, 192, 320, 400, 800],
  },
  // Hartford Caldwell was renamed Hartford Nakamura (TF-DEC-92, TH-64); old links keep working.
  async redirects() {
    return [
      { source: "/panel/hartford-caldwell", destination: "/panel/hartford-nakamura", statusCode: 308 },
      { source: "/interview/hartford-caldwell", destination: "/interview/hartford-nakamura", statusCode: 308 },
    ];
  },
};

export default nextConfig;
