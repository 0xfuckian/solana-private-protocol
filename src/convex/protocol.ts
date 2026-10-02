import { sealedStatement } from "../lib/spend";
import { consumeSpend, spendArgs } from "./spend";
import { appendNote } from "./merkle";
import { assertNullifiers, assertUnits, assertSealedNote, relayerFeeTokens as dynamicRelayerFee } from "../lib/safety";
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
  routeTokenFee,
} from "./backendHelpers";
import { isWalletWhitelisted } from "./whitelist";
import { sha256Hex } from "./sha256";
import {
  APPROVED_MAX_LOTS,
  APPROVED_RATE_LAMPORTS,
  CONFIRMATIONS_REQUIRED,
  ENVELOPE_MINT_BYTES,
  ENVELOPE_TRANSFER_BYTES,
  LOT_SIZE,
  MARKET_FEE_BPS,
  MAX_LOTS_PER_TX,
  MINT_FEE_BPS,
  OPEN_MAX_LOTS,
  OPEN_RATE_LAMPORTS,
  REDEEM_LAMPORTS_PER_TOKEN,
  LAMPORTS_PER_SOL,
  transferFeeTokens,
  RELAYER_FEE_LAMPORTS,
  RELAYER_FEE_NOTE_TOKENS,
  type RateTier,
  assetBySymbol,
  discountTierForBurned,
  effectiveSupply,
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
  epk?: string;
}

const sealedV2 = {
  ephemeral: v.string(),
  nonce: v.string(),
  ciphertext: v.string(),
  epk: v.optional(v.string()),
};

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
      typeof obj.ciphertext === "string" &&
      (obj.epk === undefined || typeof obj.epk === "string")
    ) {
      return obj as SealedObj;
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
      // Supply that still exists after buybacks, tier burns and exits.
      burnedTokens: state.burnedTokens ?? 0,
      effectiveSupply: effectiveSupply(
        state.totalSupply,
        state.burnedTokens ?? 0,
      ),
      relayerFeesTokens: state.relayerFeesTokens ?? 0,
      lastBuybackAt: state.lastBuybackAt,
      // Private swap AMM reserves.
      swapSolReserve: state.swapSolReserve ?? 0,
      swapTokenReserve: state.swapTokenReserve ?? 0,
      // ZK fee-share claims pool + anchor checkpoint.
      claimsPoolTokens: state.claimsPoolTokens ?? 0,
      lastAnchorAt: state.lastAnchorAt,
      lotSize: state.lotSize,
      mintedTokens: state.mintedTokens,
      mintOpen: state.mintOpen,
      marketOpen: state.marketOpen,
      genesisMs: state.genesisMs,
      currentSlot: nowSlot(state.genesisMs),
      treasuryLamports: state.treasuryLamports,
      treasuryTokens: state.treasuryTokens ?? 0,
      vaultFeeTokens: state.vaultFeeTokens ?? 0,
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
    // Approved tier = cleared by the pre-launch whitelist (founder-reviewed),
    // matched by wallet address or by the submitting account.
    const approved = await isWalletWhitelisted(ctx, wallet);
    return {
      _id: wallet._id,
      address: wallet.address,
      fundingLamports: wallet.fundingLamports,
      faucetTotalLamports: wallet.faucetTotalLamports,
      lotsMinted: wallet.lotsMinted,
      approved,
      mintedTokens: wallet.lotsMinted * state.lotSize,
      // Burn-to-discount tier: cumulative burned tokens set a public,
      // permanent discount on transfer fees.
      burnedTokens: wallet.burnedTokens ?? 0,
      tierLabel: discountTierForBurned(wallet.burnedTokens ?? 0).label,
      discountBps: discountTierForBurned(wallet.burnedTokens ?? 0).discountBps,
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
    viewPubKey: v.optional(v.string()),
  },
  handler: async (ctx, { address, commitment, fundingLamports, viewPubKey }) => {
    assertUnits(fundingLamports, "Demo funding", true);
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
    if (viewPubKey !== undefined) {
      let raw = -1;
      try {
        raw = atob(viewPubKey).length;
      } catch {
        raw = -1;
      }
      if (raw !== 65) throw new Error("viewPubKey must decode to 65 bytes.");
    }
    const id = await ctx.db.insert("wallets", {
      userId,
      address,
      viewPubKey,
      fundingLamports,
      faucetTotalLamports: fundingLamports,
      lotsMinted: 0,
      createdAt: Date.now(),
    });
    // Sealed registration note — also the devnet faucet receipt.
    await appendNote(ctx, {
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
    assertUnits(lamports);
    await ensureProtocolState(ctx);
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
    if (!Number.isInteger(lots) || lots < 1 || lots > MAX_LOTS_PER_TX) {
      throw new Error(`Pick between 1 and ${MAX_LOTS_PER_TX.toLocaleString()} lots.`);
    }
    if (state.mintedTokens + lots * LOT_SIZE > state.totalSupply) {
      throw new Error("That many lots would exceed the supply cap.");
    }

    // Approved tier: cleared by the pre-launch whitelist. A price, not a
    // guarantee — approval unlocks the rate, it does not reserve supply.
    const isApproved = await isWalletWhitelisted(ctx, wallet);
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
    await appendNote(ctx, {
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
    sealedNote: v.object(sealedV2),
    changeNote: v.object(sealedV2),
    changeCommitment: v.string(),
    proof: v.string(),
    // Fee-in-note: the relayer is paid out of the spent value in SOLZK and
    // the protocol covers the chain fee, so the sender needs no SOL at all.
    feeInNote: v.optional(v.boolean()),
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
    assertUnits(args.amount);
    assertSealedNote(args.sealedNote);
    if (args.amount <= 0) {
      throw new Error("Amount must be positive.");
    }

    // Prove the nullifiers are fresh — the double-spend check.
    assertNullifiers(args.nullifiers);
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
    if (hasChange) assertSealedNote(args.changeNote);
    else if (args.changeCommitment || args.changeNote.nonce !== "none" || args.changeNote.ciphertext !== "none") throw new Error("Unexpected change metadata.");
    if (
      hasChange &&
      (args.changeNote.ciphertext.length !== CIPHERTEXT_B64_LEN ||
        !args.changeCommitment)
    ) {
      throw new Error("Change note is malformed.");
    }

    // Verify the proof commits to the payload parts — including the new
    // commitments, so a published note cannot be swapped after the fact.
    const statement = `${args.nullifiers.join(",")}|${args.receiver}|${args.amount}|${args.receiverCommitment}|${sealedStatement(args.sealedNote)}|${args.changeCommitment}|${sealedStatement(args.changeNote)}|${args.feeInNote === true}`;
    const expected = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
    if (expected !== args.proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    const staking = await ctx.db.query("stakingPositions").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    const staked = (staking?.amount ?? 0) > 0;
    // Limits use the disclosed simulation exit-rate valuation, not a live SOL price.
    const day = Math.floor(Date.now() / 86_400_000);
    const usage = await ctx.db.query("transferUsage").withIndex("by_wallet_day", q => q.eq("walletId", wallet._id).eq("day", day)).unique();
    const transferValue = args.amount * REDEEM_LAMPORTS_PER_TOKEN;
    assertUnits(transferValue, "Transfer valuation");
    const dailyLimit = (staked ? 100 : 10) * LAMPORTS_PER_SOL;
    if ((usage?.valueUnits ?? 0) + transferValue > dailyLimit) throw new Error(`Daily simulation transfer limit is ${staked ? 100 : 10} SOL-equivalent.`);
    if (usage) await ctx.db.patch(usage._id, { valueUnits: usage.valueUnits + transferValue });
    else await ctx.db.insert("transferUsage", { walletId: wallet._id, day, valueUnits: transferValue });

    // Protocol fee on every transfer, discounted by the sender's burn tier.
    // The tier is public on-chain state: burned tokens → tier_id → discount.
    const discount = discountTierForBurned(wallet.burnedTokens ?? 0);
    const transferFee = transferFeeTokens(args.amount, discount.discountBps, staked ? 100 : 200);
    if (transferFee >= args.amount) {
      throw new Error(
        "Amount too small — it cannot cover the protocol fee.",
      );
    }

    const feeInNote = args.feeInNote === true;
    let relayerFeeTokens = 0;
    if (feeInNote) {
      // The note pays the relayer a flat SOLZK fee; the protocol covers the
      // chain fee. A wallet with zero SOL stays fully spendable.
      relayerFeeTokens = dynamicRelayerFee(args.amount);
      if (args.amount - transferFee - relayerFeeTokens <= 0) {
        throw new Error(
          `Amount too small — fee-in-note needs room for the ${RELAYER_FEE_NOTE_TOKENS} SOLZK relayer fee on top of the protocol fee.`,
        );
      }
    } else if (wallet.fundingLamports < RELAYER_FEE_LAMPORTS) {
      throw new Error(
        "Insufficient SOL for the network fee — enable fee-in-note to pay the relayer from the note itself.",
      );
    }

    // 2% (tier-discounted) protocol fee, routed like every other fee.
    await routeTokenFee(ctx, state, transferFee);

    const slot = nowSlot(state.genesisMs);
    const signature = hexHashOf(
      `tx:${wallet.address}:${Date.now()}:${randomSlot()}`,
    );

    const envelopeId = await ctx.db.insert("envelopes", {
      kind: "transfer",
      signature,
      slot,
      payloadSize: ENVELOPE_TRANSFER_BYTES,
      feeLamports: 0,
      feeTokens: transferFee,
      feeDenomination: "SOLZK",
      payload: buildEnvelope("transfer", args.sealedNote),
      proof: args.proof,
      feeInNote,
      createdAt: Date.now(),
    });

    for (const n of args.nullifiers) {
      await ctx.db.insert("nullifiers", { value: n, slot });
    }
    await appendNote(ctx, {
      commitment: args.receiverCommitment,
      sealed: args.sealedNote,
      slot,
      createdAt: Date.now(),
    });
    if (hasChange) {
      await appendNote(ctx, {
        commitment: args.changeCommitment,
        sealed: args.changeNote,
        slot,
        createdAt: Date.now(),
      });
    }

    // In-note relayer fees land in the public fee vault — visible in the
    // explorer, claimable by whoever operates relayers on mainnet.
    if (relayerFeeTokens > 0) {
      await ctx.db.patch(state._id, {
        relayerFeesTokens: (state.relayerFeesTokens ?? 0) + relayerFeeTokens,
      });
    }
    if (!feeInNote) {
      await ctx.db.patch(wallet._id, {
        fundingLamports: wallet.fundingLamports - RELAYER_FEE_LAMPORTS,
      });
    }

    return { signature, slot, envelopeId, transferFee, relayerFeeTokens };
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
    // Idempotent even after an older sellout that skipped fee routing:
    // route the implied fees for the lots that never went through real
    // invoices, so vault depositors can claim what sellout should have paid.
    const alreadyOpen = state.marketOpen;
    const pool = await ensureVaultPool(ctx);

    // Route the fees the sold-out mint would have collected for the lots
    // that never went through real invoices (priced at the open rate), so
    // the vault demo is coherent: depositors can claim mint fees.
    const alreadyMinted = state.mintedTokens;
    const unmintedLots = Math.floor(
      Math.max(0, state.totalSupply - alreadyMinted) / LOT_SIZE,
    );
    const gross = unmintedLots * OPEN_RATE_LAMPORTS;
    const mintFee = Math.ceil((gross * MINT_FEE_BPS) / 10_000);
    const liquidityCut = gross - mintFee;
    if (mintFee > 0) await routeFee(ctx, state, pool, mintFee);

    await ctx.db.patch(state._id, {
      mintedTokens: state.totalSupply,
      mintOpen: false,
      marketOpen: true,
      liquiditySeeded: true,
      liquidityLamports: state.liquidityLamports + liquidityCut,
    });
    return alreadyOpen ? { opened: false } : { opened: true };
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

/**
 * Fee buyback-and-burn — the keeper job. The treasury fee vault (half of
 * every mint, transfer and trade fee) is swept: the SOL buys SOLZK out of
 * the protocol liquidity reserve at the open rate and the tokens are
 * burned, shrinking supply. On mainnet this routes through Jupiter; here
 * the vault itself is the counterparty, which keeps the demo coherent.
 *
 * Public and permissionless — anyone can run the keeper sweep.
 */
export const executeBuyback = mutation({
  args: {},
  handler: async (ctx) => {
    const state = await ensureProtocolState(ctx);
    const spendable = Math.min(state.treasuryLamports, state.liquidityLamports);
    const lots = Math.floor(spendable / OPEN_RATE_LAMPORTS);
    if (lots < 1) {
      throw new Error(
        "Nothing to buy back yet — the fee vault needs at least one lot's worth of fees.",
      );
    }
    const tokens = lots * LOT_SIZE;
    const spend = lots * OPEN_RATE_LAMPORTS;

    await ctx.db.patch(state._id, {
      treasuryLamports: state.treasuryLamports - spend,
      liquidityLamports: state.liquidityLamports - spend,
      burnedTokens: (state.burnedTokens ?? 0) + tokens,
      lastBuybackAt: Date.now(),
    });

    const signature = hexHashOf(`buyback:${Date.now()}:${randomSlot()}`);
    await ctx.db.insert("burnEvents", {
      kind: "buyback",
      tokensBurned: tokens,
      lamportsSpent: spend,
      signature,
      slot: nowSlot(state.genesisMs),
      createdAt: Date.now(),
    });
    return { tokensBurned: tokens, lamportsSpent: spend, signature };
  },
});

/**
 * Burn-to-discount: burn SOLZK from your shielded notes to unlock a
 * permanent, public fee tier. The burned tokens leave the supply forever;
 * the discount applies to every future transfer fee automatically.
 */
export const burnForTier = mutation({
  args: {
    amountTokens: v.number(),
    nullifiers: v.array(v.string()),
    ...spendArgs,
    proof: v.string(),
  },
  handler: async (ctx, { amountTokens, nullifiers, inputTotal, change, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    if (!state.mintOpen && !state.marketOpen) {
      throw new Error("Protocol is not accepting envelopes yet.");
    }
    if (!Number.isInteger(amountTokens) || amountTokens <= 0) {
      throw new Error("Burn amount must be a positive integer.");
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
    const slot = nowSlot(state.genesisMs);
    await consumeSpend(ctx, { nullifiers, inputTotal, change }, amountTokens, `burn:${wallet.address}:${amountTokens}`, proof, slot);

    const walletBurned = (wallet.burnedTokens ?? 0) + amountTokens;
    await ctx.db.patch(wallet._id, { burnedTokens: walletBurned });
    await ctx.db.patch(state._id, {
      burnedTokens: (state.burnedTokens ?? 0) + amountTokens,
    });

    const signature = hexHashOf(
      `burn:${wallet.address}:${Date.now()}:${randomSlot()}`,
    );
    await ctx.db.insert("burnEvents", {
      kind: "tier",
      tokensBurned: amountTokens,
      lamportsSpent: 0,
      signature,
      slot,
      createdAt: Date.now(),
    });

    const tier = discountTierForBurned(walletBurned);
    return {
      burnedTokens: walletBurned,
      tierLabel: tier.label,
      discountBps: tier.discountBps,
      signature,
    };
  },
});

/**
 * Redeem — the private exit (private swap to SOL). Notes are spent and the
 * value burns against the 95% liquidity reserve at the exit rate: the SOL
 * goes to your ordinary wallet, the tokens leave the supply forever. The
 * ledger sees a burn and a payout — never a balance, never a link.
 */
export const redeem = mutation({
  args: {
    amountTokens: v.number(),
    nullifiers: v.array(v.string()),
    ...spendArgs,
    proof: v.string(),
  },
  handler: async (ctx, { amountTokens, nullifiers, inputTotal, change, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    if (!state.mintOpen && !state.marketOpen) {
      throw new Error("Protocol is not accepting envelopes yet.");
    }
    if (!Number.isInteger(amountTokens) || amountTokens <= 0) {
      throw new Error("Redeem amount must be a positive integer.");
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

    const gross = Math.floor((amountTokens * OPEN_RATE_LAMPORTS) / LOT_SIZE);
    const fee = Math.ceil((gross * MARKET_FEE_BPS) / 10_000);
    const net = gross - fee;
    if (net <= 0) {
      throw new Error("Amount too small — it cannot cover the exit fee.");
    }
    if (state.liquidityLamports < gross) {
      throw new Error(
        "Protocol liquidity cannot cover that redemption right now.",
      );
    }

    const slot = nowSlot(state.genesisMs);
    await consumeSpend(ctx, { nullifiers, inputTotal, change }, amountTokens, `redeem:${wallet.address}:${amountTokens}`, proof, slot);

    // The exit fee routes exactly like every other fee: half vault, half
    // treasury. The rest of the gross leaves the liquidity reserve.
    const pool = await ensureVaultPool(ctx);
    await routeFee(ctx, state, pool, fee);
    await ctx.db.patch(state._id, {
      liquidityLamports: state.liquidityLamports - gross,
      burnedTokens: (state.burnedTokens ?? 0) + amountTokens,
    });
    await ctx.db.patch(wallet._id, {
      fundingLamports: wallet.fundingLamports + net,
    });

    const signature = hexHashOf(
      `redeem:${wallet.address}:${Date.now()}:${randomSlot()}`,
    );
    await ctx.db.insert("burnEvents", {
      kind: "redeem",
      tokensBurned: amountTokens,
      lamportsSpent: net,
      signature,
      slot,
      createdAt: Date.now(),
    });
    return { netLamports: net, feeLamports: fee, signature, slot };
  },
});

// ---------------------------------------------------------------------------
// Private swap pool bootstrap + claims pool seed (devnet simulation hooks)
// ---------------------------------------------------------------------------

/**
 * Devnet simulation control: size the claims pool to a fixed fraction of
 * lifetime routed fees — the same relationship the protocol spec proposes
 * (a slice of every fee funds the fee-share claims pool on mainnet).
 */
export const seedClaimsPool = mutation({
  args: {},
  handler: async (ctx) => {
    const state = await ensureProtocolState(ctx);
    if ((state.claimsPoolTokens ?? 0) > 0) return { seeded: false };
    // 0.1% of effective supply: 210,000 SOLZK at genesis.
    const tokens = Math.floor(state.totalSupply * 0.001);
    await ctx.db.patch(state._id, { claimsPoolTokens: tokens });
    return { seeded: true, tokens };
  },
});

/**
 * Devnet simulation control: seed the private swap AMM reserves. On
 * mainnet the pool is seeded from protocol liquidity; here it is a
 * one-click fixture. See convex/swap.ts for the swap logic itself.
 */
export const seedSwapPool = mutation({
  args: {},
  handler: async (ctx) => {
    const state = await ensureProtocolState(ctx);
    if ((state.swapSolReserve ?? 0) > 0 && (state.swapTokenReserve ?? 0) > 0) {
      return { seeded: false };
    }
    // 35 SOL ↔ 10,000,000 SOLZK → 350 lamports/token, the open mint rate.
    await ctx.db.patch(state._id, {
      swapSolReserve: 3_500_000_000,
      swapTokenReserve: 10_000_000,
    });
    return { seeded: true };
  },
});

// ---------------------------------------------------------------------------
// ZK fee-share claims — prove you held value at a past anchor, claim from
// the claims pool, without revealing balance or identity.
// ---------------------------------------------------------------------------

/**
 * The public fee anchor: a running checkpoint of (slot, fee pool size).
 * Anyone checkpointing — a keeper, an indexer, you — advances the anchor;
 * the previous root stays on chain for anyone to prove against later.
 * In the real circuit this root is the Merkle root of the commitment tree
 * at that slot; here it is a hash binding slot and pool size, and the
 * holder's witness is their note commitment.
 */
export const checkpointAnchor = mutation({
  args: {},
  handler: async (ctx) => {
    const state = await ensureProtocolState(ctx);
    const pool = await ensureVaultPool(ctx);
    const slot = Math.floor((Date.now() - state.genesisMs) / 400);
    const root = sha256Hex(
      `solzk-anchor:${slot}:${pool.depositedTokens}:${pool.feePoolLamports}:${state.totalFeePoolCheckpoint ?? 0}`,
    );
    await ctx.db.patch(state._id, {
      lastAnchorAt: Date.now(),
      totalFeePoolCheckpoint: pool.feePoolLamports,
    });
    return { slot, root };
  },
});
export const listBurns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await protocolStateOrDefault(ctx);
    return ctx.db
      .query("burnEvents")
      .withIndex("by_created")
      .order("desc")
      .take(limit ?? 20);
  },
});

/**
 * ZK fee-share claim. The prover states: "at anchor slot S, I held a note
 * of value V; its commitment is in the anchor's set." The claim nullifier
 * binds (wallet, anchor, value) so each claim can be made once; the proof
 * commits to the witness — the node verifies the statement, not the
 * balance, and learns nothing beyond the claim size.
 *
 * Payout: pro-rata slice of the claims pool in SOL, funded by a slice of
 * protocol fees (see seedClaimsPool for the devnet sizing).
 */
export const claimFeeShare = mutation({
  args: {
    anchorSlot: v.number(),
    anchorRoot: v.string(),
    holderCommitment: v.string(),
    tokens: v.number(),
    proof: v.string(),
  },
  handler: async (ctx, { anchorSlot, anchorRoot, holderCommitment, tokens, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);

    if ((state.claimsPoolTokens ?? 0) <= 0) {
      throw new Error("The claims pool is not funded yet.");
    }
    if (!Number.isInteger(tokens) || tokens <= 0) {
      throw new Error("Claim value must be a positive integer.");
    }
    // The nullifier binds the claim once per (wallet, anchor, value).
    const claimNullifier = sha256Hex(
      `solzk-claim-nul:${wallet.address}:${anchorSlot}:${holderCommitment}:${tokens}`,
    );
    const seen = await ctx.db
      .query("feeClaims")
      .withIndex("by_nullifier", (q) => q.eq("claimNullifier", claimNullifier))
      .first();
    if (seen) {
      throw new Error("This claim was already made — nullifier seen.");
    }
    const statement = `feeshare:${anchorSlot}:${anchorRoot}:${holderCommitment}:${tokens}`;
    const expected = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }
    // The witness must be a real note in the pool at (or before) the anchor.
    const note = await ctx.db
      .query("notes")
      .withIndex("by_commitment", (q) => q.eq("commitment", holderCommitment))
      .first();
    if (!note || note.slot > anchorSlot) {
      throw new Error("Witness rejected: commitment not in the pool at the anchor.");
    }

    // Payout: 1% of the claimed value's SOL equivalent, funded by the
    // claims pool — a slice of protocol fees returned to proven holders.
    const poolTokens = state.claimsPoolTokens ?? 0;
    const payoutLamports = Math.floor(
      (tokens * REDEEM_LAMPORTS_PER_TOKEN) / 100,
    );
    const tokensConsumed = Math.ceil(
      payoutLamports / REDEEM_LAMPORTS_PER_TOKEN,
    );
    if (tokensConsumed > poolTokens) {
      throw new Error(
        "The claims pool is exhausted for this claim size — try a smaller claim or wait for fees to accrue.",
      );
    }

    const slot = Math.floor((Date.now() - state.genesisMs) / 400);
    const signature = hexHashOf(
      `claim:${wallet.address}:${Date.now()}:${Math.floor(Math.random() * 0xffffff)}`,
    );

    await ctx.db.insert("feeClaims", {
      walletId: wallet._id,
      anchorSlot,
      anchorRoot,
      holderCommitment,
      claimNullifier,
      tokens,
      paidLamports: payoutLamports,
      signature,
      createdAt: Date.now(),
    });
    await ctx.db.patch(state._id, {
      claimsPoolTokens: poolTokens - tokensConsumed,
    });
    await ctx.db.patch(wallet._id, {
      fundingLamports: wallet.fundingLamports + payoutLamports,
    });

    return { paidLamports: payoutLamports, signature, slot };
  },
});

/** Recent ZK fee-share claims — public feed for the vault page. */
export const listFeeClaims = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return ctx.db
      .query("feeClaims")
      .withIndex("by_created")
      .order("desc")
      .take(limit ?? 10);
  },
});

/** The caller's own claims. */
export const listMyFeeClaims = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUser(ctx, userId);
    if (!wallet) return [];
    const claims = await ctx.db
      .query("feeClaims")
      .withIndex("by_created")
      .order("desc")
      .collect();
    return claims.filter((c) => c.walletId === wallet._id);
  },
});

/**
 * Multi-asset shield, devnet slice: wrap mock SPL assets into the sealed
 * note format. `assetMint` binds the note to an asset (in the full design
 * the note's asset_id is a public input to the join-split circuit). The
 * devnet faucet grants mock units; shield/unshield move them opaquely.
 */
export const shieldAsset = mutation({
  args: {
    symbol: v.string(),
    units: v.number(),
    commitment: v.string(),
    sealedNote: v.object(sealedV2),
    proof: v.string(),
  },
  handler: async (ctx, { symbol, units, commitment, sealedNote, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    const asset = assetBySymbol(symbol);
    if (!asset) throw new Error("Unknown asset symbol.");
    if (!Number.isInteger(units) || units <= 0) {
      throw new Error("Units must be a positive integer.");
    }
    const position = await ctx.db
      .query("assetWallets")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .filter((q) => q.eq(q.field("symbol"), symbol))
      .first();
    if (!position || position.units < units) {
      throw new Error(`Not enough transparent ${symbol} — use the asset faucet first.`);
    }
    if (sealedNote.ciphertext.length !== CIPHERTEXT_B64_LEN) {
      throw new Error("Sealed note ciphertext must be 512 bytes.");
    }
    const statement = `shield:${wallet.address}:${symbol}:${units}:${commitment}`;
    const expected = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
    if (expected !== proof) {
      throw new Error("Proof rejected: it does not commit to these bytes.");
    }

    const slot = Math.floor((Date.now() - state.genesisMs) / 400);
    const signature = hexHashOf(
      `shield:${wallet.address}:${Date.now()}:${Math.floor(Math.random() * 0xffffff)}`,
    );
    await ctx.db.patch(position._id, { units: position.units - units });
    await appendNote(ctx, {
      commitment,
      sealed: sealedNote,
      slot,
      createdAt: Date.now(),
    });
    await ctx.db.insert("assetEvents", {
      kind: "shield",
      symbol,
      units,
      commitment,
      signature,
      slot,
      createdAt: Date.now(),
    });
    return { signature, slot };
  },
});

/** The caller's transparent (unshielded) asset balances. */
export const getMyAssets = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUser(ctx, userId);
    if (!wallet) return [];
    const positions = await ctx.db
      .query("assetWallets")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .collect();
    return positions.map((p) => ({ symbol: p.symbol, units: p.units }));
  },
});

/**
 * Unshield an asset note back to a transparent SPL balance. The exit is
 * necessarily visible on the transparent side (like every reveal) — the
 * ledger sees nullifiers and a credit, never the note history that funded
 * it. In the full design the nullifier proof binds the asset_id.
 */
export const unshieldAsset = mutation({
  args: {
    symbol: v.string(),
    units: v.number(),
    nullifiers: v.array(v.string()),
    ...spendArgs,
    proof: v.string(),
  },
  handler: async (ctx, { symbol, units, nullifiers, inputTotal, change, proof }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const state = await ensureProtocolState(ctx);
    const asset = assetBySymbol(symbol);
    if (!asset) throw new Error("Unknown asset symbol.");
    if (!Number.isInteger(units) || units <= 0) {
      throw new Error("Units must be a positive integer.");
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


    const slot = Math.floor((Date.now() - state.genesisMs) / 400);
    const signature = hexHashOf(
      `unshield:${wallet.address}:${Date.now()}:${Math.floor(Math.random() * 0xffffff)}`,
    );
    await consumeSpend(ctx, { nullifiers, inputTotal, change }, units, `unshield:${wallet.address}:${symbol}:${units}`, proof, slot);
    const position = await ctx.db
      .query("assetWallets")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .filter((q) => q.eq(q.field("symbol"), symbol))
      .first();
    if (position) {
      await ctx.db.patch(position._id, { units: position.units + units });
    } else {
      await ctx.db.insert("assetWallets", {
        walletId: wallet._id,
        symbol,
        units,
        createdAt: Date.now(),
      });
    }
    await ctx.db.insert("assetEvents", {
      kind: "unshield",
      symbol,
      units,
      commitment: "",
      signature,
      slot,
      createdAt: Date.now(),
    });
    return { signature, slot };
  },
});

/** Public asset-flow feed — amounts visible only for shields (auditable in). */
export const listAssetEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return ctx.db
      .query("assetEvents")
      .withIndex("by_created")
      .order("desc")
      .take(limit ?? 15);
  },
});

/** Devnet mock SPL faucet. */
export const assetFaucet = mutation({
  args: { symbol: v.string() },
  handler: async (ctx, { symbol }) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const asset = assetBySymbol(symbol);
    if (!asset) throw new Error("Unknown asset symbol.");
    const position = await ctx.db
      .query("assetWallets")
      .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
      .filter((q) => q.eq(q.field("symbol"), symbol))
      .first();
    if (position) {
      await ctx.db.patch(position._id, {
        units: position.units + asset.faucetGrantUnits,
      });
    } else {
      await ctx.db.insert("assetWallets", {
        walletId: wallet._id,
        symbol,
        units: asset.faucetGrantUnits,
        createdAt: Date.now(),
      });
    }
    return { symbol, units: (position?.units ?? 0) + asset.faucetGrantUnits };  },
});
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

/**
 * v2 viewing-key directory: senders fetch the recipient's published P-256
 * viewing pubkey to seal ECDH notes. Returns null for legacy wallets —
 * callers must fall back to v1 with a visible downgrade warning.
 */
export const getViewPubKey = query({
  args: { address: v.string() },
  handler: async (ctx, { address }) => {
    await protocolStateOrDefault(ctx);
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_address", (q) => q.eq("address", address))
      .first();
    if (!wallet?.viewPubKey) return { address, viewPubKey: null as string | null, v2: false };
    return { address, viewPubKey: wallet.viewPubKey, v2: true };
  },
});
