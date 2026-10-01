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
import { CIPHERTEXT_B64_LEN, buildEnvelope, parseSealed } from "./protocol";
import { sha256Hex } from "./sha256";
import { ENVELOPE_MINT_BYTES, hexHashOf } from "../lib/protocol";

const PROTOCOL_FEE_LAMPORTS = 5_000;

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
    const mintedShares =
      pool.totalShares === 0
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
        accumulatedFees: 0,
        createdAt: Date.now(),
      });
    }

    await ctx.db.patch(pool._id, {
      depositedTokens: pool.depositedTokens + amountTokens,
      totalShares: pool.totalShares + mintedShares,
      updatedAt: Date.now(),
    });

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
    const pool = await ensureVaultPool(ctx);
    const deposit = await ctx.db
      .query("vaultDeposits")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .first();
    if (!deposit || deposit.shares === 0) {
      throw new Error("Nothing deposited — no fees to claim.");
    }
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

    const accruedTotal = Math.floor((pool.feePerShare * deposit.shares) / 1e12);
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

/**
 * The vault: every private token deployed on SOL-ZK. SOLZK itself was
 * issued through exactly this path — a deploy operation published as an
 * envelope.
 */
export const listTokens = query({
  args: {},
  handler: async (ctx) => {
    await getAuthUserId(ctx);
    const tokens = await ctx.db.query("vaultTokens").order("desc").collect();
    const state = await protocolStateOrDefault(ctx);
    const protocolToken = {
      _id: "solzk",
      ticker: state.ticker,
      name: "The private SOL standard",
      maxSupply: state.totalSupply,
      mintedTokens: state.mintedTokens,
      priceLamportsPerKilo: 35_000_000,
      mintOpen: state.mintOpen,
      isProtocolToken: true,
      creator: null as string | null,
      createdAt: 0,
      holders: 0,
    };
    const others = tokens.map((t) => ({
      _id: t._id,
      ticker: t.ticker,
      name: t.name,
      maxSupply: t.maxSupply,
      mintedTokens: t.mintedTokens,
      priceLamportsPerKilo: t.priceLamportsPerKilo,
      mintOpen: t.mintOpen,
      isProtocolToken: false,
      creator: t.creator,
      createdAt: t.createdAt,
      holders: t.holders,
    }));
    return [protocolToken, ...others];
  },
});

/**
 * All of the caller's vault-token balances in one query.
 */
export const listMyBalances = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUser(ctx, userId);
    if (!wallet) return [];
    const balances = await ctx.db
      .query("vaultBalances")
      .withIndex("by_wallet_token", (q) => q.eq("walletId", wallet._id))
      .collect();
    return balances.map((b) => ({ tokenId: b.tokenId, amount: b.amount }));
  },
});

/**
 * Deploy a shielded token: ticker, maximum supply and per-mint price,
 * published as an envelope like any other. Consensus rules need no change —
 * this is tooling on a capability the pool already has.
 */
export const deployToken = mutation({
  args: {
    ticker: v.string(),
    name: v.string(),
    maxSupply: v.number(),
    priceLamportsPerKilo: v.number(),
    proof: v.string(),
  },
  handler: async (ctx, { ticker, name, maxSupply, priceLamportsPerKilo, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    if (wallet.faucetTotalLamports === 0) {
      throw new Error("Use the devnet faucet before deploying.");
    }
    if (!/^[A-Z0-9]{2,8}$/.test(ticker)) {
      throw new Error("Ticker must be 2–8 chars, A–Z and 0–9.");
    }
    if (maxSupply < 1_000 || maxSupply > 1_000_000_000) {
      throw new Error("Max supply must be between 1,000 and 1,000,000,000.");
    }
    const existing = await ctx.db
      .query("vaultTokens")
      .withIndex("by_ticker", (q) => q.eq("ticker", ticker))
      .first();
    if (existing) throw new Error("That ticker is taken.");

    const expected = sha256Hex(
      sha256Hex(`deploy:${ticker}:${maxSupply}:${priceLamportsPerKilo}`) +
        "solzk-circuit-v1",
    );
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    const id = await ctx.db.insert("vaultTokens", {
      ticker,
      name,
      maxSupply,
      mintedTokens: 0,
      priceLamportsPerKilo,
      mintOpen: true,
      creator: wallet.address,
      createdAt: Date.now(),
      holders: 1,
    });
    await ctx.db.insert("vaultBalances", {
      tokenId: id,
      walletId: wallet._id,
      amount: 0,
    });
    return id;
  },
});

/**
 * Buy into a vault token with SOL. Value enters the shielded pool at the
 * moment of mint; after that nothing about your holdings is visible.
 */
export const buyToken = mutation({
  args: {
    tokenId: v.id("vaultTokens"),
    amountTokens: v.number(),
    sealedNote: v.object({
      ephemeral: v.string(),
      nonce: v.string(),
      ciphertext: v.string(),
    }),
    commitment: v.string(),
    proof: v.string(),
  },
  handler: async (ctx, { tokenId, amountTokens, sealedNote, commitment, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    const pool = await ensureVaultPool(ctx);
    const token = await ctx.db.get(tokenId);
    if (!token) throw new Error("Token not found.");
    if (!token.mintOpen) throw new Error("This token's mint is closed.");
    if (token.mintedTokens + amountTokens > token.maxSupply) {
      throw new Error("That purchase would exceed the token's cap.");
    }

    const gross = Math.ceil((amountTokens * token.priceLamportsPerKilo) / 1000);
    if (wallet.fundingLamports < gross + PROTOCOL_FEE_LAMPORTS) {
      throw new Error("Insufficient SOL — use the faucet.");
    }

    if (sealedNote.ciphertext.length !== CIPHERTEXT_B64_LEN) {
      throw new Error("Sealed note ciphertext must be 512 bytes.");
    }
    const expected = sha256Hex(
      sha256Hex(`vaultbuy:${tokenId}:${amountTokens}:${JSON.stringify(sealedNote)}`) +
        "solzk-circuit-v1",
    );
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    // 5% mint fee here too, routed half to depositors / half treasury; the
    // rest joins the pool's liquidity.
    const mintFee = Math.ceil((gross * 500) / 10_000);
    await routeFee(ctx, state, pool, mintFee);

    await ctx.db.insert("envelopes", {
      kind: "mint",
      signature: hexHashOf(`vault:${tokenId}:${Date.now()}`),
      slot: Math.floor((Date.now() - state.genesisMs) / 400),
      payloadSize: ENVELOPE_MINT_BYTES,
      feeLamports: mintFee,
      payload: buildEnvelope("mint", sealedNote),
      proof,
      createdAt: Date.now(),
    });

    await ctx.db.insert("notes", { commitment, sealed: sealedNote, slot: 0, createdAt: Date.now() });

    const bal = await ctx.db
      .query("vaultBalances")
      .withIndex("by_wallet_token", (q) => q.eq("walletId", wallet._id))
      .collect();
    const mine = bal.find((b) => b.tokenId === tokenId);
    if (mine) {
      await ctx.db.patch(mine._id, { amount: mine.amount + amountTokens });
    } else {
      await ctx.db.insert("vaultBalances", {
        tokenId,
        walletId: wallet._id,
        amount: amountTokens,
      });
      await ctx.db.patch(tokenId, { holders: token.holders + 1 });
    }

    await ctx.db.patch(tokenId, { mintedTokens: token.mintedTokens + amountTokens });
    await ctx.db.patch(wallet._id, {
      fundingLamports: wallet.fundingLamports - (gross + PROTOCOL_FEE_LAMPORTS),
    });
    await ctx.db.patch(state._id, {
      liquidityLamports: state.liquidityLamports + (gross - mintFee),
    });

    return { ok: true, spent: gross };
  },
});
