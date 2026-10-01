import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  ensureProtocolState,
  ensureVaultPool,
  getWalletForUser,
  getWalletForUserOrThrow,
  protocolStateOrDefault,
  requireUserId,
  routeFee,
} from "./backendHelpers";
import { sha256Hex } from "./sha256";
import {
  APPROVED_MAX_LOTS,
  APPROVED_RATE_LAMPORTS,
  CONFIRMATIONS_REQUIRED,
  ENVELOPE_MINT_BYTES,
  ENVELOPE_TRANSFER_BYTES,
  LOT_SIZE,
  MINT_FEE_BPS,
  OPEN_MAX_LOTS,
  OPEN_RATE_LAMPORTS,
  RELAYER_FEE_LAMPORTS,
  type RateTier,
  hexHashOf,
} from "../lib/protocol";

const ADDRESS_LEN = 44;

/** Sealed-note ciphertext size: 512 bytes → the 934-byte mint envelope. */
export const NOTE_CIPHERTEXT_BYTES = 512;
/** The ciphertext travels base64-encoded: 512 bytes → exactly 684 chars. */
export const CIPHERTEXT_B64_LEN = 684;

interface SealedObj {
  ephemeral: string;
  nonce: string;
  ciphertext: string;
}

function b64UrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64url decode without relying on atob (not guaranteed in isolates). */
function base64DecodeToString(s: string): string {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/");
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B64_CHARS.indexOf(ch);
    if (idx === -1) continue;
    acc = (acc << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Envelope format: `SOLZK|<kind>|<b64len>|<b64(json)>` zero-padded to the
 * uniform size (934 bytes for a mint, 921 for a transfer). The explicit
 * length makes the padding unambiguous.
 */
export function buildEnvelope(
  kind: "mint" | "transfer",
  sealed: SealedObj,
): string {
  const b64 = b64UrlSafe(btoa(JSON.stringify(sealed)));
  const prefix = `SOLZK|${kind}|${b64.length}|`;
  const totalHexBytes =
    kind === "mint" ? ENVELOPE_MINT_BYTES : ENVELOPE_TRANSFER_BYTES;
  let payload = prefix + b64;
  if (payload.length > totalHexBytes * 2) {
    throw new Error("Envelope overflows the uniform size");
  }
  while (payload.length < totalHexBytes * 2) payload += "0";
  return payload;
}

/** Padding is stripped via the explicit length field before JSON.parse. */
export function parseSealed(payload: string): SealedObj | null {
  try {
    const parts = payload.split("|");
    if (parts.length !== 4 || parts[0] !== "SOLZK") return null;
    if (parts[1] !== "mint" && parts[1] !== "transfer") return null;
    const len = Number(parts[2]);
    if (!Number.isInteger(len) || len < 0 || len > parts[3].length) return null;
    const json = base64DecodeToString(parts[3].slice(0, len));
    const obj = JSON.parse(json);
    if (
      typeof obj.ephemeral === "string" &&
      typeof obj.nonce === "string" &&
      typeof obj.ciphertext === "string"
    ) {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}

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
      treasuryLamports: state.treasuryLamports,
      liquidityLamports: state.liquidityLamports,
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
    // Approved tier = the first 200 wallets — same rule the node enforces
    // when an invoice is opened.
    const faucetUsers = await ctx.db
      .query("wallets")
      .withIndex("by_creation", (q) => q.lt("createdAt", 9e15))
      .order("asc")
      .take(200);
    const approved = faucetUsers.some((w) => w._id === wallet._id);
    return {
      _id: wallet._id,
      address: wallet.address,
      fundingLamports: wallet.fundingLamports,
      faucetTotalLamports: wallet.faucetTotalLamports,
      lotsMinted: wallet.lotsMinted,
      approved,
      mintedTokens: wallet.lotsMinted * state.lotSize,
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
        "This account already holds a SOLZK wallet. One account, one wallet.",
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
        ciphertext: hexHashOf(`solzk-faucet:${address}:${fundingLamports}`),
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
  args: {
    lots: v.number(),
    tier: v.string(),
    commitment: v.string(),
    noteR: v.string(),
  },
  handler: async (ctx, { lots, tier, commitment, noteR }) => {
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

    // Approved tier: the first 200 wallets. A price, not a guarantee.
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
    const effTier: RateTier =
      tier === "approved" && isApproved ? "approved" : "open";
    const lamports = perLot * lots;

    const cap = effTier === "approved" ? APPROVED_MAX_LOTS : OPEN_MAX_LOTS;
    if (wallet.lotsMinted + lots > cap) {
      throw new Error(
        `Cap reached: ${cap.toLocaleString()} lots per wallet on the ${effTier} rate.`,
      );
    }

    const depositAddress = hexHashOf(
      `solzk-deposit:${wallet.address}:${Date.now()}:${Math.random()}`,
    ).slice(0, ADDRESS_LEN);

    const id = await ctx.db.insert("invoices", {
      walletId: wallet._id,
      lots,
      lamports,
      tier: effTier,
      commitment,
      noteR,
      depositAddress,
      status: "awaiting_payment",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    return { invoiceId: id, depositAddress, lamports, tier: effTier };
  },
});

/**
 * Pay an invoice from the wallet's unshielded SOL — builds, signs and
 * broadcasts in one step.
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
    if (wallet.fundingLamports < invoice.lamports + RELAYER_FEE_LAMPORTS) {
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
 * The settlement tick. Advances an invoice from "seen" through 3
 * confirmations to minting. There is no button — the moment the payment
 * settles, the browser builds the proof and hands the envelope to the
 * relayer, which publishes it.
 *
 * Fee routing on mint: 5% of the mint price is the protocol fee. Half goes
 * to the vault fee pool (depositors, like LP fees), half to the treasury.
 * The other 95% is reserved as protocol liquidity inside the vault.
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
    const expected = sha256Hex(sha256Hex(payload) + "solzk-circuit-v1");
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    // Uniform size: the envelope is exactly 934 bytes — the sealed note
    // followed by zero padding. Size never leaks the amount.
    if (payload.length !== ENVELOPE_MINT_BYTES * 2) {
      throw new Error(
        `Mint envelope must be exactly ${ENVELOPE_MINT_BYTES} bytes.`,
      );
    }
    const sealed = parseSealed(payload);
    if (!sealed) {
      throw new Error("Envelope is not a well-formed sealed note.");
    }
    if (sealed.ciphertext.length !== CIPHERTEXT_B64_LEN) {
      throw new Error("Sealed note ciphertext must be 512 bytes.");
    }
    const expectedCommitment = sha256Hex(
      `solzk-note:${invoice.lots * LOT_SIZE}:${invoice.noteR}:${wallet.address}`,
    );
    if (expectedCommitment !== invoice.commitment) {
      throw new Error(
        "Commitment mismatch — envelope does not bind the invoice.",
      );
    }

    // Deduct payment + relayer fee.
    const total = invoice.lamports + RELAYER_FEE_LAMPORTS;
    if (wallet.fundingLamports < total) {
      throw new Error("Insufficient SOL at settlement.");
    }

    // ---- Fee routing -------------------------------------------------
    // 5% of the mint price is the protocol fee: half to the vault fee pool
    // (depositors), half to the treasury. The other 95% becomes protocol
    // liquidity inside the vault, backstopping withdrawals.
    const mintFee = Math.ceil((invoice.lamports * MINT_FEE_BPS) / 10_000);
    const liquidityCut = invoice.lamports - mintFee;
    const pool = await ensureVaultPool(ctx);
    await routeFee(ctx, state, pool, mintFee);

    const slot = nowSlot(state.genesisMs);
    const signature =
      invoice.signature ?? hexHashOf(`sig:${invoiceId}:${Date.now()}`);

    const envelopeId = await ctx.db.insert("envelopes", {
      kind: "mint",
      signature,
      slot,
      payloadSize: ENVELOPE_MINT_BYTES,
      feeLamports: mintFee,
      payload,
      proof,
      invoiceId,
      createdAt: Date.now(),
    });

    // Sealed note — only the buyer's browser can open it.
    await ctx.db.insert("notes", {
      commitment: invoice.commitment,
      sealed,
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
      liquidityLamports: state.liquidityLamports + liquidityCut,
    });

    return {
      status: "minted",
      confirmations: 3,
      minted: true,
      envelopeId,
      signature,
    };
  },
});

/**
 * Shielded transfer: spend notes by nullifier, create a sealed note for the
 * receiver. The ledger can link neither the nullifier to the commitment nor
 * the new note to the sender. The 2% market fee applies to transfers too —
 * half to the vault fee pool, half to the treasury.
 */
export const sendPrivate = mutation({
  args: {
    nullifiers: v.array(v.string()),
    receiver: v.string(),
    amount: v.number(),
    receiverCommitment: v.string(),
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
    changeCommitment: v.string(),
    proof: v.string(),
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
      if (existing)
        throw new Error("Nullifier already seen — double spend blocked.");
    }
    if (args.sealedNote.ciphertext.length !== CIPHERTEXT_B64_LEN) {
      throw new Error("Sealed note ciphertext must be 512 bytes.");
    }
    const hasChange = args.changeNote.ephemeral !== "none";
    if (
      hasChange &&
      (args.changeNote.ciphertext.length !== CIPHERTEXT_B64_LEN ||
        !args.changeCommitment)
    ) {
      throw new Error("Change note is malformed.");
    }

    // Verify the proof commits to the payload parts — including the new
    // commitments, so a published note cannot be swapped after the fact.
    const statement = `${args.nullifiers.join(",")}|${args.receiver}|${args.amount}|${args.receiverCommitment}|${JSON.stringify(args.sealedNote)}`;
    const expected = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
    if (expected !== args.proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    // 2% protocol fee on every transfer, routed like every other fee.
    const transferFee = Math.ceil((args.amount * 200) / 10_000);
    const pool = await ensureVaultPool(ctx);
    await routeFee(ctx, state, pool, transferFee);

    const slot = nowSlot(state.genesisMs);
    const signature = hexHashOf(
      `tx:${wallet.address}:${Date.now()}:${randomSlot()}`,
    );

    const envelopeId = await ctx.db.insert("envelopes", {
      kind: "transfer",
      signature,
      slot,
      payloadSize: ENVELOPE_TRANSFER_BYTES,
      feeLamports: transferFee,
      payload: buildEnvelope("transfer", args.sealedNote),
      proof: args.proof,
      createdAt: Date.now(),
    });

    for (const n of args.nullifiers) {
      await ctx.db.insert("nullifiers", { value: n, slot });
    }
    await ctx.db.insert("notes", {
      commitment: args.receiverCommitment,
      sealed: args.sealedNote,
      slot,
      createdAt: Date.now(),
    });
    if (hasChange) {
      await ctx.db.insert("notes", {
        commitment: args.changeCommitment,
        sealed: args.changeNote,
        slot,
        createdAt: Date.now(),
      });
    }

    return { signature, slot, envelopeId };
  },
});

/**
 * Devnet control: jump the mint to its sold-out state so the market's
 * open-at-sellout behavior is demonstrable without minting 21,000 lots.
 * Labeled as a simulation everywhere it is surfaced.
 */
export const simulateSellout = mutation({
  args: {},
  handler: async (ctx) => {
    const state = await ensureProtocolState(ctx);
    if (state.marketOpen) return { already: true };
    await ctx.db.patch(state._id, {
      mintedTokens: state.totalSupply,
      mintOpen: false,
      marketOpen: true,
      liquiditySeeded: true,
    });
    return { opened: true };
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
    const wallet = await getWalletForUser(ctx, userId);
    if (!wallet) return [];
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .collect();
    return invoices.sort((a, b) => b.createdAt - a.createdAt);
  },
});
