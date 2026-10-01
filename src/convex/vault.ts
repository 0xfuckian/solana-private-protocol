import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  ensureProtocolState,
  ensureVaultPool,
  getWalletForUser,
  getWalletForUserOrThrow,
  protocolStateOrDefault,
  readVaultPool,
  requireUserId,
  routeFee,
} from "./backendHelpers";
import { CIPHERTEXT_B64_LEN } from "./protocol";
import { sha256Hex } from "./sha256";
import {
  LOT_SIZE,
  MINT_FEE_BPS,
  OPEN_RATE_LAMPORTS,
} from "../lib/protocol";

/**
 * The vault opens with the mint. Before that there is no pool to size,
 * no fee stream to share, and nothing to deposit — the deposit action
 * rejects out-of-window writes instead of accepting them silently.
 */
async function assertVaultOpen(
  state: { mintOpen: boolean; marketOpen: boolean },
) {
  if (!state.mintOpen && !state.marketOpen) {
    throw new Error(
      "The vault opens when minting starts. No deposits are accepted before then.",
    );
  }
}

/**
 * The vault pool, publicly readable: TVL, share supply, fee pool, and the
 * accumulated fee-per-share that pro-rata payouts are computed from.
 */
export const getPool = query({
  args: {},
  handler: async (ctx) => {
    await getAuthUserId(ctx);
    const pool = await readVaultPool(ctx);
    const state = await protocolStateOrDefault(ctx);
    return {
      depositedTokens: pool.depositedTokens,
      totalShares: pool.totalShares,
      feePoolLamports: pool.feePoolLamports,
      feesDistributedLamports: pool.feesDistributedLamports,
      feePerShare: pool.feePerShare,
      // Protocol liquidity inside the vault (95% of every mint).
      liquidityLamports: state.liquidityLamports,
      treasuryLamports: state.treasuryLamports,
      // Window flags for the UI.
      mintOpen: state.mintOpen,
      marketOpen: state.marketOpen,
      // Legacy-state repair pending: the mint closed but the sellout's
      // implied mint fees were never routed (pre-fix demo state). Claiming
      // will backfill them first.
      backfillPending:
        !state.mintOpen &&
        pool.feePoolLamports === 0 &&
        pool.feesDistributedLamports === 0,
    };
  },
});

/** The caller's position: shares, deposit, and claimable fees. */
export const getMyPosition = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUser(ctx, userId);
    if (!wallet) return null;
    const pool = await readVaultPool(ctx);
    const deposit = await ctx.db
      .query("vaultDeposits")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .first();
    if (!deposit) {
      return {
        shares: 0,
        depositedTokens: 0,
        accumulatedFees: 0,
        claimableLamports: 0,
        poolSharePct: 0,
      };
    }
    const share = deposit.shares / Math.max(1, pool.totalShares);
    // Claimable = fees accrued since this position last synced, minus what
    // has already been paid out to it.
    const accruedTotal = Math.floor(
      (pool.feePerShare * deposit.shares) / 1e12,
    );
    const claimable = Math.max(0, accruedTotal - deposit.accumulatedFees);
    return {
      shares: deposit.shares,
      depositedTokens: deposit.depositedTokens,
      accumulatedFees: deposit.accumulatedFees,
      claimableLamports: claimable,
      poolSharePct: share * 100,
    };
  },
});

/**
 * Deposit SOLZK into the vault, like adding liquidity to a pool. Shares are
 * minted pro rata to the existing share supply; the deposit immediately
 * earns its proportion of the fee stream (mint fees, transfer fees, trade
 * fees) and its claim on the protocol liquidity that backstops withdrawals.
 *
 * Fees that arrived before the first deposit are not lost: they sit in the
 * pool and are captured pro rata by the first depositors.
 *
 * The deposit burns the depositor's notes by nullifier — the tokens move
 * into the pool, visible only as a larger pool, never as a balance.
 */
export const deposit = mutation({
  args: {
    amountTokens: v.number(),
    nullifiers: v.array(v.string()),
    proof: v.string(),
  },
  handler: async (ctx, { amountTokens, nullifiers, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    await assertVaultOpen(state);
    const pool = await ensureVaultPool(ctx);

    if (amountTokens <= 0) throw new Error("Amount must be positive.");
    for (const n of nullifiers) {
      const existing = await ctx.db
        .query("nullifiers")
        .withIndex("by_value", (q) => q.eq("value", n))
        .first();
      if (existing)
        throw new Error("Nullifier already seen — double spend blocked.");
    }
    // The proof commits to the deposit statement.
    const statement = `deposit:${wallet.address}:${amountTokens}:${nullifiers.join(",")}`;
    const expected = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    // Shares = pro rata against the existing share supply.
    const firstDeposit = pool.totalShares === 0;
    const mintedShares = firstDeposit
      ? amountTokens // first depositor: 1 share per token
      : Math.floor((amountTokens * pool.totalShares) / Math.max(1, pool.depositedTokens));

    const slot = Math.floor((Date.now() - state.genesisMs) / 400);
    for (const n of nullifiers) {
      await ctx.db.insert("nullifiers", { value: n, slot });
    }

    const existing = await ctx.db
      .query("vaultDeposits")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .first();
    if (existing) {
      // Preserve the accrued-fee checkpoint when adding shares.
      const accruedTotal = Math.floor(
        (pool.feePerShare * existing.shares) / 1e12,
      );
      await ctx.db.patch(existing._id, {
        shares: existing.shares + mintedShares,
        depositedTokens: existing.depositedTokens + amountTokens,
        accumulatedFees: accruedTotal,
      });
    } else {
      await ctx.db.insert("vaultDeposits", {
        walletId: wallet._id,
        shares: mintedShares,
        depositedTokens: amountTokens,
        lamportsIn: 0,
        // Checkpoint at the current feePerShare: new shares only earn fees
        // routed from this point on, never the pool's past fees.
        accumulatedFees: Math.floor(
          (pool.feePerShare * mintedShares) / 1e12,
        ),
        createdAt: Date.now(),
      });
    }

    await ctx.db.patch(pool._id, {
      depositedTokens: pool.depositedTokens + amountTokens,
      totalShares: pool.totalShares + mintedShares,
      updatedAt: Date.now(),
    });

    // First-depositor capture: every lamport that pooled before any shares
    // existed is unattributed (feePerShare never advanced without shares).
    // Credit the standing fee pool to the founding shares — the empty-LP-pool
    // rule that makes being first worth the risk.
    if (firstDeposit && pool.feePoolLamports > 0) {
      await ctx.db.patch(pool._id, {
        feePerShare:
          pool.feePerShare +
          Math.floor((pool.feePoolLamports * 1e12) / mintedShares),
        updatedAt: Date.now(),
      });
    }

    return { shares: mintedShares };
  },
});

/**
 * Claim accrued fees — the vault's payout to depositors, funded by the
 * vault's half of every mint, transfer and trade fee. Like LP fee
 * distribution: proportional to shares, claimable at any time, no lockup.
 */
export const claimFees = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    let pool = await ensureVaultPool(ctx);

    // Legacy-state repair: if the mint is already sold out (or closed) but
    // the pool never received the sellout's implied mint fees — e.g. the
    // sellout ran before fee routing existed — backfill them once here so
    // depositors can actually claim. Guards on liquiditySeeded being unset
    // while liquidity exists is not reliable; instead we detect the exact
    // legacy signature: market open, zero fees ever routed, zero distributed.
    if (
      !state.mintOpen &&
      pool.feePoolLamports === 0 &&
      pool.feesDistributedLamports === 0
    ) {
      // Zero fees ever routed: no real mint settled under the new router.
      // Backfill the sellout's implied mint fees for the whole supply —
      // that is the coherent history for a fully simulated sellout.
      const lots =
        state.mintedTokens >= state.totalSupply
          ? Math.floor(state.totalSupply / LOT_SIZE)
          : Math.floor(
              Math.max(0, state.totalSupply - state.mintedTokens) / LOT_SIZE,
            );
      const gross = lots * OPEN_RATE_LAMPORTS;
      const mintFee = Math.ceil((gross * MINT_FEE_BPS) / 10_000);
      if (mintFee > 0) {
        await routeFee(ctx, state, pool, mintFee);
        pool = (await ctx.db.get(pool._id))!;
      }
    }

    const deposit = await ctx.db
      .query("vaultDeposits")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .first();
    if (!deposit || deposit.shares === 0) {
      throw new Error("Nothing deposited — no fees to claim.");
    }
    // First-depositor capture: fees that pooled up before the first deposit
    // belong to the depositors that arrive first (how an empty LP pool works).
    // New depositors only earn fees routed after their shares exist.
    const accruedTotal = Math.floor(
      (pool.feePerShare * deposit.shares) / 1e12,
    );
    const claimable = Math.max(0, accruedTotal - deposit.accumulatedFees);
    if (claimable <= 0) {
      throw new Error("No fees accrued yet — deposit and wait for volume.");
    }

    await ctx.db.patch(deposit._id, {
      accumulatedFees: accruedTotal,
      lastClaimAt: Date.now(),
    });
    await ctx.db.patch(pool._id, {
      feePoolLamports: pool.feePoolLamports - claimable,
      feesDistributedLamports: pool.feesDistributedLamports + claimable,
      updatedAt: Date.now(),
    });
    // Fees pay out in ordinary SOL, straight to the depositor's wallet.
    await ctx.db.patch(wallet._id, {
      fundingLamports: wallet.fundingLamports + claimable,
    });
    return { claimedLamports: claimable };
  },
});

/**
 * Withdraw from the vault: burn shares pro rata and receive a fresh sealed
 * note back into your shielded wallet. There is no exit to ordinary SOL —
 * value stays private, which is the whole point.
 */
export const withdraw = mutation({
  args: {
    shares: v.number(),
    sealedNote: v.object({
      ephemeral: v.string(),
      nonce: v.string(),
      ciphertext: v.string(),
    }),
    commitment: v.string(),
    proof: v.string(),
  },
  handler: async (ctx, { shares, sealedNote, commitment, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    const pool = await ensureVaultPool(ctx);
    const deposit = await ctx.db
      .query("vaultDeposits")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .first();
    if (!deposit || deposit.shares < shares || shares <= 0) {
      throw new Error("Not enough shares.");
    }
    if (sealedNote.ciphertext.length !== CIPHERTEXT_B64_LEN) {
      throw new Error("Sealed note ciphertext must be 512 bytes.");
    }
    const statement = `withdraw:${wallet.address}:${shares}:${commitment}`;
    const expected = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    const tokensOut = Math.floor(
      (shares * pool.depositedTokens) / Math.max(1, pool.totalShares),
    );
    if (tokensOut <= 0) throw new Error("Withdrawal rounds to zero.");

    const remainingShares = deposit.shares - shares;
    if (remainingShares === 0) {
      await ctx.db.delete(deposit._id);
    } else {
      await ctx.db.patch(deposit._id, {
        shares: remainingShares,
        depositedTokens: Math.max(
          0,
          deposit.depositedTokens - tokensOut,
        ),
        accumulatedFees: Math.floor(
          (pool.feePerShare * remainingShares) / 1e12,
        ),
      });
    }
    await ctx.db.patch(pool._id, {
      depositedTokens: Math.max(0, pool.depositedTokens - tokensOut),
      totalShares: pool.totalShares - shares,
      updatedAt: Date.now(),
    });

    // The withdrawn value returns as a sealed note only the depositor can
    // open — private in, private out.
    await ctx.db.insert("notes", {
      commitment,
      sealed: sealedNote,
      slot: Math.floor((Date.now() - state.genesisMs) / 400),
      createdAt: Date.now(),
    });

    return { tokensOut };
  },
});
