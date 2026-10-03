import { sealedStatement } from "../lib/spend";
import { consumeSpend, requireVerifiedProof, spendArgs } from "./spend";
import { appendNote } from "./merkle";
import { assertNullifiers, assertSealedNote, assertUnits } from "../lib/safety";
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
import {
  MIN_SWAP_LAMPORTS,
  MIN_SWAP_TOKENS,
  TICKER,
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

// The AMM reserves are not seeded by hand. They are funded from real protocol
// liquidity (the 95% mint reserve) and LP deposits, so a fresh pool is empty
// until genuine value flows in.

/**
 * Swap SOL → SOLZK. The SOL leg leaves your ordinary wallet and joins the
 * reserves; the SOLZK leg is sealed into a fresh note only you can open.
 * The node verifies the SOL leg and the proof — never the shielded output.
 */
export const swapSolForTokens = mutation({
  args: {
    solLamportsIn: v.number(),
    minTokensOut: v.number(),
    expectedTokensOut: v.number(),
    sealedNote: v.object({
      ephemeral: v.string(),
      nonce: v.string(),
      ciphertext: v.string(),
      epk: v.optional(v.string()),
    }),
    commitment: v.string(),
    proof: v.string(),
  },
  handler: async (ctx, { solLamportsIn, minTokensOut, expectedTokensOut, sealedNote, commitment, proof }) => {
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

    assertUnits(minTokensOut, "Minimum output", true);
    assertUnits(expectedTokensOut, "Expected output");
    const quote = quoteSwapSolForTokens(solLamportsIn, solReserve, tokenReserve);
    if (!quote) {
      throw new Error("Swap pool reserves cannot cover that trade.");
    }
    if (quote.outAmount !== expectedTokensOut) throw new Error("Pool quote changed. Refresh the quote and seal a new output note.");
    if (quote.outAmount < minTokensOut) {
      throw new Error(
        `Slippage guard: this trade now yields ${quote.outAmount.toLocaleString()} ${TICKER}, below your ${minTokensOut.toLocaleString()} minimum.`,
      );
    }

    // The proof commits to the SOL leg and the sealed output note — the
    // shielded leg cannot be altered in transit.
    const statement = `swap-sol:${wallet.address}:${solLamportsIn}:${minTokensOut}:${expectedTokensOut}:${commitment}:${sealedStatement(sealedNote)}`;
    await requireVerifiedProof(ctx, statement, proof);

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
    ...spendArgs,
    proof: v.string(),
  },
  handler: async (ctx, { tokensIn, minLamportsOut, nullifiers, inputTotal, change, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    const solReserve = state.swapSolReserve ?? 0;
    const tokenReserve = state.swapTokenReserve ?? 0;
    if (solReserve <= 0 || tokenReserve <= 0) {
      throw new Error("The private swap pool is not seeded yet.");
    }
    if (!Number.isInteger(tokensIn) || tokensIn < MIN_SWAP_TOKENS) {
      throw new Error(`Minimum swap is ${MIN_SWAP_TOKENS.toLocaleString()} ${TICKER}.`);
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

    assertUnits(minLamportsOut, "Minimum output", true);
    const quote = quoteSwapTokensForSol(tokensIn, solReserve, tokenReserve);
    if (!quote) {
      throw new Error("Swap pool reserves cannot cover that trade.");
    }
    if (quote.outAmount < minLamportsOut) {
      throw new Error(
        `Slippage guard: this trade now yields ${(quote.outAmount / 100_000_000).toFixed(6)} SOL, below your minimum.`,
      );
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

    await consumeSpend(ctx, { nullifiers, inputTotal, change }, tokensIn, `swap-tokens:${wallet.address}:${tokensIn}:${minLamportsOut}`, proof, slot);
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
