import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { consumeSpend, spendArgs } from "./spend";
import { appendNote } from "./merkle";
import { sha256Hex } from "./sha256";
import { sealedStatement } from "../lib/spend";
import { assertUnits, assertSealedNote, mulDivFloor } from "../lib/safety";
import { advanceRewardIndex, pendingRewards, readRewardIndex, REWARD_SCALE, wholeRewards } from "../lib/rewards";
import { ensureProtocolState, ensureVaultPool, getWalletForUser, getWalletForUserOrThrow, protocolStateOrDefault, readVaultPool, requireUserId } from "./backendHelpers";

export const getPool = query({
  args: {},
  handler: async ctx => {
    await getAuthUserId(ctx);
    const pool = await readVaultPool(ctx);
    const state = await protocolStateOrDefault(ctx);
    return { depositedTokens: pool.depositedTokens, totalShares: pool.totalShares, feePoolLamports: pool.feePoolLamports,
      feesDistributedLamports: pool.feesDistributedLamports, feePerShare: pool.feePerShare,
      rewardIndex: readRewardIndex(pool).toString(), liquidityLamports: state.liquidityLamports,
      treasuryLamports: state.treasuryLamports, mintOpen: state.mintOpen, marketOpen: state.marketOpen, backfillPending: false };
  },
});

export const getMyPosition = query({
  args: {},
  handler: async ctx => {
    const user = await requireUserId(ctx);
    const wallet = await getWalletForUser(ctx, user);
    if (!wallet) return null;
    const pool = await readVaultPool(ctx);
    const position = await ctx.db.query("vaultDeposits").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    return { shares: position?.shares ?? 0, depositedTokens: position?.depositedTokens ?? 0,
      accumulatedFees: position?.accumulatedFees ?? 0,
      claimableLamports: position ? wholeRewards(pendingRewards(position, readRewardIndex(pool))) : 0,
      poolSharePct: (position?.shares ?? 0) / Math.max(1, pool.totalShares) * 100 };
  },
});

export const deposit = mutation({
  args: { amountTokens: v.number(), nullifiers: v.array(v.string()), ...spendArgs, proof: v.string() },
  handler: async (ctx, { amountTokens, nullifiers, inputTotal, change, proof }) => {
    const wallet = await getWalletForUserOrThrow(ctx, await requireUserId(ctx));
    const state = await ensureProtocolState(ctx);
    if (!state.mintOpen && !state.marketOpen) throw new Error("Vault is closed.");
    assertUnits(amountTokens);
    const pool = await ensureVaultPool(ctx);
    const first = pool.totalShares === 0;
    const shares = first ? amountTokens : mulDivFloor(amountTokens, pool.totalShares, pool.depositedTokens);
    if (shares <= 0) throw new Error("Deposit rounds to zero shares.");
    const newShares = pool.totalShares + shares;
    assertUnits(newShares, "Share supply");
    const slot = Math.floor((Date.now() - state.genesisMs) / 400);
    await consumeSpend(ctx, { nullifiers, inputTotal, change }, amountTokens, `deposit:${wallet.address}:${amountTokens}`, proof, slot);
    const index = readRewardIndex(pool);
    const existing = await ctx.db.query("vaultDeposits").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    // Sync existing entitlement before adding shares; new shares cannot acquire old fees.
    if (existing) await ctx.db.patch(existing._id, { shares: existing.shares + shares, depositedTokens: existing.depositedTokens + amountTokens,
      rewardCheckpoint: index.toString(), pendingRewardScaled: pendingRewards(existing, index).toString() });
    else await ctx.db.insert("vaultDeposits", { walletId: wallet._id, shares, depositedTokens: amountTokens, lamportsIn: 0, accumulatedFees: 0,
      rewardCheckpoint: index.toString(), pendingRewardScaled: "0", createdAt: Date.now() });
    // Explicit legacy demo policy: fees accumulated without holders go to the next first deposit.
    const unallocated = pool.unallocatedLamports ?? (first && pool.feePerShare === 0 ? pool.feePoolLamports : 0);
    const nextIndex = first ? advanceRewardIndex(index, unallocated, shares) : index;
    await ctx.db.patch(pool._id, { depositedTokens: pool.depositedTokens + amountTokens, totalShares: newShares,
      rewardIndex: nextIndex.toString(), unallocatedLamports: first ? 0 : unallocated, feePerShare: Number(nextIndex) / Number(REWARD_SCALE) * 1e12, updatedAt: Date.now() });
    return { shares };
  },
});

export const claimFees = mutation({
  args: {},
  handler: async ctx => {
    const wallet = await getWalletForUserOrThrow(ctx, await requireUserId(ctx));
    await ensureProtocolState(ctx);
    const pool = await ensureVaultPool(ctx);
    const position = await ctx.db.query("vaultDeposits").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    if (!position) throw new Error("No rewards position.");
    const index = readRewardIndex(pool);
    const pending = pendingRewards(position, index);
    const claimedLamports = wholeRewards(pending);
    if (claimedLamports <= 0) throw new Error("No whole-unit fees accrued yet.");
    if (claimedLamports > pool.feePoolLamports) throw new Error("Fee pool cannot cover accrued rewards.");
    await ctx.db.patch(position._id, { rewardCheckpoint: index.toString(), pendingRewardScaled: (pending - BigInt(claimedLamports) * REWARD_SCALE).toString(),
      accumulatedFees: position.accumulatedFees + claimedLamports, lastClaimAt: Date.now() });
    await ctx.db.patch(pool._id, { feePoolLamports: pool.feePoolLamports - claimedLamports, feesDistributedLamports: pool.feesDistributedLamports + claimedLamports, rewardIndex: index.toString(), updatedAt: Date.now() });
    await ctx.db.patch(wallet._id, { fundingLamports: wallet.fundingLamports + claimedLamports });
    return { claimedLamports };
  },
});

export const withdraw = mutation({
  args: { shares: v.number(), expectedTokensOut: v.number(), sealedNote: v.object({ ephemeral: v.string(), nonce: v.string(), ciphertext: v.string(), epk: v.optional(v.string()) }), commitment: v.string(), proof: v.string() },
  handler: async (ctx, { shares, expectedTokensOut, sealedNote, commitment, proof }) => {
    const wallet = await getWalletForUserOrThrow(ctx, await requireUserId(ctx));
    const state = await ensureProtocolState(ctx);
    const pool = await ensureVaultPool(ctx);
    const position = await ctx.db.query("vaultDeposits").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    assertUnits(shares, "Shares");
    assertUnits(expectedTokensOut, "Output tokens");
    if (!position || shares > position.shares) throw new Error("Not enough shares.");
    assertSealedNote(sealedNote);
    const tokensOut = mulDivFloor(shares, pool.depositedTokens, pool.totalShares);
    if (tokensOut !== expectedTokensOut) throw new Error("Withdrawal quote changed. Refresh and reseal the note.");
    const statement = `withdraw:${wallet.address}:${shares}:${tokensOut}:${commitment}:${sealedStatement(sealedNote)}`;
    if (proof !== sha256Hex(sha256Hex(statement) + "solzk-circuit-v1")) throw new Error("Withdrawal statement mismatch.");
    const index = readRewardIndex(pool);
    const pending = pendingRewards(position, index);
    const claimedLamports = wholeRewards(pending);
    if (claimedLamports > pool.feePoolLamports) throw new Error("Fee pool cannot cover accrued rewards.");
    const remainder = pending - BigInt(claimedLamports) * REWARD_SCALE;
    // Keep zero-share records while they have fractional credit, so re-depositing
    // cannot erase fractions or receive an old-index windfall.
    await ctx.db.patch(position._id, { shares: position.shares - shares, depositedTokens: Math.max(0, position.depositedTokens - tokensOut),
      rewardCheckpoint: index.toString(), pendingRewardScaled: remainder.toString(), accumulatedFees: position.accumulatedFees + claimedLamports });
    await ctx.db.patch(pool._id, { depositedTokens: pool.depositedTokens - tokensOut, totalShares: pool.totalShares - shares,
      feePoolLamports: pool.feePoolLamports - claimedLamports, feesDistributedLamports: pool.feesDistributedLamports + claimedLamports, rewardIndex: index.toString(), updatedAt: Date.now() });
    if (claimedLamports) await ctx.db.patch(wallet._id, { fundingLamports: wallet.fundingLamports + claimedLamports });
    await appendNote(ctx, { commitment, sealed: sealedNote, slot: Math.floor((Date.now() - state.genesisMs) / 400), createdAt: Date.now() });
    return { tokensOut, claimedLamports };
  },
});
