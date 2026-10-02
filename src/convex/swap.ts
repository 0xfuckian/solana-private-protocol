import { appendNote } from "./merkle";
import { assertNullifiers, assertSealedNote } from "../lib/safety";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  ensureProtocolState,
  ensureVaultPool,
  getWalletForUserOrThrow,
  readProtocolState,
  requireUserId,
  routeFee,
} from "./backendHelpers";
import { sha256Hex } from "./sha256";
import {
  MIN_SWAP_LAMPORTS,
  MIN_SWAP_TOKENS,
  hexHashOf,
  quoteSwapSolForTokens,
  quoteSwapTokensForSol,
} from "../lib/protocol";
import { CIPHERTEXT_B64_LEN } from "./protocol";

/**
 * Private swap — the stretch goal from the protocol design. The pool is a
 * constant-product AMM whose reserves are protocol-owned: SOL on one side,
 * SOLZK on the other. A swap is a join-split against both sides at once:
 * the SOL leg is verified against the ledger, the shielded leg is proven
 * (nullifiers in, sealed notes out) and never read by the node. The output
 * stays in the pool — a swap never unshields unless you ask it to.
 *
 * The swap fee (0.3%) routes exactly like every other protocol fee: half
 * to the vault fee pool, half to the treasury.
 */

/** Public pool view: reserves, mid price, open flag. */
export const getPool = query({
  args: {},
  handler: async (ctx) => {
    const state = await readProtocolState(ctx);
    const solReserve = state?.swapSolReserve ?? 0;
    const tokenReserve = state?.swapTokenReserve ?? 0;
    return {
      solReserve,
      tokenReserve,
      midPriceLamportsPerToken:
        solReserve > 0 && tokenReserve > 0 ? solReserve / tokenReserve : 0,
      open: solReserve > 0 && tokenReserve > 0,
    };
  },
});

/** Recent swap flow — the explorer feed. */
export const listSwaps = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return ctx.db
      .query("swapEvents")
      .withIndex("by_created")
      .order("desc")
      .take(limit ?? 15);
  },
});

/**
 * Devnet simulation control: seed the AMM reserves. On mainnet the pool is
 * seeded from protocol liquidity plus LP deposits; here it is a one-click
 * fixture sized so the mid price lands on the open mint rate
 * (350 lamports per token), keeping every page coherent.
 */
export const seedReserves = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    const state = await ensureProtocolState(ctx);
    if ((state.swapSolReserve ?? 0) > 0 && (state.swapTokenReserve ?? 0) > 0) {
      return { seeded: false };
    }
    await ctx.db.patch(state._id, {
      // 35 SOL ↔ 10,000,000 SOLZK → 350 lamports/token, the open mint rate.
      swapSolReserve: 3_500_000_000,
      swapTokenReserve: 10_000_000,
    });
    return { seeded: true };
  },
});

/**
 * Swap SOL → SOLZK. The SOL leg leaves your ordinary wallet and joins the
 * reserves; the SOLZK leg is sealed into a fresh note only you can open.
 * The node verifies the SOL leg and the proof — never the shielded output.
 */
export const swapSolForTokens = mutation({
  args: {
    solLamportsIn: v.number(),
    minTokensOut: v.number(),
    sealedNote: v.object({
      ephemeral: v.string(),
      nonce: v.string(),
      ciphertext: v.string(),
    }),
    commitment: v.string(),
    proof: v.string(),
  },
  handler: async (ctx, { solLamportsIn, minTokensOut, sealedNote, commitment, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    const solReserve = state.swapSolReserve ?? 0;
    const tokenReserve = state.swapTokenReserve ?? 0;
    if (solReserve <= 0 || tokenReserve <= 0) {
      throw new Error("The private swap pool is not seeded yet.");
    }
    if (!Number.isInteger(solLamportsIn) || solLamportsIn < MIN_SWAP_LAMPORTS) {
      throw new Error(
        `Minimum swap is ${(MIN_SWAP_LAMPORTS / 100_000_000).toFixed(4)} SOL.`,
      );
    }
    if (wallet.fundingLamports < solLamportsIn) {
      throw new Error("Insufficient SOL for this swap.");
    }
    assertSealedNote(sealedNote);
    if (sealedNote.ciphertext.length !== CIPHERTEXT_B64_LEN) {
      throw new Error("Sealed note ciphertext must be 512 bytes.");
    }

    const quote = quoteSwapSolForTokens(solLamportsIn, solReserve, tokenReserve);
    if (!quote) {
      throw new Error("Swap pool reserves cannot cover that trade.");
    }
    if (quote.outAmount < minTokensOut) {
      throw new Error(
        `Slippage guard: this trade now yields ${quote.outAmount.toLocaleString()} SOLZK, below your ${minTokensOut.toLocaleString()} minimum.`,
      );
    }

    // The proof commits to the SOL leg and the sealed output note — the
    // shielded leg cannot be altered in transit.
    const statement = `swap-sol:${wallet.address}:${solLamportsIn}:${commitment}:${JSON.stringify(sealedNote)}`;
    const expected = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    // Fee routing and reserve accounting: the fee leaves the pool to
    // vault + treasury, the net SOL joins the reserves.
    const pool = await ensurePoolRef(ctx);
    if (pool) await routeFee(ctx, state, pool, quote.feeLamports);

    const newSolReserve = solReserve + (solLamportsIn - quote.feeLamports);
    const newTokenReserve = tokenReserve - quote.outAmount;

    const slot = nowSlotOf(state.genesisMs);
    const signature = hexHashOf(
      `swap:${wallet.address}:${Date.now()}:${Math.floor(Math.random() * 0xffffff)}`,
    );

    await appendNote(ctx, {
      commitment,
      sealed: sealedNote,
      slot,
      createdAt: Date.now(),
    });
    await ctx.db.insert("swapEvents", {
      direction: "sol_to_tokens",
      solLamportsIn,
      solLamportsOut: 0,
      tokensIn: 0,
      tokensOut: quote.outAmount,
      feeLamports: quote.feeLamports,
      solReserve: newSolReserve,
      tokenReserve: newTokenReserve,
      signature,
      slot,
      createdAt: Date.now(),
    });
    await ctx.db.patch(state._id, {
      swapSolReserve: newSolReserve,
      swapTokenReserve: newTokenReserve,
    });
    await ctx.db.patch(wallet._id, {
      fundingLamports: wallet.fundingLamports - solLamportsIn,
    });

    return {
      tokensOut: quote.outAmount,
      feeLamports: quote.feeLamports,
      signature,
      slot,
    };
  },
});

/**
 * Swap SOLZK → SOL: spend notes by nullifier, receive SOL to your ordinary
 * wallet. The ledger sees nullifiers and a SOL payout — never a balance,
 * never a link to the notes that funded it.
 */
export const swapTokensForSol = mutation({
  args: {
    tokensIn: v.number(),
    minLamportsOut: v.number(),
    nullifiers: v.array(v.string()),
    proof: v.string(),
  },
  handler: async (ctx, { tokensIn, minLamportsOut, nullifiers, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    const solReserve = state.swapSolReserve ?? 0;
    const tokenReserve = state.swapTokenReserve ?? 0;
    if (solReserve <= 0 || tokenReserve <= 0) {
      throw new Error("The private swap pool is not seeded yet.");
    }
    if (!Number.isInteger(tokensIn) || tokensIn < MIN_SWAP_TOKENS) {
      throw new Error(`Minimum swap is ${MIN_SWAP_TOKENS.toLocaleString()} SOLZK.`);
    }
    assertNullifiers(nullifiers);
    for (const n of nullifiers) {
      const existing = await ctx.db
        .query("nullifiers")
        .withIndex("by_value", (q) => q.eq("value", n))
        .first();
      if (existing)
        throw new Error("Nullifier already seen — double spend blocked.");
    }

    const quote = quoteSwapTokensForSol(tokensIn, solReserve, tokenReserve);
    if (!quote) {
      throw new Error("Swap pool reserves cannot cover that trade.");
    }
    if (quote.outAmount < minLamportsOut) {
      throw new Error(
        `Slippage guard: this trade now yields ${(quote.outAmount / 100_000_000).toFixed(6)} SOL, below your minimum.`,
      );
    }

    const statement = `swap-tokens:${wallet.address}:${tokensIn}:${nullifiers.join(",")}`;
    const expected = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    const pool = await ensurePoolRef(ctx);
    if (pool) await routeFee(ctx, state, pool, quote.feeLamports);

    // The gross SOL leaves the reserves; the fee is diverted to vault +
    // treasury on the way, the rest lands in the swapper's wallet.
    const grossSolOut = quote.outAmount + quote.feeLamports;
    const newSolReserve = solReserve - grossSolOut;
    const newTokenReserve = tokenReserve + tokensIn;

    const slot = nowSlotOf(state.genesisMs);
    const signature = hexHashOf(
      `swap:${wallet.address}:${Date.now()}:${Math.floor(Math.random() * 0xffffff)}`,
    );

    for (const n of nullifiers) {
      await ctx.db.insert("nullifiers", { value: n, slot });
    }
    await ctx.db.insert("swapEvents", {
      direction: "tokens_to_sol",
      solLamportsIn: 0,
      solLamportsOut: quote.outAmount,
      tokensIn,
      tokensOut: 0,
      feeLamports: quote.feeLamports,
      solReserve: newSolReserve,
      tokenReserve: newTokenReserve,
      signature,
      slot,
      createdAt: Date.now(),
    });
    await ctx.db.patch(state._id, {
      swapSolReserve: newSolReserve,
      swapTokenReserve: newTokenReserve,
    });
    await ctx.db.patch(wallet._id, {
      fundingLamports: wallet.fundingLamports + quote.outAmount,
    });

    return {
      lamportsOut: quote.outAmount,
      feeLamports: quote.feeLamports,
      signature,
      slot,
    };
  },
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function nowSlotOf(genesisMs: number): number {
  return Math.floor((Date.now() - genesisMs) / 400);
}

/** Load the vault pool if it exists — swaps route fees through it. */
async function ensurePoolRef(ctx: MutationCtx) {
  return ensureVaultPool(ctx);
}
