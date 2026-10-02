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

    payrollBatches: defineTable({ walletId: v.id("wallets"), recipients: v.number(), totalTokens: v.number(), feeTokens: v.number(), slot: v.number(), createdAt: v.number() }).index("by_wallet", ["walletId"]),
    stakingPool: defineTable({ key: v.literal("global"), totalStaked: v.number(), rewardTokens: v.number(), rewardsPaid: v.number(), rewardIndex: v.string() }).index("by_key", ["key"]),
    stakingPositions: defineTable({ walletId: v.id("wallets"), amount: v.number(), lockedUntil: v.number(), rewardCheckpoint: v.string(), pendingRewardScaled: v.string(), createdAt: v.number() }).index("by_wallet", ["walletId"]),
    transferUsage: defineTable({ walletId: v.id("wallets"), day: v.number(), valueUnits: v.number() }).index("by_wallet_day", ["walletId", "day"]),
    operationEvents: defineTable({ userId: v.id("users"), kind: v.string(), createdAt: v.number() }).index("by_created", ["createdAt"]),
    merkleState: defineTable({ key: v.literal("global"), nextIndex: v.number(), root: v.string() }).index("by_key", ["key"]),
    merkleTreeNodes: defineTable({ level: v.number(), index: v.number(), hash: v.string() }).index("by_position", ["level", "index"]),
    merkleRoots: defineTable({ root: v.string(), leafCount: v.number(), slot: v.number(), createdAt: v.number() }).index("by_created", ["createdAt"]).index("by_root", ["root"]),

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
      treasuryTokens: v.optional(v.number()),
      vaultFeeTokens: v.optional(v.number()),
      // 95% of every mint, held inside the vault as protocol liquidity and
      // backstopping withdrawals.
      liquidityLamports: v.number(),
      liquiditySeeded: v.optional(v.boolean()),
      // Cumulative supply burned: keeper buybacks of treasury fees, user
      // tier burns, and exit redemptions. Effective supply = total − burned.
      burnedTokens: v.optional(v.number()),
      // Public relayer fee vault: flat in-note fees from fee-in-note
      // transfers (the note pays the relayer, not the sender).
      relayerFeesTokens: v.optional(v.number()),
      lastBuybackAt: v.optional(v.number()),
      // Private swap reserves (x·y = k): SOL on one side, SOLZK on the other.
      swapSolReserve: v.optional(v.number()),
      swapTokenReserve: v.optional(v.number()),
      // ZK fee-share claims: global fee anchor checkpoint (monotonic).
      lastAnchorAt: v.optional(v.number()),
      totalFeePoolCheckpoint: v.optional(v.number()),
      claimsPoolTokens: v.optional(v.number()),
      // Pre-launch phase control: while false, the whitelist application
      // page is the only page the site serves. The founder flips it.
      whitelistOpen: v.optional(v.boolean()),
      emergencyPaused: v.optional(v.boolean()),
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
      // Cumulative tokens this wallet has burned for its fee-discount tier.
      burnedTokens: v.optional(v.number()),
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
      feeTokens: v.optional(v.number()),
      feeDenomination: v.optional(v.string()),
      payload: v.string(),
      proof: v.string(),
      invoiceId: v.optional(v.id("invoices")),
      tradeId: v.optional(v.id("trades")),
      // True when the transfer paid its relayer from the note itself
      // (fee-in-note) instead of the sender's SOL balance.
      feeInNote: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("by_signature", ["signature"])
      .index("by_slot", ["slot"])
      .index("by_created", ["createdAt"]),

    // Sealed notes. The ledger stores commitments and ciphertexts only —
    // ownership is established by trial-decrypting in the owner's browser.
    notes: defineTable({
      leafIndex: v.optional(v.number()),
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
      rewardCheckpoint: v.optional(v.string()),
      pendingRewardScaled: v.optional(v.string()),
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
      rewardIndex: v.optional(v.string()),
      unallocatedLamports: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

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

    // Public supply burns. Three kinds:
    //  - "buyback": the keeper sweeps the treasury fee vault, buys SOLZK
    //    from protocol liquidity and burns it (deflationary fee sink).
    //  - "tier": a user burns tokens to unlock a permanent fee discount.
    //  - "redeem": an exit — tokens burn against the 95% liquidity reserve.
    burnEvents: defineTable({
      kind: v.string(), // "buyback" | "tier" | "redeem"
      tokensBurned: v.number(),
      lamportsSpent: v.number(), // treasury/liquidity spent (buyback) or SOL paid out (redeem)
      signature: v.string(),
      slot: v.number(),
      createdAt: v.number(),
    }).index("by_created", ["createdAt"]),

    // Association-set registry: public, self-asserted labels for shielded
    // addresses ("this address belongs to Exchange X"). Resolving a payee's
    // label at send time breaks the same-address heuristic without ever
    // linking balances — the ASP slice of the protocol design.
    aspLabels: defineTable({
      address: v.string(),
      label: v.string(),
      createdAt: v.number(),
    })
      .index("by_address", ["address"])
      .index("by_label", ["label"]),

    // Transparent (unshielded) devnet mock SPL balances, per wallet.
    assetWallets: defineTable({
      walletId: v.id("wallets"),
      symbol: v.string(),
      units: v.number(),
      createdAt: v.number(),
    }).index("by_wallet", ["walletId"]),

    // ZK fee-share claims: a wallet proves it held value at a past anchor
    // (the join-split statement signed into the claim's nullifier) without
    // revealing balance or identity. Payouts come from the claims pool.
    feeClaims: defineTable({
      walletId: v.id("wallets"),
      anchorSlot: v.number(),
      anchorRoot: v.string(),
      holderCommitment: v.string(),
      claimNullifier: v.string(),
      tokens: v.number(), // claim size: value held at the anchor
      paidLamports: v.number(),
      signature: v.string(),
      createdAt: v.number(),
    })
      .index("by_nullifier", ["claimNullifier"])
      .index("by_holder", ["holderCommitment"])
      .index("by_created", ["createdAt"]),

    // Private swap ledger: reserves live on protocolState, this is the
    // public record — every swap burns a nullifier and seals output notes.
    swapEvents: defineTable({
      direction: v.string(), // "sol_to_tokens" | "tokens_to_sol"
      solLamportsIn: v.number(),
      solLamportsOut: v.number(),
      tokensIn: v.number(),
      tokensOut: v.number(),
      feeLamports: v.number(),
      solReserve: v.number(), // reserves after the swap
      tokenReserve: v.number(),
      signature: v.string(),
      slot: v.number(),
      createdAt: v.number(),
    }).index("by_created", ["createdAt"]),

    // Multi-asset shield events: opaque asset flows — a shield, an unshield,
    // or a private transfer of an asset note. Amounts stay hidden.
    assetEvents: defineTable({
      kind: v.string(), // "shield" | "unshield" | "transfer"
      symbol: v.string(),
      units: v.number(), // public only for shield (deposits are auditable)
      commitment: v.string(),
      signature: v.string(),
      slot: v.number(),
      createdAt: v.number(),
    })
      .index("by_created", ["createdAt"])
      .index("by_symbol", ["symbol"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
