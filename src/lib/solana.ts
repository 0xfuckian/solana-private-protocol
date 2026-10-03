/**
 * Solana settlement scaffold — mainnet wiring point, NOT live.
 *
 * The Convex ledger stays the source of truth until:
 *  - the Anchor verifier program deploys (program ID below),
 *  - the join-split circuit completes review + ceremony,
 *  - RPC settlement replaces `convex dev` envelopes.
 *
 * Frontends must keep calling `useSolzk` (Convex) until this module reports
 * `isSettlementLive() === true`. Nothing here signs or broadcasts yet.
 */

export const SOLZK_PROGRAM_ID = "REPLACE_WITH_DEPLOYED_PROGRAM_ID";
export const SOLZK_RPC_ENV = "SOLZK_SOLANA_RPC";
export const SOLZK_COMMITMENT = "confirmed" as const;

/** True only when a deployed program ID + RPC endpoint are configured. */
export function isSettlementLive(): boolean {
  return (
    SOLZK_PROGRAM_ID !== "REPLACE_WITH_DEPLOYED_PROGRAM_ID" &&
    typeof process !== "undefined" &&
    Boolean((process as { env?: Record<string, string> }).env?.[SOLZK_RPC_ENV])
  );
}

export interface SettlementEnvelope {
  kind: "mint" | "transfer" | "swap" | "trade";
  proof: string;
  publicSignals: string[];
  commitments: string[];
  nullifiers: string[];
}

/** Placeholder: build the Anchor instruction data for joinsplit_verify. */
export function buildJoinsplitInstruction(envelope: SettlementEnvelope): Uint8Array {
  void envelope;
  throw new Error(
    "Solana settlement is not configured: deploy solana/solzk_verifier, set the program ID, and complete the circuit ceremony first.",
  );
}
