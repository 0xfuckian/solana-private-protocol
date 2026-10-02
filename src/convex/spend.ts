import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { appendNote } from "./merkle";
import { sha256Hex } from "./sha256";
import { spendStatement, validateSpend, type SpendInputs } from "../lib/spend";

const sealedV2 = v.object({ ephemeral: v.string(), nonce: v.string(), ciphertext: v.string(), epk: v.optional(v.string()) });

export const spendArgs = {
  inputTotal: v.number(),
  change: v.optional(v.object({ value: v.number(), commitment: v.string(), sealed: sealedV2 })),
};

export const sealedNoteArgs = sealedV2;

/** Simulation only: checks declared arithmetic and permanent replay, not ownership. */
export async function consumeSpend(ctx: MutationCtx, spend: SpendInputs, amount: number, domain: string, proof: string, slot: number) {
  validateSpend(spend, amount);
  const expected = sha256Hex(sha256Hex(spendStatement(domain, spend)) + "solzk-circuit-v1");
  if (expected !== proof) throw new Error("Proof rejected: spend statement mismatch.");
  for (const value of spend.nullifiers) {
    const seen = await ctx.db.query("nullifiers").withIndex("by_value", q => q.eq("value", value)).first();
    if (seen) throw new Error("Nullifier already seen — double spend blocked.");
  }
  for (const value of spend.nullifiers) await ctx.db.insert("nullifiers", { value, slot });
  if (spend.change) await appendNote(ctx, { commitment: spend.change.commitment, sealed: spend.change.sealed, slot, createdAt: Date.now() });
}
