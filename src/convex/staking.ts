import { v } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import { ensureProtocolState, getWalletForUser, getWalletForUserOrThrow, requireUserId } from "./backendHelpers";
import { consumeSpend, spendArgs } from "./spend";
import { appendNote } from "./merkle";
import { assertUnits, assertSealedNote } from "../lib/safety";
import { pendingRewards, wholeRewards, REWARD_SCALE } from "../lib/rewards";
import { sealedStatement } from "../lib/spend";
import { sha256Hex } from "./sha256";

const LOCK_MS = 7 * 24 * 60 * 60 * 1000;
const outputArgs = { commitment: v.string(), sealedNote: v.object({ ephemeral: v.string(), nonce: v.string(), ciphertext: v.string() }), proof: v.string() };

async function ensurePool(ctx: MutationCtx) {
  const pool = await ctx.db.query("stakingPool").withIndex("by_key", q => q.eq("key", "global")).unique();
  if (pool) return pool;
  const id = await ctx.db.insert("stakingPool", { key: "global", totalStaked: 0, rewardTokens: 0, rewardsPaid: 0, rewardIndex: "0" });
  return (await ctx.db.get(id))!;
}

export const getStatus = query({
  args: {},
  handler: async ctx => {
    const user = await requireUserId(ctx);
    const wallet = await getWalletForUser(ctx, user);
    const pool = await ctx.db.query("stakingPool").withIndex("by_key", q => q.eq("key", "global")).unique();
    const position = wallet ? await ctx.db.query("stakingPositions").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique() : null;
    return { amount: position?.amount ?? 0, lockedUntil: position?.lockedUntil ?? 0, totalStaked: pool?.totalStaked ?? 0,
      rewardsAvailable: pool?.rewardTokens ?? 0, governanceWeight: position?.amount ?? 0,
      claimableTokens: position ? wholeRewards(pendingRewards({ ...position, shares: position.amount }, BigInt(pool?.rewardIndex ?? "0"))) : 0,
      feeBps: position && position.amount > 0 ? 100 : 200, dailyLimitSol: position && position.amount > 0 ? 100 : 10, simulation: true };
  },
});

export const stake = mutation({
  args: { amountTokens: v.number(), nullifiers: v.array(v.string()), ...spendArgs, proof: v.string() },
  handler: async (ctx, args) => {
    const wallet = await getWalletForUserOrThrow(ctx, await requireUserId(ctx));
    const state = await ensureProtocolState(ctx);
    assertUnits(args.amountTokens);
    const pool = await ensurePool(ctx);
    assertUnits(pool.totalStaked + args.amountTokens);
    await consumeSpend(ctx, args, args.amountTokens, `stake:${wallet.address}:${args.amountTokens}`, args.proof, Math.floor((Date.now() - state.genesisMs) / 400));
    const position = await ctx.db.query("stakingPositions").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    if (position) await ctx.db.patch(position._id, { amount: position.amount + args.amountTokens,
      lockedUntil: Math.max(position.lockedUntil, Date.now() + LOCK_MS), rewardCheckpoint: pool.rewardIndex,
      pendingRewardScaled: pendingRewards({ ...position, shares: position.amount }, BigInt(pool.rewardIndex)).toString() });
    else await ctx.db.insert("stakingPositions", { walletId: wallet._id, amount: args.amountTokens, lockedUntil: Date.now() + LOCK_MS,
      rewardCheckpoint: pool.rewardIndex, pendingRewardScaled: "0", createdAt: Date.now() });
    await ctx.db.patch(pool._id, { totalStaked: pool.totalStaked + args.amountTokens });
    return { lockedUntil: Date.now() + LOCK_MS };
  },
});

export const unstake = mutation({
  args: { amountTokens: v.number(), ...outputArgs },
  handler: async (ctx, { amountTokens, commitment, sealedNote, proof }) => {
    const wallet = await getWalletForUserOrThrow(ctx, await requireUserId(ctx));
    const state = await ensureProtocolState(ctx);
    assertUnits(amountTokens);
    assertSealedNote(sealedNote);
    const pool = await ensurePool(ctx);
    const position = await ctx.db.query("stakingPositions").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    if (!position || position.amount < amountTokens) throw new Error("Not enough staked tokens.");
    if (Date.now() < position.lockedUntil) throw new Error("Stake is locked for seven days after your most recent deposit.");
    const statement = `unstake:${wallet.address}:${amountTokens}:${commitment}:${sealedStatement(sealedNote)}`;
    if (proof !== sha256Hex(sha256Hex(statement) + "solzk-circuit-v1")) throw new Error("Unstake statement mismatch.");
    await ctx.db.patch(position._id, { amount: position.amount - amountTokens, rewardCheckpoint: pool.rewardIndex,
      pendingRewardScaled: pendingRewards({ ...position, shares: position.amount }, BigInt(pool.rewardIndex)).toString() });
    await ctx.db.patch(pool._id, { totalStaked: pool.totalStaked - amountTokens });
    await appendNote(ctx, { commitment, sealed: sealedNote, slot: Math.floor((Date.now() - state.genesisMs) / 400), createdAt: Date.now() });
    return { amountTokens };
  },
});

export const claimRewards = mutation({
  args: { expectedTokens: v.number(), ...outputArgs },
  handler: async (ctx, { expectedTokens, commitment, sealedNote, proof }) => {
    const wallet = await getWalletForUserOrThrow(ctx, await requireUserId(ctx));
    const state = await ensureProtocolState(ctx);
    assertUnits(expectedTokens);
    assertSealedNote(sealedNote);
    const pool = await ensurePool(ctx);
    const position = await ctx.db.query("stakingPositions").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    if (!position) throw new Error("No staking position.");
    const pending = pendingRewards({ ...position, shares: position.amount }, BigInt(pool.rewardIndex));
    const tokens = wholeRewards(pending);
    if (tokens !== expectedTokens) throw new Error("Reward quote changed. Refresh and reseal.");
    if (tokens > pool.rewardTokens) throw new Error("Rewards are not funded.");
    const statement = `staking-reward:${wallet.address}:${tokens}:${commitment}:${sealedStatement(sealedNote)}`;
    if (proof !== sha256Hex(sha256Hex(statement) + "solzk-circuit-v1")) throw new Error("Reward statement mismatch.");
    await ctx.db.patch(position._id, { rewardCheckpoint: pool.rewardIndex, pendingRewardScaled: (pending - BigInt(tokens) * REWARD_SCALE).toString() });
    await ctx.db.patch(pool._id, { rewardTokens: pool.rewardTokens - tokens, rewardsPaid: pool.rewardsPaid + tokens });
    await appendNote(ctx, { commitment, sealed: sealedNote, slot: Math.floor((Date.now() - state.genesisMs) / 400), createdAt: Date.now() });
    return { tokens };
  },
});
