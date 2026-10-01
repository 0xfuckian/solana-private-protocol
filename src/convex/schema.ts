import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const sealedNote = v.object({
  ephemeral: v.string(),
  nonce: v.string(),
  ciphertext: v.string(),
});

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
    }).index("email", ["email"]),

    // ---- SOL-ZK protocol ---------------------------------------------------

    // Singleton: key === "global"
    protocolState: defineTable({
      key: v.literal("global"),
      ticker: v.string(),
      totalSupply: v.number(),
      lotSize: v.number(),
      mintedTokens: v.number(),
      mintOpen: v.boolean(),
      marketOpen: v.boolean(),
      genesisMs: v.number(),
      // The protocol's half of every fee (mint + market).
      treasuryLamports: v.number(),
      // 95% of every mint, held inside the vault as protocol liquidity and
      // backstopping withdrawals.
      liquidityLamports: v.number(),
      liquiditySeeded: v.optional(v.boolean()),
    }).index("by_key", ["key"]),

    // One shielded wallet per app account. The address is the public shielded
    // address; fundingLamports is the ordinary (unshielded) SOL balance used
    // to pay for mints and market fills.
    wallets: defineTable({
      userId: v.id("users"),
      address: v.string(),
      fundingLamports: v.number(),
      faucetTotalLamports: v.number(),
      lotsMinted: v.number(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_address", ["address"])
      .index("by_creation", ["createdAt"]),

    // Mint invoices. A one-time deposit address belongs to exactly one
    // invoice — that is how the node knows the payment was yours.
    invoices: defineTable({
      walletId: v.id("wallets"),
      lots: v.number(),
      lamports: v.number(),
      tier: v.string(), // "approved" | "open"
      commitment: v.string(),
      noteR: v.string(), // note randomness — needed to resume an interrupted mint
      depositAddress: v.string(),
      status: v.string(), // "awaiting_payment" | "seen" | "minted"
      signature: v.optional(v.string()),
      paidAt: v.optional(v.number()),
      createdAt: v.number(),
      expiresAt: v.number(),
      envelopeId: v.optional(v.id("envelopes")),
    })
      .index("by_wallet", ["walletId"])
      .index("by_deposit_address", ["depositAddress"]),

    // Published envelopes — the only thing the "chain" ever sees. The payload
    // is an opaque byte string; the proof commits to every byte of it.
    envelopes: defineTable({
      kind: v.string(), // "mint" | "transfer"
      signature: v.string(),
      slot: v.number(),
      payloadSize: v.number(),
      feeLamports: v.number(),
      payload: v.string(),
      proof: v.string(),
      invoiceId: v.optional(v.id("invoices")),
      tradeId: v.optional(v.id("trades")),
      createdAt: v.number(),
    })
      .index("by_signature", ["signature"])
      .index("by_created", ["createdAt"]),

    // Sealed notes. The ledger stores commitments and ciphertexts only —
    // ownership is established by trial-decrypting in the owner's browser.
    notes: defineTable({
      commitment: v.string(),
      sealed: sealedNote,
      slot: v.number(),
      createdAt: v.number(),
    }).index("by_commitment", ["commitment"]),

    // Published nullifiers. Spending publishes one; uniqueness here is what
    // prevents double-spends without linking the spend to any commitment.
    nullifiers: defineTable({
      value: v.string(),
      slot: v.number(),
    }).index("by_value", ["value"]),

    // Signed limit orders — intents, not deposits.
    orders: defineTable({
      makerWalletId: v.id("wallets"),
      side: v.string(), // "buy" | "sell"
      priceLamportsPerKilo: v.number(), // lamports per 1,000 SOLZK
      amountTokens: v.number(),
      filledTokens: v.number(),
      status: v.string(), // "open" | "filled" | "cancelled"
      createdAt: v.number(),
    })
      .index("by_status", ["status"])
      .index("by_maker", ["makerWalletId"]),

    // The vault works like a liquidity pool: depositors provide SOLZK
    // (from mints, trades and transfers), the pool's 95% mint liquidity and
    // transaction fees are distributed pro rata, and withdrawal routes
    // through the pool back to notes.
    vaultDeposits: defineTable({
      walletId: v.id("wallets"),
      // Weighted shares of the pool (mint liquidity + deposits + fee pool).
      shares: v.number(),
      depositedTokens: v.number(),
      lamportsIn: v.number(),
      accumulatedFees: v.number(),
      lastClaimAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_wallet", ["walletId"]),

    // Global vault accounting: pool size, fee pool, share supply.
    vaultPool: defineTable({
      key: v.literal("global"),
      // Total SOLZK deposited by users (their claim on the pool).
      depositedTokens: v.number(),
      // Total share supply outstanding.
      totalShares: v.number(),
      // Fee pool awaiting distribution (lamports, from mint + trade fees).
      feePoolLamports: v.number(),
      feesDistributedLamports: v.number(),
      // Cumulative fees per share, fixed-point 1e12 — pro-rata payout base.
      feePerShare: v.number(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // The vault (launchpad): shielded tokens anyone can deploy.
    vaultTokens: defineTable({
      ticker: v.string(),
      name: v.string(),
      maxSupply: v.number(),
      mintedTokens: v.number(),
      priceLamportsPerKilo: v.number(),
      mintOpen: v.boolean(),
      creator: v.string(),
      createdAt: v.number(),
      holders: v.number(),
    }).index("by_ticker", ["ticker"]),

    vaultBalances: defineTable({
      tokenId: v.id("vaultTokens"),
      walletId: v.id("wallets"),
      amount: v.number(),
    }).index("by_wallet_token", ["walletId", "tokenId"]),

    // Pre-launch whitelist applications. The founder reviews these manually:
    // follow + repost the X announcement, then paste the post link + wallet.
    // An "approved" application is what grants the approved mint rate —
    // matched by pasted wallet address or by the submitting account.
    whitelistApplications: defineTable({
      walletAddress: v.string(),
      xHandle: v.string(),
      postLink: v.string(),
      userId: v.optional(v.id("users")),
      status: v.string(), // "pending" | "approved" | "rejected"
      createdAt: v.number(),
      reviewedAt: v.optional(v.number()),
    })
      .index("by_wallet", ["walletAddress"])
      .index("by_status", ["status"])
      .index("by_user", ["userId"]),

    // Trades: SOL leg is escrowed at fill; the shielded leg settles from the
    // seller's browser, which alone can spend its notes.
    trades: defineTable({
      buyOrderId: v.optional(v.id("orders")),
      sellOrderId: v.optional(v.id("orders")),
      buyerWalletId: v.id("wallets"),
      sellerWalletId: v.id("wallets"),
      tokens: v.number(),
      lamports: v.number(), // gross SOL leg, escrowed at fill
      feeLamports: v.number(),
      status: v.string(), // "pending_settlement" | "settled"
      shieldedEnvelopeId: v.optional(v.id("envelopes")),
      createdAt: v.number(),
    })
      .index("by_seller", ["sellerWalletId"])
      .index("by_buyer", ["buyerWalletId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
