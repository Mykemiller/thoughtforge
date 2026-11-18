import type { ReactNode } from "react";
import { FaradayGateBoundary } from "@/src/components/gate/FaradayGateBoundary";

/** Faraday beta access gate (FDY-414): runs after the magic-word wall in proxy.ts, which is unchanged. */
export default function GatedLayout({ children }: { children: ReactNode }) {
  return <FaradayGateBoundary behindMagicWord>{children}</FaradayGateBoundary>;
}
