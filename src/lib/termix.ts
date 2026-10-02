/**
 * Kilnen agent SDK (TermiX integration surface).
 *
 * Pure client-side helpers only: pay-link codec, swap quotes, fee math.
 * There is intentionally NO proof endpoint that accepts private keys:
 * sealing and proving happen in the operator's browser via
 * useSolzk / noteEncryption. Any integration that asks an agent to upload
 * a seed, password, or viewing private key is a phishing pattern — refuse it.
 *
 * On-ledger reads live in convex/termix.ts: poolState, agentReputation,
 * aspCheck. All are public, read-only, and flagged simulation.
 */

import {
  OPEN_RATE_LAMPORTS,
  LOT_SIZE,
  MARKET_FEE_BPS,
  MINT_FEE_BPS,
  SWAP_FEE_BPS,
  decodePayLink,
  encodePayLink,
  quoteSwapSolForTokens,
  quoteSwapTokensForSol,
  transferFeeTokens,
  type PayLinkPayload,
} from "./protocol";
import { relayerFeeTokens } from "./safety";

export const TERMIX_VERSION = "solzk-termix-v1";
export const SIMULATION = true as const;

export interface AgentQuote {
  grossUnits: number;
  protocolFeeUnits: number;
  relayerFeeUnits: number;
  netUnits: number;
}

/** Net-out quote for a private transfer of `amount` units (fee-in-note optional). */
export function quotePrivateTransfer(
  amount: number,
  opts?: { feeInNote?: boolean; baseFeeBps?: number; discountBps?: number },
): AgentQuote {
  const protocolFeeUnits = transferFeeTokens(
    amount,
    opts?.discountBps ?? 0,
    opts?.baseFeeBps ?? MARKET_FEE_BPS,
  );
  const relayerFeeUnits = opts?.feeInNote ? relayerFeeTokens(amount) : 0;
  return {
    grossUnits: amount,
    protocolFeeUnits,
    relayerFeeUnits,
    netUnits: amount - protocolFeeUnits - relayerFeeUnits,
  };
}

export const AgentFees = {
  mintFeeBps: MINT_FEE_BPS,
  transferFeeBps: MARKET_FEE_BPS,
  swapFeeBps: SWAP_FEE_BPS,
  mintRateLamportsPerLot: OPEN_RATE_LAMPORTS,
  lotSize: LOT_SIZE,
} as const;

export const AgentCodecs = {
  encodePayLink,
  decodePayLink,
} as const;

export type { PayLinkPayload };

export const AgentQuotes = {
  quotePrivateTransfer,
  quoteSwapSolForTokens,
  quoteSwapTokensForSol,
} as const;

/**
 * Work-proof helper for agent delivery receipts: SHA-256 over the
 * deliverable description. The hash can anchor an atomic-payment memo;
 * it proves nothing about correctness by itself — acceptance stays
 * with the hiring agent reviewing the delivered work.
 */
export async function workProofHash(description: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`solzk-work:${description}`),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
