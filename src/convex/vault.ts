import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  ensureProtocolState,
  getWalletForUserOrThrow,
  requireUserId,
} from "./backendHelpers";
import { ENVELOPE_MINT_BYTES, hexHashOf } from "../lib/protocol";
import { sha256Hex } from "./sha256";

const PROTOCOL_FEE_LAMPORTS = 5_000;

/**
 * The vault: every private token deployed on S404. S404 itself was issued
 * through exactly this path — a deploy operation published as an envelope.
 */
export const listTokens = query({
  args: {},
  handler: async (ctx) => {
    await getAuthUserId(ctx); // public read, auth optional
    const tokens = await ctx.db.query("vaultTokens").order("desc").collect();
    const protocolToken = {
      _id: "s404",
      ticker: "S404",
      name: "S404 — the private SOL standard",
      maxSupply: 210_000_000,
      mintedTokens: 0,
      priceLamportsPerKilo: 10_000,
      mintOpen: true,
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

export const getBalance = query({
  args: { tokenId: v.string() },
  handler: async (ctx, { tokenId }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const balances = await ctx.db
      .query("vaultBalances")
      .withIndex("by_wallet_token", (q) => q.eq("walletId", wallet._id))
      .collect();
    const bal = balances.find((b) => b.tokenId === tokenId);
    return bal?.amount ?? 0;
  },
});

/**
 * Deploy a shielded token: ticker, maximum supply and per-mint limit,
 * published as an envelope like any other. Consensus rules are unchanged —
 * this is tooling on top of a capability the pool already has.
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
      throw new Error("The devnet faucet has not been used on this wallet yet.");
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
        "s404-circuit-v1",
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

    const expected = sha256Hex(
      sha256Hex(`vaultbuy:${tokenId}:${amountTokens}:${JSON.stringify(sealedNote)}`) +
        "s404-circuit-v1",
    );
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    // Publish the mint envelope — amounts and ticker are public at mint time,
    // because supply has to be auditable. After that, nothing is.
    await ctx.db.insert("envelopes", {
      kind: "mint",
      signature: hexHashOf(`vault:${tokenId}:${Date.now()}`),
      slot: Math.floor((Date.now() - state.genesisMs) / 400),
      payloadSize: ENVELOPE_MINT_BYTES,
      feeLamports: PROTOCOL_FEE_LAMPORTS,
      payload: JSON.stringify({ ticker: token.ticker, amount: amountTokens }),
      proof,
      createdAt: Date.now(),
    });

    await ctx.db.insert("notes", { commitment, sealed: sealedNote, slot: 0, createdAt: Date.now() });

    const bal = await ctx.db
      .query("vaultBalances")
      .withIndex("by_wallet_token", (q) =>
        q.eq("walletId", wallet._id).eq("tokenId", tokenId),
      )
      .first();
    if (bal) {
      await ctx.db.patch(bal._id, { amount: bal.amount + amountTokens });
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

    return { ok: true, spent: gross };
  },
});
