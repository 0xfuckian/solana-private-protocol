import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  ensureProtocolState,
  getWalletForUser,
  getWalletForUserOrThrow,
  protocolStateOrDefault,
  requireUserId,
} from "./backendHelpers";
import { sha256Hex } from "./sha256";
import {
  APPROVED_MAX_LOTS,
  APPROVED_RATE_LAMPORTS,
  CONFIRMATIONS_REQUIRED,
  ENVELOPE_MINT_BYTES,
  ENVELOPE_TRANSFER_BYTES,
  LOT_SIZE,
  OPEN_MAX_LOTS,
  OPEN_RATE_LAMPORTS,
  type RateTier,
  hexHashOf,
} from "../lib/protocol";

const PROTOCOL_FEE_LAMPORTS = 5_000; // 0.00005 SOL — the relayer's published fee
const ADDRESS_LEN = 44;

function nowSlot(genesisMs: number): number {
  // Simulated chain: ~2.5 slots/sec like Solana.
  return Math.floor((Date.now() - genesisMs) / 400);
}

function randomSlot(): number {
  return Math.floor(Math.random() * 0xffffff);
}

/**
 * Public protocol info for the landing page, mint page, and explorer.
 */
export const getState = query({
  args: {},
  handler: async (ctx) => {
    const state = await protocolStateOrDefault(ctx);
    const envelopes = await ctx.db
      .query("envelopes")
      .withIndex("by_created")
      .order("desc")
      .take(25);
    const notesCount = (await ctx.db.query("notes").collect()).length;
    const nullifiersCount = (await ctx.db.query("nullifiers").collect()).length;
    return {
      ticker: state.ticker,
      totalSupply: state.totalSupply,
      lotSize: state.lotSize,
      mintedTokens: state.mintedTokens,
      mintOpen: state.mintOpen,
      marketOpen: state.marketOpen,
      genesisMs: state.genesisMs,
      currentSlot: nowSlot(state.genesisMs),
      feeLamportsCollected: state.feeLamportsCollected,
      recentEnvelopes: envelopes.map((e) => ({
        _id: e._id,
        kind: e.kind,
        signature: e.signature,
        slot: e.slot,
        payloadSize: e.payloadSize,
        feeLamports: e.feeLamports,
        createdAt: e.createdAt,
      })),
      notesCount,
      nullifiersCount,
    };
  },
});

/**
 * Everything the dashboard/mint page needs about the caller's wallet.
 */
export const getMyWallet = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const wallet = await getWalletForUser(ctx, userId);
    if (!wallet) return null;
    const state = await protocolStateOrDefault(ctx);
    const lotsMinted = wallet.lotsMinted;
    return {
      _id: wallet._id,
      address: wallet.address,
      fundingLamports: wallet.fundingLamports,
      faucetTotalLamports: wallet.faucetTotalLamports,
      lotsMinted,
      approved: wallet.faucetTotalLamports > 0 ? true : false,
      mintedTokens: lotsMinted * state.lotSize,
      createdAt: wallet.createdAt,
    };
  },
});

/**
 * Register a wallet generated in the browser. The client proves knowledge of
 * the seed by publishing a commitment derived from it.
 */
export const registerWallet = mutation({
  args: {
    address: v.string(),
    commitment: v.string(),
    fundingLamports: v.number(),
  },
  handler: async (ctx, { address, commitment, fundingLamports }) => {
    const userId = await requireUserId(ctx);
    if (address.length !== ADDRESS_LEN) {
      throw new Error("Invalid address");
    }
    const existing = await ctx.db
      .query("wallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      throw new Error(
        "This account already holds an S404 wallet. One account, one wallet.",
      );
    }
    const byAddress = await ctx.db
      .query("wallets")
      .withIndex("by_address", (q) => q.eq("address", address))
      .first();
    if (byAddress) {
      throw new Error("This shielded address is already registered.");
    }
    const state = await ensureProtocolState(ctx);
    const id = await ctx.db.insert("wallets", {
      userId,
      address,
      fundingLamports,
      faucetTotalLamports: fundingLamports,
      lotsMinted: 0,
      createdAt: Date.now(),
    });
    // Sealed registration note — also the devnet faucet receipt.
    await ctx.db.insert("notes", {
      commitment,
      sealed: {
        ephemeral: "faucet",
        nonce: "faucet",
        ciphertext: hexHashOf(`s404-faucet:${address}:${fundingLamports}`),
      },
      slot: nowSlot(state.genesisMs),
      createdAt: Date.now(),
    });
    return id;
  },
});

/**
 * Devnet faucet: tops up the wallet's ordinary (unshielded) SOL so the mint
 * flow can be exercised end-to-end without a real chain.
 */
export const faucet = mutation({
  args: { lamports: v.number() },
  handler: async (ctx, { lamports }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    if (lamports <= 0 || lamports > 50_000_000_000) {
      throw new Error("Faucet amount out of range");
    }
    await ctx.db.patch(wallet._id, {
      fundingLamports: wallet.fundingLamports + lamports,
      faucetTotalLamports: wallet.faucetTotalLamports + lamports,
    });
    return wallet.fundingLamports + lamports;
  },
});

/**
 * Open a mint invoice. Reserves a one-time deposit address.
 */
export const openInvoice = mutation({
  args: { lots: v.number(), tier: v.string(), commitment: v.string() },
  handler: async (ctx, { lots, tier, commitment }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    if (!state.mintOpen) throw new Error("The mint is closed.");
    if (!Number.isInteger(lots) || lots < 1 || lots > 500) {
      throw new Error("Pick between 1 and 500 lots.");
    }
    if (state.mintedTokens + lots * LOT_SIZE > state.totalSupply) {
      throw new Error("That many lots would exceed the supply cap.");
    }

    // Approved tier: the first 200 wallets to use the devnet faucet. A price,
    // not a guarantee — approval does not reserve supply.
    const faucetUsers = await ctx.db
      .query("wallets")
      .withIndex("by_creation", (q) => q.lt("createdAt", 9e15))
      .order("asc")
      .take(200);
    const isApproved = faucetUsers.some((w) => w._id === wallet._id);
    const perLot =
      tier === "approved" && isApproved
        ? APPROVED_RATE_LAMPORTS
        : OPEN_RATE_LAMPORTS;
    const effTier: RateTier = tier === "approved" && isApproved ? "approved" : "open";
    const lamports = perLot * lots;

    // Per-wallet cap across every invoice ever opened.
    const cap = effTier === "approved" ? APPROVED_MAX_LOTS : OPEN_MAX_LOTS;
    if (wallet.lotsMinted + lots > cap) {
      throw new Error(
        `Cap reached: ${cap.toLocaleString()} lots per wallet on the ${effTier} rate.`,
      );
    }

    // One-time deposit address, unique to this invoice.
    const depositAddress = hexHashOf(
      `s404-deposit:${wallet.address}:${Date.now()}:${Math.random()}`,
    ).slice(0, ADDRESS_LEN);

    const id = await ctx.db.insert("invoices", {
      walletId: wallet._id,
      lots,
      lamports,
      tier: effTier,
      depositAddress,
      status: "awaiting_payment",
      commitment,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    return { invoiceId: id, depositAddress, lamports, tier: effTier };
  },
});

/**
 * Pay an invoice from the wallet's unshielded SOL — builds, signs and
 * broadcasts in one step, exactly like pressing Pay in the reference flow.
 */
export const payInvoice = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice || invoice.walletId !== wallet._id) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status !== "awaiting_payment") {
      throw new Error("Invoice is not open for payment.");
    }
    if (Date.now() > invoice.expiresAt) {
      throw new Error("Invoice expired — open a new one.");
    }
    if (wallet.fundingLamports < invoice.lamports + PROTOCOL_FEE_LAMPORTS) {
      throw new Error("Insufficient SOL — use the faucet to top up.");
    }
    await ctx.db.patch(invoiceId, {
      status: "seen",
      paidAt: Date.now(),
      signature: hexHashOf(`sig:${invoiceId}:${Date.now()}`),
    });
    return { signature: invoice.signature ?? "" };
  },
});

/**
 * The settlement tick: called by the client while the mint page is open.
 * Advances an invoice from "seen" through 3 confirmations to minting.
 * There is no button — the moment the payment settles, the browser builds
 * the proof and hands the envelope to the relayer, which publishes it.
 */
export const settleInvoice = mutation({
  args: {
    invoiceId: v.id("invoices"),
    proof: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, { invoiceId, proof, payload }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice || invoice.walletId !== wallet._id) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status !== "seen") {
      return { status: invoice.status, confirmations: 0, minted: false };
    }

    const elapsed = Date.now() - (invoice.paidAt ?? Date.now());
    const confirmations = Math.min(
      CONFIRMATIONS_REQUIRED,
      Math.floor(elapsed / 4000),
    );

    if (confirmations < CONFIRMATIONS_REQUIRED) {
      return { status: "seen", confirmations, minted: false };
    }

    // Verify the proof commits to the payload (relayer-side verification).
    const expected = sha256Hex(sha256Hex(payload) + "s404-circuit-v1");
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }
    if (payload.length / 2 !== ENVELOPE_MINT_BYTES) {
      throw new Error(
        `Mint envelope must be exactly ${ENVELOPE_MINT_BYTES} bytes.`,
      );
    }
    const ack = hexHashOf(payload);
    if (!payload.includes(ack.slice(0, 16))) {
      // Sanity check that the payload embeds its own acknowledgment tag.
      throw new Error("Envelope missing acknowledgment tag.");
    }

    // Deduct payment + relayer fee.
    const total = invoice.lamports + PROTOCOL_FEE_LAMPORTS;
    if (wallet.fundingLamports < total) {
      throw new Error("Insufficient SOL at settlement.");
    }

    const slot = nowSlot(state.genesisMs);
    const signature =
      invoice.signature ?? hexHashOf(`sig:${invoiceId}:${Date.now()}`);

    const envelopeId = await ctx.db.insert("envelopes", {
      kind: "mint",
      signature,
      slot,
      payloadSize: ENVELOPE_MINT_BYTES,
      feeLamports: PROTOCOL_FEE_LAMPORTS,
      payload,
      proof,
      invoiceId,
      createdAt: Date.now(),
    });

    // Sealed note — only the buyer's browser can open it.
    const commitment = invoice.commitment;
    await ctx.db.insert("notes", {
      commitment,
      sealed: JSON.parse(payload) as { ephemeral: string; nonce: string; ciphertext: string },
      slot,
      createdAt: Date.now(),
    });

    await ctx.db.patch(invoiceId, { status: "minted", envelopeId });
    await ctx.db.patch(wallet._id, {
      lotsMinted: wallet.lotsMinted + invoice.lots,
      fundingLamports: wallet.fundingLamports - total,
    });
    await ctx.db.patch(state._id, {
      mintedTokens: state.mintedTokens + invoice.lots * LOT_SIZE,
      feeLamportsCollected: state.feeLamportsCollected + PROTOCOL_FEE_LAMPORTS,
    });

    return { status: "minted", confirmations: 3, minted: true, envelopeId, signature };
  },
});

/**
 * Shielded transfer: spend notes by nullifier, create a sealed note for the
 * receiver. The ledger can link neither the nullifier to the commitment nor
 * the new note to the sender.
 */
export const sendPrivate = mutation({
  args: {
    nullifiers: v.array(v.string()),
    receiver: v.string(),
    amount: v.number(),
    sealedNote: v.object({
      ephemeral: v.string(),
      nonce: v.string(),
      ciphertext: v.string(),
    }),
    changeNote: v.object({
      ephemeral: v.string(),
      nonce: v.string(),
      ciphertext: v.string(),
    }),
    proof: v.string(),
    changeCommitment: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    if (!state.mintOpen && !state.marketOpen) {
      throw new Error("Protocol is not accepting envelopes yet.");
    }
    if (args.receiver.length !== ADDRESS_LEN) {
      throw new Error("Receiver address looks invalid.");
    }
    if (args.amount <= 0) {
      throw new Error("Amount must be positive.");
    }

    // Prove the nullifiers are fresh — the double-spend check.
    for (const n of args.nullifiers) {
      const existing = await ctx.db
        .query("nullifiers")
        .withIndex("by_value", (q) => q.eq("value", n))
        .first();
      if (existing) throw new Error("Nullifier already seen — double spend blocked.");
    }

    // Verify the proof commits to the payload parts.
    const statement = `${args.nullifiers.join(",")}|${args.receiver}|${args.amount}|${JSON.stringify(args.sealedNote)}`;
    const expected = sha256Hex(sha256Hex(statement) + "s404-circuit-v1");
    if (expected !== args.proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    const slot = nowSlot(state.genesisMs);
    const signature = hexHashOf(
      `tx:${wallet.address}:${Date.now()}:${randomSlot()}`,
    );

    const envelopeId = await ctx.db.insert("envelopes", {
      kind: "transfer",
      signature,
      slot,
      payloadSize: ENVELOPE_TRANSFER_BYTES,
      feeLamports: PROTOCOL_FEE_LAMPORTS,
      payload: JSON.stringify(args.sealedNote),
      proof: args.proof,
      createdAt: Date.now(),
    });

    for (const n of args.nullifiers) {
      await ctx.db.insert("nullifiers", { value: n, slot });
    }
    await ctx.db.insert("notes", {
      commitment: hexHashOf(`c:${args.sealedNote.ciphertext}`),
      sealed: args.sealedNote,
      slot,
      createdAt: Date.now(),
    });
    await ctx.db.insert("notes", {
      commitment: args.changeCommitment,
      sealed: args.changeNote,
      slot,
      createdAt: Date.now(),
    });

    await ctx.db.patch(state._id, {
      feeLamportsCollected: state.feeLamportsCollected + PROTOCOL_FEE_LAMPORTS,
    });

    return { signature, slot, envelopeId };
  },
});

/**
 * What the explorer shows: every envelope with its proof, fee and slot — and
 * nothing about who owns what.
 */
export const listEnvelopes = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await protocolStateOrDefault(ctx);
    const envelopes = await ctx.db
      .query("envelopes")
      .withIndex("by_created")
      .order("desc")
      .take(limit ?? 50);
    return envelopes;
  },
});

export const getEnvelope = query({
  args: { signature: v.string() },
  handler: async (ctx, { signature }) => {
    await protocolStateOrDefault(ctx);
    const envelope = await ctx.db
      .query("envelopes")
      .withIndex("by_signature", (q) => q.eq("signature", signature))
      .first();
    if (!envelope) return null;
    const notesCount = (await ctx.db.query("notes").collect()).length;
    return { envelope, notesCount };
  },
});

/** The caller's invoices, newest first — the dashboard's payment history. */
export const listMyInvoices = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .collect();
    return invoices.sort((a, b) => b.createdAt - a.createdAt);
  },
});
