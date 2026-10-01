/**
 * S404 — a private ledger that settles on Solana.
 * Protocol constants shared by frontend and backend (pure data, no imports).
 */

export const TICKER = "S404";

/** Total supply: 10% of Solana's ~2.1B circulating SOL base (mirrors E404's 10% of BTC cap). */
export const TOTAL_SUPPLY = 210_000_000;

/** A lot is the unit of minting. */
export const LOT_SIZE = 10_000;

/** Total lots that can ever be minted. */
export const TOTAL_LOTS = TOTAL_SUPPLY / LOT_SIZE; // 21,000

/** Protocol limit for a single mint. */
export const MAX_MINT_PER_TX = 5_000_000; // 500 lots

export const APPROVED_RATE_LAMPORTS = 3_500_000; // 0.0035 SOL per lot
export const OPEN_RATE_LAMPORTS = 10_000_000; // 0.01 SOL per lot

export const APPROVED_MAX_LOTS = 100; // 1,000,000 S404 · 0.35 SOL
export const OPEN_MAX_LOTS = 500; // 5,000,000 S404 · 5 SOL

export const LAMPORTS_PER_SOL = 100_000_000;

/** Slots an invoice payment must confirm for before settlement (≈13s total). */
export const CONFIRMATIONS_REQUIRED = 3;
/** Seconds between simulated slot advances used by the client ticker. */
export const SLOT_SECONDS = 4;
/** Invoice lifetime in seconds. */
export const INVOICE_TTL_SECONDS = 60 * 60;

export const MARKET_FEE_BPS = 200; // 2%

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
  // Map hex chars into base58 deterministically; 44 chars like a real pubkey.
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
  // 64 hex chars derived from the input, deterministic.
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

/** Cap enforcement is done server-side too; this is the display helper. */
export function lotsRemainingFor(tier: RateTier, lotsUsed: number): number {
  return Math.max(0, RATE_TIERS[tier].maxLots - lotsUsed);
}
