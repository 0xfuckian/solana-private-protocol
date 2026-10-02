import type { ReactNode } from "react";

/**
 * Retired pre-launch gate. The mint is open: every route renders directly.
 * The whitelist tables stay in the backend for history, but nothing bounces
 * to /whitelist anymore. Kept as a pass-through so routing stays stable.
 */
export function WhitelistGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
