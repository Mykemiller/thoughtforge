import type { ReactNode } from "react";
import { FaradayGateBoundary } from "@/src/components/gate/FaradayGateBoundary";

/**
 * Faraday beta access gate (FDY-414) for the Panel Podcast pages. /podcast/feed.xml is a route handler, which
 * layouts do not wrap, so the RSS feed stays public for podcast apps. FDY-433 (ADM-1.7h) keeps it that way in every
 * gate mode: do not turn feed.xml into a page or add a gate to proxy.ts for it (TF_GATE_PUBLIC_PATHS in
 * src/lib/faradayGate.ts; src/lib/faradayGateCarveout.test.ts checks this).
 */
export default function PodcastLayout({ children }: { children: ReactNode }) {
  return <FaradayGateBoundary>{children}</FaradayGateBoundary>;
}
