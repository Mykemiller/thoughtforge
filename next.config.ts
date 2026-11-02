import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Panel headshots are committed static WebP (800 / 320 square); next/image
  // only ever needs to serve them at or below those sizes.
  images: {
    formats: ["image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [72, 96, 144, 192, 320, 400, 800],
  },
};

export default nextConfig;
