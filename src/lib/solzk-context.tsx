import { createContext, useContext, type ReactNode } from "react";
import { useSolzk as useSolzkInternal } from "./useSolzk";

/**
 * One wallet session per app. The header, mint, dashboard, vault and market
 * all see the same phase — unlocking on the mint page unlocks everywhere.
 */
const SolzkContext = createContext<ReturnType<typeof useSolzkInternal> | null>(
  null,
);

export function SolzkProvider({ children }: { children: ReactNode }) {
  const value = useSolzkInternal();
  return <SolzkContext.Provider value={value}>{children}</SolzkContext.Provider>;
}

export function useSolzk() {
  const value = useContext(SolzkContext);
  if (!value) {
    throw new Error("useSolzk must be used within <SolzkProvider>");
  }
  return value;
}

export type { WalletPhase, MyNote } from "./useSolzk";
