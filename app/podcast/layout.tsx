import type { ReactNode } from "react";
import { FaradayGateBoundary } from "@/src/components/gate/FaradayGateBoundary";

/**
 * Faraday beta access gate (FDY-414) for the Panel Podcast pages. /podcast/feed.xml is a route handler, which
 * layouts do not wrap, so the RSS feed stays public for podcast apps.
 */
export default function PodcastLayout({ children }: { children: ReactNode }) {
  return <FaradayGateBoundary>{children}</FaradayGateBoundary>;
}
