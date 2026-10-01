/**
 * SOL-ZK — a private ledger that settles on Solana.
 * Protocol constants shared by frontend and backend (pure data, no imports).
 */

export const SITE_NAME = "SOL-ZK";
export const TICKER = "SOLZK";

/** Total supply: 10% of Solana's ~2.1B circulating SOL base. */
export const TOTAL_SUPPLY = 210_000_000;

/** A lot is the unit of minting. */
export const LOT_SIZE = 10_000;

/** Total lots that can ever be minted. */
export const TOTAL_LOTS = TOTAL_SUPPLY / LOT_SIZE; // 21,000

/** Protocol limit for a single mint. */
export const MAX_MINT_PER_TX = 5_000_000; // 500 lots

/**
 * Pricing, matched to the reference site's structure: the approved rate is a
 * third of the open rate.
 */
export const APPROVED_RATE_LAMPORTS = 1_000_000; // 0.001 SOL per lot
export const OPEN_RATE_LAMPORTS = 3_000_000; // 0.003 SOL per lot

export const APPROVED_MAX_LOTS = 100; // 1,000,000 SOLZK · 0.1 SOL
export const OPEN_MAX_LOTS = 500; // 5,000,000 SOLZK · 1.5 SOL

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
