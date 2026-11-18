/**
 * Server boundary for the Faraday beta access gate (FDY-414). Used by the layouts of the ThoughtForge
 * product surfaces (/ask, /interview, /podcast). Open mode renders `children` untouched.
 *
 * Order of the two walls: the magic-word wall in proxy.ts runs first and is unchanged. On the surfaces it
 * covers (/ask, /interview: `behindMagicWord`), a request the wall has locked (x-tf-locked: 1) renders the
 * page's own locked magic-word form, so this boundary steps aside and the gate applies only once the wall
 * has been passed. The header is honoured ONLY on those surfaces: there the page shows nothing but the
 * locked form when it is set, so a spoofed header gains nothing. /podcast is not behind the wall and
 * ignores the header entirely.
 */
import type { ReactNode } from "react";
import { headers } from "next/headers";
import GatePage from "@/lib/faraday-gate/ui/GatePage";
import {
  TF_GATE_APP,
  TF_GATE_APP_NAME,
  TF_GATE_COPY,
  TF_GATE_PRIVACY_URL,
  TF_GATE_TERMS_URL,
  tfGateDecision,
} from "@/src/lib/faradayGate";

export async function FaradayGateBoundary({ children, behindMagicWord = false }: { children: ReactNode; behindMagicWord?: boolean }) {
  const h = await headers();
  if (behindMagicWord && h.get("x-tf-locked") === "1") return <>{children}</>;

  const decision = await tfGateDecision({ cookieHeader: h.get("cookie") });
  if (decision.pass) return <>{children}</>;

  return (
    <GatePage
      app={TF_GATE_APP}
      appName={TF_GATE_APP_NAME}
      copy={TF_GATE_COPY}
      view={decision.view}
      email={decision.email}
      termsUrl={TF_GATE_TERMS_URL}
      privacyUrl={TF_GATE_PRIVACY_URL}
    />
  );
}
