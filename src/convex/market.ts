import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  ensureProtocolState,
  protocolStateOrDefault,
  getWalletForUserOrThrow,
  requireUserId,
} from "./backendHelpers";
import { sha256Hex } from "./sha256";
import { ENVELOPE_TRANSFER_BYTES, MARKET_FEE_BPS, hexHashOf } from "../lib/protocol";
import { NOTE_CIPHERTEXT_BYTES, buildEnvelope, parseSealed } from "./protocol";

const PROTOCOL_FEE_LAMPORTS = 5_000;

function nowSlot(genesisMs: number): number {
  return Math.floor((Date.now() - genesisMs) / 400);
}

/**
 * The book is readable by anyone. Orders are intents, not deposits — no SOL
 * or notes move until a trade settles.
 */
export const getBook = query({
  args: {},
  handler: async (ctx) => {
    const state = await protocolStateOrDefault(ctx);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    const bids = orders
      .filter((o) => o.side === "buy")
      .sort((a, b) => b.priceLamportsPerKilo - a.priceLamportsPerKilo)
      .slice(0, 12)
      .map((o) => ({
        orderId: o._id,
        price: o.priceLamportsPerKilo,
        remaining: o.amountTokens - o.filledTokens,
        created: o.createdAt,
      }));
    const asks = orders
      .filter((o) => o.side === "sell")
      .sort((a, b) => a.priceLamportsPerKilo - b.priceLamportsPerKilo)
      .slice(0, 12)
      .map((o) => ({
        orderId: o._id,
        price: o.priceLamportsPerKilo,
        remaining: o.amountTokens - o.filledTokens,
        created: o.createdAt,
      }));
    return {
      marketOpen: state.marketOpen,
      bids,
      asks,
    };
  },
});

export const listMyOrders = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_maker", (q) => q.eq("makerWalletId", wallet._id))
      .collect();
    return orders.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listMyTrades = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const asBuyer = await ctx.db
      .query("trades")
      .withIndex("by_buyer", (q) => q.eq("buyerWalletId", wallet._id))
      .collect();
    const asSeller = await ctx.db
      .query("trades")
      .withIndex("by_seller", (q) => q.eq("sellerWalletId", wallet._id))
      .collect();
    const all = [...asBuyer, ...asSeller].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    // The seller needs the buyer's shielded address to seal the settlement
    // note; the buyer's own browser would never learn it otherwise.
    const withAddresses = [];
    for (const t of all) {
      const buyer = await ctx.db.get(t.buyerWalletId);
      const seller = await ctx.db.get(t.sellerWalletId);
      withAddresses.push({
        ...t,
        buyerAddress: buyer?.address ?? "",
        sellerAddress: seller?.address ?? "",
        iAmBuyer: t.buyerWalletId === wallet._id,
      });
    }
    return withAddresses;
  },
});

/**
 * Place a signed limit order. It is an intent: nothing is escrowed here.
 * A buy locks the SOL leg at settlement time, a sell locks the shielded leg.
 */
export const placeOrder = mutation({
  args: {
    side: v.string(),
    priceLamportsPerKilo: v.number(),
    amountTokens: v.number(),
  },
  handler: async (ctx, { side, priceLamportsPerKilo, amountTokens }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    if (!state.marketOpen) {
      throw new Error("The book is closed — orders are refused by the node until the mint sells out.");
    }
    if (side !== "buy" && side !== "sell") {
      throw new Error("Side must be buy or sell.");
    }
    if (priceLamportsPerKilo <= 0) throw new Error("Price must be positive.");
    if (amountTokens < 1_000) throw new Error("Minimum order is 1,000 S404.");

    const id = await ctx.db.insert("orders", {
      makerWalletId: wallet._id,
      side,
      priceLamportsPerKilo,
      amountTokens,
      filledTokens: 0,
      status: "open",
      createdAt: Date.now(),
    });
    return id;
  },
});

export const cancelOrder = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const order = await ctx.db.get(orderId);
    if (!order || order.makerWalletId !== wallet._id) {
      throw new Error("Order not found.");
    }
    if (order.status !== "open") throw new Error("Order is not open.");
    await ctx.db.patch(orderId, { status: "cancelled" });
  },
});

/**
 * Match against the book. The SOL leg is escrowed from the buyer immediately
 * (the node verifies that leg against the ledger); the shielded leg settles
 * when the seller's browser builds and publishes the envelope.
 */
export const takeOrder = mutation({
  args: { orderId: v.id("orders"), amountTokens: v.number() },
  handler: async (ctx, { orderId, amountTokens }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    if (!state.marketOpen) throw new Error("The book is closed.");

    const order = await ctx.db.get(orderId);
    if (!order || order.status !== "open") throw new Error("Order not found.");
    if (order.makerWalletId === wallet._id) {
      throw new Error("You cannot take your own order.");
    }
    const remaining = order.amountTokens - order.filledTokens;
    const fill = Math.min(remaining, amountTokens);
    if (fill <= 0) throw new Error("Nothing left to fill.");

    const gross = Math.ceil((fill * order.priceLamportsPerKilo) / 1000);
    const fee = Math.ceil((gross * MARKET_FEE_BPS) / 10_000);

    let buyerWalletId: Id<"wallets">, sellerWalletId: Id<"wallets">;
    let buyOrderId: Id<"orders"> | undefined, sellOrderId: Id<"orders"> | undefined;

    if (order.side === "sell") {
      // I am buying; maker sells.
      if (wallet.fundingLamports < gross + fee) {
        throw new Error("Insufficient SOL for this fill.");
      }
      buyerWalletId = wallet._id;
      sellerWalletId = order.makerWalletId;
      buyOrderId = undefined;
      sellOrderId = order._id;
    } else {
      // I am selling into a bid; maker buys. Their SOL leg is escrowed at
      // fill — the node verifies that leg against the ledger.
      const buyer = await ctx.db.get(order.makerWalletId);
      if (!buyer) throw new Error("Buyer wallet missing.");
      if (buyer.fundingLamports < gross + fee) {
        throw new Error("Maker has insufficient escrow — order is not takeable.");
      }
      await ctx.db.patch(buyer._id, {
        fundingLamports: buyer.fundingLamports - (gross + fee),
      });
      buyerWalletId = order.makerWalletId;
      sellerWalletId = wallet._id;
      buyOrderId = order._id;
      sellOrderId = undefined;
    }

    const tradeId = await ctx.db.insert("trades", {
      buyOrderId,
      sellOrderId,
      buyerWalletId,
      sellerWalletId,
      tokens: fill,
      lamports: gross,
      feeLamports: fee,
      status: "pending_settlement",
      createdAt: Date.now(),
    });

    await ctx.db.patch(order._id, { filledTokens: order.filledTokens + fill });

    // Escrow the SOL leg for sell orders taken (buyer pays into escrow now).
    if (order.side === "sell") {
      await ctx.db.patch(wallet._id, {
        fundingLamports: wallet.fundingLamports - (gross + fee),
      });
    }

    return { tradeId, tokens: fill, lamports: gross, feeLamports: fee };
  },
});

/**
 * Seller's browser builds the shielded envelope for the buyer and publishes
 * it. Only then does the escrowed SOL release to the seller (minus fee).
 */
export const settleTrade = mutation({
  args: {
    tradeId: v.id("trades"),
    sealedNote: v.object({
      ephemeral: v.string(),
      nonce: v.string(),
      ciphertext: v.string(),
    }),
    commitment: v.string(),
    proof: v.string(),
  },
  handler: async (ctx, { tradeId, sealedNote, commitment, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    const trade = await ctx.db.get(tradeId);
    if (!trade) throw new Error("Trade not found.");
    if (trade.sellerWalletId !== wallet._id) {
      throw new Error("Only the seller can settle this trade.");
    }
    if (trade.status !== "pending_settlement") {
      throw new Error("Trade already settled.");
    }
    if (sealedNote.ciphertext.length / 2 !== NOTE_CIPHERTEXT_BYTES) {
      throw new Error("Sealed note ciphertext must be 512 bytes.");
    }

    const expected = sha256Hex(
      sha256Hex(`${tradeId}:${commitment}:${JSON.stringify(sealedNote)}`) +
        "s404-circuit-v1",
    );
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }
    const parsed = parseSealed(buildEnvelope("transfer", sealedNote));
    if (!parsed || parsed.ciphertext !== sealedNote.ciphertext) {
      throw new Error("Envelope is not a well-formed sealed note.");
    }

    const slot = nowSlot(state.genesisMs);
    const envelopeId = await ctx.db.insert("envelopes", {
      kind: "transfer",
      signature: hexHashOf(`trade:${tradeId}:${Date.now()}`),
      slot,
      payloadSize: ENVELOPE_TRANSFER_BYTES,
      feeLamports: PROTOCOL_FEE_LAMPORTS,
      payload: buildEnvelope("transfer", sealedNote),
      proof,
      tradeId,
      createdAt: Date.now(),
    });

    await ctx.db.insert("notes", { commitment, sealed: sealedNote, slot, createdAt: Date.now() });

    // Release escrow to the seller (net of the 2% fee).
    const seller = await ctx.db.get(trade.sellerWalletId);
    if (seller) {
      await ctx.db.patch(seller._id, {
        fundingLamports: seller.fundingLamports + (trade.lamports - trade.feeLamports),
      });
    }
    await ctx.db.patch(state._id, {
      feeLamportsCollected: state.feeLamportsCollected + trade.feeLamports,
    });
    await ctx.db.patch(tradeId, {
      status: "settled",
      shieldedEnvelopeId: envelopeId,
    });

    // If the mint is done, the market is officially live after the first settle.
    return { ok: true, envelopeId };
  },
});

/**
 * Open the market the moment the mint sells out. There is no button and no
 * house liquidity: orders are refused by the node until this flips, and the
 * book is empty until real participants place signed intents.
 */
export const maybeOpenMarket = mutation({
  args: {},
  handler: async (ctx) => {
    const state = await ensureProtocolState(ctx);
    if (state.marketOpen) return { opened: false, already: true };
    if (state.mintedTokens < state.totalSupply) return { opened: false };

    await ctx.db.patch(state._id, { marketOpen: true, liquiditySeeded: true });
    return { opened: true };
  },
});
