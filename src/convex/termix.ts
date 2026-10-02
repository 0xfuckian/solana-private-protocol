import { v } from "convex/values";
import { query } from "./_generated/server";
import { protocolStateOrDefault, readVaultPool } from "./backendHelpers";
import {
  LOT_SIZE,
  MARKET_FEE_BPS,
  MINT_FEE_BPS,
  OPEN_MAX_LOTS,
  OPEN_RATE_LAMPORTS,
  SHIELDED_ASSETS,
  SWAP_FEE_BPS,
  TICKER,
} from "../lib/protocol";

/**
 * TermiX / agent integration surface — READ-ONLY public queries.
 *
 * Agents integrate against these plus the client-side SDK in
 * src/lib/termix.ts (pay-link codec, swap quotes, fee math). Proof
 * construction and note sealing stay in the operator's browser: agents
 * must NEVER accept seeds, passwords, or viewing private keys over the
 * network, and this module exposes no mutation that takes one.
 * Everything here reads the public ledger; `simulation: true` always.
 */

/** Pool snapshot for agents: roots, supply, fees, reserves, assets. */
export const poolState = query({
  args: {},
  handler: async (ctx) => {
    const state = await protocolStateOrDefault(ctx);
    const pool = await readVaultPool(ctx);
    const merkle = await ctx.db
      .query("merkleState")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    return {
      simulation: true as const,
      ticker: TICKER,
      lotSize: LOT_SIZE,
      mintRateLamportsPerLot: OPEN_RATE_LAMPORTS,
      walletCapLots: OPEN_MAX_LOTS,
      mintedTokens: state.mintedTokens,
      totalSupply: state.totalSupply,
      mintOpen: state.mintOpen,
      marketOpen: state.marketOpen,
      merkleRoot: merkle?.root ?? null,
      leaves: merkle?.nextIndex ?? 0,
      feesBps: {
        mint: MINT_FEE_BPS,
        transfer: MARKET_FEE_BPS,
        swap: SWAP_FEE_BPS,
      },
      swapReserves: {
        solLamports: state.swapSolReserve ?? 0,
        tokenReserve: state.swapTokenReserve ?? 0,
      },
      vault: {
        depositedTokens: pool.depositedTokens,
        totalShares: pool.totalShares,
        feePoolLamports: pool.feePoolLamports,
      },
      assets: SHIELDED_ASSETS.map((a) => ({
        symbol: a.symbol,
        name: a.name,
        mint: a.mint,
        decimals: a.decimals,
      })),
    };
  },
});

/**
 * Public reputation facts for an agent wallet address: derived ONLY from
 * on-ledger history (payroll batches dispatched, fee claims, lots minted,
 * burn tier). No score is invented — callers compute their own weighting.
 */
export const agentReputation = query({
  args: { address: v.string() },
  handler: async (ctx, { address }) => {
    await protocolStateOrDefault(ctx);
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_address", (q) => q.eq("address", address))
      .first();
    if (!wallet) {
      return {
        simulation: true as const,
        address,
        known: false as const,
        payrollBatches: 0,
        payrollTokens: 0,
        feeClaims: 0,
        lotsMinted: 0,
        burnedTokens: 0,
      };
    }
    const batches = await ctx.db
      .query("payrollBatches")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .collect();
    const claims = await ctx.db.query("feeClaims").collect();
    const mine = claims.filter((c) => c.walletId === wallet._id);
    return {
      simulation: true as const,
      address,
      known: true as const,
      payrollBatches: batches.length,
      payrollTokens: batches.reduce((a, b) => a + b.totalTokens, 0),
      feeClaims: mine.length,
      lotsMinted: wallet.lotsMinted,
      burnedTokens: wallet.burnedTokens ?? 0,
      hasViewingKey: Boolean(wallet.viewPubKey),
    };
  },
});

/**
 * Public ASP fact check: does this commitment exist in the pool, and what
 * self-asserted label (if any) is registered for the address? Labels are
 * self-asserted, not verified origins — see the Handbook.
 */
export const aspCheck = query({
  args: { commitment: v.optional(v.string()), address: v.optional(v.string()) },
  handler: async (ctx, { commitment, address }) => {
    await protocolStateOrDefault(ctx);
    let commitmentFound: boolean | null = null;
    if (commitment) {
      const note = await ctx.db
        .query("notes")
        .withIndex("by_commitment", (q) => q.eq("commitment", commitment))
        .first();
      commitmentFound = note !== null;
    }
    let label: string | null = null;
    if (address) {
      const row = await ctx.db
        .query("aspLabels")
        .withIndex("by_address", (q) => q.eq("address", address))
        .first();
      label = row?.label ?? null;
    }
    return {
      simulation: true as const,
      commitmentFound,
      label,
      selfAsserted: true as const,
    };
  },
});
