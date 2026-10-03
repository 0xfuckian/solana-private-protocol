/**
 * Kilnen — a private ledger that settles on Solana.
 * Protocol constants shared by frontend and backend (pure data, no imports).
 *
 * NOTE: brand strings (SITE_NAME, TICKER) are display-only. Never rename the
 * `solzk-*` hash domain separators, the `SOLZK|` envelope wire prefix, or the
 * `solzk.*` storage keys — those are committed into hashes and stored data,
 * so changing them would silently invalidate existing notes and links.
 */

import { assertUnits, mulDivFloor } from "./safety";

/** Solana lamports per SOL. */
export const SOLANA_LAMPORTS_PER_SOL = 1_000_000_000;

export const SITE_NAME = "Kilnen";
export const TICKER = "KLN";

/** Total supply: 10% of Solana's ~2.1B circulating SOL base. */
export const TOTAL_SUPPLY = 210_000_000;

/** A lot is the unit of minting. */
export const LOT_SIZE = 10_000;

/** Total lots that can ever be minted. */
export const TOTAL_LOTS = TOTAL_SUPPLY / LOT_SIZE; // 21,000

/** Protocol limit for a single mint. */
export const MAX_MINT_PER_TX = 10_000_000; // 1,000 lots

/**
 * Pricing: approved 0.015 SOL per lot, open 0.035 SOL per lot.
 */
export const APPROVED_RATE_LAMPORTS = 1_500_000; // 0.015 SOL per lot
export const OPEN_RATE_LAMPORTS = 3_500_000; // 0.035 SOL per lot

export const APPROVED_MAX_LOTS = 100; // 1,000,000 SOLZK · 1.5 SOL
export const OPEN_MAX_LOTS = 1_000; // 10,000,000 SOLZK · 35 SOL

export const LAMPORTS_PER_SOL = 100_000_000;

/**
 * Fees.
 *  - Mint: 5% of the mint price. Half (2.5%) funds the vault fee pool, which
 *    pays vault depositors exactly like transaction fees pay liquidity
 *    providers; the other half (2.5%) goes to the treasury. The remaining
 *    95% of every mint is reserved as protocol liquidity inside the vault.
 *  - Market: 2% on every trade. Half to the vault fee pool, half treasury.
 */
export const MINT_FEE_BPS = 500; // 5% of mint price
export const MARKET_FEE_BPS = 200; // 2% per trade
export const FEE_TO_VAULT_BPS = 5_000; // half of every fee → vault depositors
export const RELAYER_FEE_LAMPORTS = 5_000; // flat network-fee reimbursement

/** Slots an invoice payment must confirm for before settlement (≈13s total). */
export const CONFIRMATIONS_REQUIRED = 3;
/** Seconds between slot advances used by the client ticker. */
export const SLOT_SECONDS = 4;
/** Invoice lifetime in seconds. */
export const INVOICE_TTL_SECONDS = 60 * 60;

/** Length of a shielded address / one-time deposit address. */
export const ADDRESS_LEN = 44;

export type RateTier = "approved" | "open";

export const RATE_TIERS: Record<
  RateTier,
  { label: string; perLotLamports: number; maxLots: number }
> = {
  approved: {
    label: "Approved",
    perLotLamports: APPROVED_RATE_LAMPORTS,
    maxLots: APPROVED_MAX_LOTS,
  },
  open: {
    label: "Open",
    perLotLamports: OPEN_RATE_LAMPORTS,
    maxLots: OPEN_MAX_LOTS,
  },
};

// ---------- formatting ----------

export function lamportsToSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol === 0) return "0";
  if (sol < 0.001) return sol.toFixed(6);
  if (Number.isInteger(sol)) return sol.toLocaleString("en-US");
  return sol.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export function formatTokenAmount(n: number): string {
  return n.toLocaleString("en-US");
}

export function shortAddress(addr: string, head = 4, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function shortHash(hash: string, head = 8, tail = 6): string {
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Deterministic pseudo-random base58 string of given length. */
const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function pseudoBase58(len: number, seedFn: () => number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += B58_ALPHABET[Math.floor(seedFn() * B58_ALPHABET.length)];
  }
  return out;
}

/** A realistic-looking 44-char Solana address derived from a hex string. */
export function addressFromHex(hex: string): string {
  let out = "";
  for (let i = 0; i < 44; i++) {
    const c = hex[(i * 7 + 3) % hex.length];
    const idx = parseInt(c, 16) + parseInt(hex[(i * 3 + 1) % hex.length], 16);
    out += B58_ALPHABET[idx % B58_ALPHABET.length];
  }
  return out;
}

/** 64-hex-char signature style hash. */
export function hashFromHex(hex: string): string {
  let out = "";
  for (let i = 0; i < 64; i++) {
    out += hex[(i * 5 + 2) % hex.length];
  }
  return out;
}

export function hexHashOf(input: string): string {
  let h1 = 0x9e3779b9;
  let h2 = 0x85ebca6b;
  let out = "";
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = (h1 ^ c) * 0x1000193;
      h1 >>>= 0;
      h2 = (h2 + c * (i + round + 1)) * 0x27d4eb2d;
      h2 >>>= 0;
    }
    out += (h1 >>> 0).toString(16).padStart(8, "0");
    out += (h2 >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

/** Uniform envelope sizes: every transfer is 921 bytes, a mint 934. */
export const ENVELOPE_TRANSFER_BYTES = 921;
export const ENVELOPE_MINT_BYTES = 934;

// ---------- pricing ----------

export function lotPriceLamports(tier: RateTier, lots: number): number {
  return RATE_TIERS[tier].perLotLamports * lots;
}

/** 5% mint fee, split half to the vault fee pool, half to the treasury. */
export function mintFeeSplit(lamports: number): {
  fee: number;
  vaultCut: number;
  treasuryCut: number;
  liquidity: number;
} {
  const fee = Math.ceil((lamports * MINT_FEE_BPS) / 10_000);
  const vaultCut = Math.ceil(fee / 2);
  const treasuryCut = fee - vaultCut;
  return { fee, vaultCut, treasuryCut, liquidity: lamports - fee };
}

/** 2% market fee, split half to the vault fee pool, half to the treasury. */
export function marketFeeSplit(fee: number): {
  vaultCut: number;
  treasuryCut: number;
} {
  const vaultCut = Math.ceil(fee / 2);
  return { vaultCut, treasuryCut: fee - vaultCut };
}

/** Cap enforcement is done server-side too; this is the display helper. */
export function lotsRemainingFor(tier: RateTier, lotsUsed: number): number {
  return Math.max(0, RATE_TIERS[tier].maxLots - lotsUsed);
}

/** Single-mint cap in lots, derived from MAX_MINT_PER_TX. */
export const MAX_LOTS_PER_TX = MAX_MINT_PER_TX / LOT_SIZE; // 1,000

// ---------------------------------------------------------------------------
// Fee-in-note relayer
// ---------------------------------------------------------------------------

/**
 * Flat relayer fee for fee-in-note transfers, paid in SOLZK out of the spent
 * value. With fee-in-note the sender needs no SOL at all: the note
 * itself pays the relayer, and the protocol covers the chain fee from the
 * vault — the mechanism that makes a wallet with zero SOL still spendable.
 */
export const RELAYER_FEE_NOTE_TOKENS = 25;

// ---------------------------------------------------------------------------
// Burn-to-discount fee tiers
// ---------------------------------------------------------------------------

/** Burning SOLZK sets a public fee tier — a permanent discount on transfer fees. */
export interface DiscountTier {
  label: string;
  minBurned: number;
  discountBps: number;
}

export const DISCOUNT_TIERS: DiscountTier[] = [
  { label: "Obsidian", minBurned: 100_000, discountBps: 7_500 },
  { label: "Onyx", minBurned: 10_000, discountBps: 5_000 },
  { label: "Ember", minBurned: 1_000, discountBps: 2_500 },
  { label: "Standard", minBurned: 0, discountBps: 0 },
];

/** The highest tier the caller has unlocked (cumulative burned tokens). */
export function discountTierForBurned(burned: number): DiscountTier {
  for (const t of DISCOUNT_TIERS) {
    if (burned >= t.minBurned) return t;
  }
  return DISCOUNT_TIERS[DISCOUNT_TIERS.length - 1];
}

/** The next tier above the caller's current one, or null at the top. */
export function nextDiscountTier(burned: number): DiscountTier | null {
  const idx = DISCOUNT_TIERS.findIndex((t) => burned >= t.minBurned);
  return idx > 0 ? DISCOUNT_TIERS[idx - 1] : null;
}

/** Transfer fee in tokens at a given discount tier. */
export function transferFeeTokens(amount: number, discountBps: number, baseFeeBps = MARKET_FEE_BPS): number {
  assertUnits(amount);
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10_000 || !Number.isInteger(baseFeeBps) || baseFeeBps < 0 || baseFeeBps > 10_000) throw new Error("Invalid fee basis points.");
  const numerator = BigInt(amount) * BigInt(baseFeeBps) * BigInt(10_000 - discountBps);
  return Number((numerator + 99_999_999n) / 100_000_000n);
}

/** Supply that still exists after keeper buybacks, tier burns and exits. */
export function effectiveSupply(
  totalSupply: number,
  burnedTokens: number,
): number {
  return Math.max(0, totalSupply - burnedTokens);
}

// ---------------------------------------------------------------------------
// Redeem — the private exit (private swap of SOLZK for SOL)
// ---------------------------------------------------------------------------

/**
 * Exit rate: tokens burn against protocol liquidity at the open mint rate.
 * Every redemption is deflationary — the tokens are burned, the SOL leaves
 * the 95% liquidity reserve, and the ledger sees only a burn plus a payout.
 */
export const REDEEM_LAMPORTS_PER_TOKEN = Math.floor(
  OPEN_RATE_LAMPORTS / LOT_SIZE,
);

// ---------------------------------------------------------------------------
// Pay links — payment requests encoded in the URL #fragment
// ---------------------------------------------------------------------------

/**
 * A pay link carries { to, amount, memo } in the URL fragment, which never
 * reaches a server. Format mirrors the envelope: a versioned prefix plus
 * base64url JSON, so a link is self-describing and forward-compatible.
 */
export const PAY_LINK_PREFIX = "SOLZK-PAY|v1|";

export interface PayLinkPayload {
  to: string;
  amount: number;
  memo?: string;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(s: string): Uint8Array {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean.length % 4 === 0 ? "" : "=".repeat(4 - (clean.length % 4));
  const bin = atob(clean + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let payEncoder: TextEncoder | null = null;
let payDecoder: TextDecoder | null = null;

export function encodePayLink(p: PayLinkPayload): string {
  payEncoder ??= new TextEncoder();
  const json = JSON.stringify({ t: p.to, a: p.amount, m: p.memo ?? "" });
  return PAY_LINK_PREFIX + bytesToB64Url(payEncoder.encode(json));
}

export function decodePayLink(fragment: string): PayLinkPayload | null {
  try {
    payDecoder ??= new TextDecoder();
    const raw = fragment.trim();
    if (!raw.startsWith(PAY_LINK_PREFIX)) return null;
    const json = payDecoder.decode(
      b64UrlToBytes(raw.slice(PAY_LINK_PREFIX.length)),
    );
    const obj = JSON.parse(json) as { t?: string; a?: number; m?: string };
    if (typeof obj.t !== "string" || obj.t.length !== ADDRESS_LEN) return null;
    if (typeof obj.a !== "number" || !Number.isSafeInteger(obj.a) || obj.a <= 0)
      return null;
    return {
      to: obj.t,
      amount: obj.a,
      memo: typeof obj.m === "string" && obj.m ? obj.m : undefined,
    };
  } catch {
    return null;
  }
}

export function payLinkUrl(p: PayLinkPayload): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/pay#${encodePayLink(p)}`;
}

// ---------------------------------------------------------------------------
// Private swap — constant-product AMM over protocol-owned reserves
// ---------------------------------------------------------------------------

/**
 * The swap fee, taken in SOL on both legs. It routes exactly like every
 * other protocol fee: half to the vault fee pool, half to the treasury.
 */
export const SWAP_FEE_BPS = 30; // 0.3%
export const MIN_SWAP_LAMPORTS = 100_000; // 0.0001 SOL
export const MIN_SWAP_TOKENS = 1_000;

export interface SwapQuote {
  outAmount: number;
  feeLamports: number;
  /** SOL per token before the trade. */
  midPriceLamportsPerToken: number;
  /** SOL per token actually received (after fee + slippage). */
  effectivePriceLamportsPerToken: number;
  priceImpactPct: number;
}

/** SOL → SOLZK quote against the current reserves (x·y = k). */
export function quoteSwapSolForTokens(
  solLamportsIn: number,
  solReserve: number,
  tokenReserve: number,
): SwapQuote | null {
  if (![solLamportsIn, solReserve, tokenReserve, solReserve + solLamportsIn].every(Number.isSafeInteger) || solLamportsIn <= 0 || solReserve <= 0 || tokenReserve <= 0) return null;
  const feeLamports = Math.ceil((solLamportsIn * SWAP_FEE_BPS) / 10_000);
  const netIn = solLamportsIn - feeLamports;
  const tokensOut = mulDivFloor(tokenReserve, netIn, solReserve + netIn);
  if (tokensOut <= 0) return null;
  const mid = solReserve / tokenReserve;
  const eff = solLamportsIn / tokensOut;
  return {
    outAmount: tokensOut,
    feeLamports,
    midPriceLamportsPerToken: mid,
    effectivePriceLamportsPerToken: eff,
    priceImpactPct: Math.max(0, (eff / mid - 1) * 100),
  };
}

/** SOLZK → SOL quote against the current reserves. */
export function quoteSwapTokensForSol(
  tokensIn: number,
  solReserve: number,
  tokenReserve: number,
): SwapQuote | null {
  if (![tokensIn, solReserve, tokenReserve, tokenReserve + tokensIn].every(Number.isSafeInteger) || tokensIn <= 0 || solReserve <= 0 || tokenReserve <= 0) return null;
  const grossSolOut = mulDivFloor(solReserve, tokensIn, tokenReserve + tokensIn);
  if (grossSolOut <= 0) return null;
  const feeLamports = Math.ceil((grossSolOut * SWAP_FEE_BPS) / 10_000);
  const lamportsOut = grossSolOut - feeLamports;
  if (lamportsOut <= 0) return null;
  const mid = solReserve / tokenReserve;
  const eff = lamportsOut / tokensIn;
  return {
    outAmount: lamportsOut,
    feeLamports,
    midPriceLamportsPerToken: mid,
    effectivePriceLamportsPerToken: eff,
    priceImpactPct: Math.max(0, (1 - eff / mid) * 100),
  };
}

// ---------------------------------------------------------------------------
// Multi-asset shield — wrap any SPL asset into the sealed-note format
// ---------------------------------------------------------------------------

export interface ShieldedAsset {
  symbol: string;
  name: string;
  /** Mainnet SPL mint address. */
  mint: string;
  decimals: number;
  /** Reference price: lamports per raw unit, for fee math and display. */
  lamportsPerUnit: number;
}

export const SHIELDED_ASSETS: ShieldedAsset[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    lamportsPerUnit: 1,
  },
  {
    symbol: "BONK",
    name: "Bonk",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 3,
    lamportsPerUnit: 1,
  },
  {
    symbol: "JUP",
    name: "Jupiter",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
    lamportsPerUnit: 40,
  },
];

export function assetBySymbol(symbol: string): ShieldedAsset | null {
  return SHIELDED_ASSETS.find((a) => a.symbol === symbol) ?? null;
}

/** SOL-equivalent value of an asset amount (reference pricing). */
export function assetLamportsValue(symbol: string, units: number): number {
  const asset = assetBySymbol(symbol);
  if (!asset) return 0;
  return Math.floor(units * asset.lamportsPerUnit);
}

/** Human format: raw units → decimal units with the symbol. */
export function formatAssetUnits(symbol: string, units: number): string {
  const asset = assetBySymbol(symbol);
  const decimals = asset?.decimals ?? 0;
  const value = units / 10 ** decimals;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: decimals })} ${symbol}`;
}
