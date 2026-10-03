/**
 * Kilnen ZK primitives — pure JS, shared by the browser and the Convex node
 * runtime, and byte-for-byte consistent with `circuits/kilnen-spend.circom`.
 *
 *   commitment  C  = Poseidon4(value, assetId, rField, ownerField)
 *   nullifier   nf = Poseidon2(C, spendKeyField)
 *   tree parent     = Poseidon2(left, right)   (depth TREE_DEPTH)
 *
 * Strings (blinding nonces `r`, owner addresses, spend keys) are mapped into
 * the scalar field by fold-hashing their UTF-8 bytes with Poseidon, so two
 * different strings cannot collide into the same field element. `value` stays
 * an integer token amount. These are the relations the circuit enforces; the
 * ledger must never accept a commitment it cannot open.
 */
import { poseidon2, poseidon4 } from "poseidon-lite";

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Must equal the circuit's DEPTH and convex/merkle.ts TREE_DEPTH. */
export const TREE_DEPTH = 20;

const encoder = new TextEncoder();
const CHUNK = 31; // bytes that always fit in one field element

/** Fold-hash a string into Fr with Poseidon (collision-resistant, pure JS). */
export function fieldFromString(input: string): bigint {
  const bytes = encoder.encode(input);
  let h = 0n;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    let chunk = 0n;
    for (const b of bytes.subarray(i, i + CHUNK)) chunk = (chunk << 8n) | BigInt(b);
    h = poseidon2([h, chunk]);
  }
  return h;
}

export function fieldFromHex(hex: string): bigint {
  return BigInt("0x" + hex) % FIELD;
}

/** Asset domain: 0 = native KLN; 1..3 = shielded SPL assets (see SHIELDED_ASSETS). */
export function assetIdFor(symbol: string): number {
  const map: Record<string, number> = { SOLZK: 0, KLN: 0, USDC: 1, BONK: 2, JUP: 3 };
  return map[symbol] ?? 0;
}

export function commitmentField(
  value: number,
  assetId: number,
  rField: bigint,
  ownerField: bigint,
): bigint {
  return poseidon4([BigInt(value), BigInt(assetId), rField, ownerField]);
}

/** Commitment as a decimal field string (the on-ledger leaf format). */
export function commitmentFor(
  value: number,
  r: string,
  owner: string,
  assetId = 0,
): string {
  return commitmentField(value, assetId, fieldFromString(r), fieldFromString(owner)).toString();
}

/** Spend key as a scalar. `spendKeyHex` is the wallet's derived 32-byte key. */
export function spendKeyField(spendKeyHex: string): bigint {
  return fieldFromString("spend-key:" + spendKeyHex);
}

export function nullifierFor(commitment: string, spendKeyHex: string): string {
  return poseidon2([BigInt(commitment), spendKeyField(spendKeyHex)]).toString();
}

// ---------------------------------------------------------------------------
// Merkle tree (placeholders, matching convex/merkle.ts exactly)
// ---------------------------------------------------------------------------

export const hashPair = (left: string, right: string): string =>
  poseidon2([BigInt(left), BigInt(right)]).toString();

export const ZEROES: string[] = ["0"];
for (let i = 0; i < TREE_DEPTH; i++) ZEROES.push(hashPair(ZEROES[i], ZEROES[i]));

export const EMPTY_ROOT = ZEROES[TREE_DEPTH];

/** A leaf must be a decimal field string (what commitmentFor returns). */
export function assertFieldString(value: string, label = "Commitment"): void {
  if (!/^\d+$/.test(value) || BigInt(value) >= FIELD) {
    throw new Error(`${label} must be a decimal field element.`);
  }
}
