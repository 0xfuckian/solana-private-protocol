import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { appendNote } from "./merkle";
import { sha256Hex } from "./sha256";
import { spendStatement, validateSpend, type SpendInputs } from "../lib/spend";

const sealedV2 = v.object({ ephemeral: v.string(), nonce: v.string(), ciphertext: v.string(), epk: v.optional(v.string()) });

export const spendArgs = {
  inputTotal: v.number(),
  change: v.optional(v.object({ value: v.number(), commitment: v.string(), sealed: sealedV2 })),
};

export const sealedNoteArgs = sealedV2;

/**
 * Requires that a real Groth16 proof was verified by the node action for this
 * exact statement, then consumes the receipt so it can be used once.
 *
 * Mutations run in the V8 runtime and cannot run a prover, so they never
 * verify anything themselves — and they never accept a fabricated proof
 * string. If no verified receipt exists, the spend is rejected. This is what
 * replaces the old sha256 "proof" placeholder: there is no path in which a
 * value moves without a verified circuit proof.
 */
export async function requireVerifiedProof(ctx: MutationCtx, statement: string, proof: string): Promise<void> {
  const proofHash = sha256Hex(proof);
  const receipt = await ctx.db.query("verifiedProofs").withIndex("by_statement", q => q.eq("statement", statement)).first();
  if (!receipt || receipt.proofHash !== proofHash) {
    throw new Error("Proof rejected: no verified Groth16 proof binds this statement.");
  }
  await ctx.db.delete(receipt._id);
}

/** Called only by the node verifier action, after a proof has been verified. */
export const recordVerifiedProof = internalMutation({
  args: { statement: v.string(), proofHash: v.string(), circuitId: v.string() },
  handler: async (ctx, { statement, proofHash, circuitId }) => {
    const existing = await ctx.db.query("verifiedProofs").withIndex("by_statement", q => q.eq("statement", statement)).first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("verifiedProofs", { statement, proofHash, circuitId, createdAt: Date.now() });
  },
});

/** Applies a spend whose proof has already been verified and recorded. */
export async function consumeSpend(ctx: MutationCtx, spend: SpendInputs, amount: number, domain: string, proof: string, slot: number) {
  validateSpend(spend, amount);
  for (const value of spend.nullifiers) {
    const seen = await ctx.db.query("nullifiers").withIndex("by_value", q => q.eq("value", value)).first();
    if (seen) throw new Error("Nullifier already seen — double spend blocked.");
  }
  await requireVerifiedProof(ctx, spendStatement(domain, spend), proof);
  for (const value of spend.nullifiers) await ctx.db.insert("nullifiers", { value, slot });
  if (spend.change) await appendNote(ctx, { commitment: spend.change.commitment, sealed: spend.change.sealed, slot, createdAt: Date.now() });
}
