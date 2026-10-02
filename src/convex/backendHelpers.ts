import { assertUnits } from "../lib/safety";
import { getAuthUserId } from "@convex-dev/auth/server";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { TICKER, TOTAL_SUPPLY, LOT_SIZE } from "../lib/protocol";

export async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not signed in");
  }
  return userId;
}

export async function getWalletForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"wallets"> | null> {
  return ctx.db
    .query("wallets")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

export async function getWalletForUserOrThrow(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"wallets">> {
  const wallet = await getWalletForUser(ctx as QueryCtx, userId);
  if (!wallet)
    throw new Error(
      "No SOLZK wallet found — create one on the mint page.",
    );
  return wallet;
}

/** Read-only: queries use this. Returns null when the singleton doesn't exist yet. */
export async function readProtocolState(
  ctx: QueryCtx,
): Promise<Doc<"protocolState"> | null> {
  return ctx.db
    .query("protocolState")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
}

/** Mutations use this: creates the singleton on first touch. */
export async function ensureProtocolState(
  ctx: MutationCtx,
): Promise<Doc<"protocolState">> {
  const existing = await readProtocolState(ctx as unknown as QueryCtx);
  if (process.env.SOLZK_EXECUTION_MODE === "production") throw new Error("Production execution is unavailable: this ledger has no audited Solana verifier.");
  if (existing?.emergencyPaused) throw new Error("Protocol emergency pause is active.");
  if (existing) return existing;
  const id = await ctx.db.insert("protocolState", {
    key: "global",
    ticker: TICKER,
    totalSupply: TOTAL_SUPPLY,
    lotSize: LOT_SIZE,
    mintedTokens: 0,
    mintOpen: true,
    marketOpen: false,
    genesisMs: Date.now(),
    treasuryLamports: 0,
    liquidityLamports: 0,
    burnedTokens: 0,
    relayerFeesTokens: 0,
  });
  return (await ctx.db.get(id))!;
}

/** Query-side helper: state or sensible defaults before first mint. */
export type ProtocolStateLike = {
  ticker: string;
  totalSupply: number;
  lotSize: number;
  mintedTokens: number;
  mintOpen: boolean;
  marketOpen: boolean;
  genesisMs: number;
  treasuryLamports: number;
  treasuryTokens?: number;
  vaultFeeTokens?: number;
  liquidityLamports: number;
  burnedTokens?: number;
  relayerFeesTokens?: number;
  lastBuybackAt?: number;
  swapSolReserve?: number;
  swapTokenReserve?: number;
  claimsPoolTokens?: number;
  lastAnchorAt?: number;
};

/** Cumulative burned supply (keeper buybacks + tier burns + exits). */
export function stateBurnedTokens(
  state: Pick<ProtocolStateLike, "burnedTokens">,
): number {
  return state.burnedTokens ?? 0;
}

/** Cumulative in-note relayer fees collected in the public fee vault. */
export function stateRelayerFees(
  state: Pick<ProtocolStateLike, "relayerFeesTokens">,
): number {
  return state.relayerFeesTokens ?? 0;
}

export async function protocolStateOrDefault(
  ctx: QueryCtx,
): Promise<ProtocolStateLike & { _id?: Id<"protocolState"> }> {
  const state = await readProtocolState(ctx);
  if (state) return state;
  return {
    ticker: TICKER,
    totalSupply: TOTAL_SUPPLY,
    lotSize: LOT_SIZE,
    mintedTokens: 0,
    mintOpen: true,
    marketOpen: false,
    genesisMs: Date.now(),
    treasuryLamports: 0,
    liquidityLamports: 0,
    burnedTokens: 0,
    relayerFeesTokens: 0,
  };
}

/** Read-only vault pool accounting; defaults before the first deposit. */
export type VaultPoolLike = {
  depositedTokens: number;
  totalShares: number;
  feePoolLamports: number;
  feesDistributedLamports: number;
  feePerShare: number; // cumulative lamports per share (fixed-point 1e12)
};

export const VAULT_POOL_ZERO: VaultPoolLike = {
  depositedTokens: 0,
  totalShares: 0,
  feePoolLamports: 0,
  feesDistributedLamports: 0,
  feePerShare: 0,
};

export async function readVaultPool(
  ctx: QueryCtx,
): Promise<VaultPoolLike & { _id?: Id<"vaultPool"> }> {
  const pool = await ctx.db
    .query("vaultPool")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  if (pool) return pool;
  return { ...VAULT_POOL_ZERO };
}

export async function ensureVaultPool(
  ctx: MutationCtx,
): Promise<Doc<"vaultPool">> {
  const existing = await ctx.db
    .query("vaultPool")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("vaultPool", {
    key: "global",
    depositedTokens: 0,
    totalShares: 0,
    feePoolLamports: 0,
    feesDistributedLamports: 0,
    feePerShare: 0,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

/**
 * Credit the fee pool and the treasury: half of every fee each way.
 *
 * Fees that arrive before any depositor exists are NOT lost: they keep
 * accruing in the pool and are credited pro rata to the first depositors —
 * exactly how an empty LP pool works (early LPs are entitled to the fees
 * the pool already holds, otherwise nobody would provide liquidity first).
 * This is why feePerShare only advances per existing share.
 */
/** Token fees are retained in token-denominated reserves, never paid as SOL.
 * Distribution to stakers/vault holders requires separate reward accounting.
 */
export async function routeTokenFee(ctx: MutationCtx, state: Doc<"protocolState">, tokens: number) {
  assertUnits(tokens, "Token fee", true);
  const vaultCut = Math.ceil(tokens / 2);
  await ctx.db.patch(state._id, { treasuryTokens: (state.treasuryTokens ?? 0) + tokens - vaultCut, vaultFeeTokens: (state.vaultFeeTokens ?? 0) + vaultCut });
}

export async function routeFee(
  ctx: MutationCtx,
  state: Doc<"protocolState">,
  pool: Doc<"vaultPool">,
  feeLamports: number,
) {
  assertUnits(feeLamports, "SOL fee", true);
  const vaultCut = Math.ceil(feeLamports / 2);
  const treasuryCut = feeLamports - vaultCut;
  const shares = pool.totalShares;
  if (shares > 0) {
    // feePerShare is fixed-point 1e12 so tiny pools still accrue.
    await ctx.db.patch(pool._id, {
      feePoolLamports: pool.feePoolLamports + vaultCut,
      feePerShare: pool.feePerShare + Math.floor((vaultCut * 1e12) / shares),
      updatedAt: Date.now(),
    });
  } else {
    // No depositors yet — the fee waits in the pool; the first depositors
    // capture it when they mint shares.
    await ctx.db.patch(pool._id, {
      feePoolLamports: pool.feePoolLamports + vaultCut,
      updatedAt: Date.now(),
    });
  }
  await ctx.db.patch(state._id, {
    treasuryLamports: state.treasuryLamports + treasuryCut,
  });
}
