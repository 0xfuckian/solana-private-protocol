import { createContext, useContext, type ReactNode } from "react";
import { useS404 as useS404Internal } from "./useS404";

/**
 * One wallet session per app. The header, mint, dashboard, vault and market
 * all see the same phase — unlocking on the mint page unlocks everywhere.
 */
const S404Context = createContext<ReturnType<typeof useS404Internal> | null>(
  null,
);

export function S404Provider({ children }: { children: ReactNode }) {
  const value = useS404Internal();
  return <S404Context.Provider value={value}>{children}</S404Context.Provider>;
}

export function useS404() {
  const value = useContext(S404Context);
  if (!value) {
    throw new Error("useS404 must be used within <S404Provider>");
  }
  return value;
}

export type { WalletPhase, MyNote } from "./useS404";
