import type { MutationCtx } from "./_generated/server";
import { sha256Hex } from "./sha256";

/**
 * TEST-ONLY. In production, `convex/groth16.ts` verifies a real Groth16 proof
 * and calls `internal.spend.recordVerifiedProof`. Tests cannot run a prover,
 * so they fabricate the receipt that verification would have produced. This
 * does not exist on any public API surface — it is only imported by tests.
 */
export function testProof(statement: string): string {
  return "test-groth16:" + statement;
}

export async function recordTestProof(
  ctx: MutationCtx,
  statement: string,
  proof: string = testProof(statement),
): Promise<string> {
  const proofHash = sha256Hex(proof);
  const existing = await ctx.db
    .query("verifiedProofs")
    .withIndex("by_statement", (q) => q.eq("statement", statement))
    .first();
  if (existing) await ctx.db.delete(existing._id);
  await ctx.db.insert("verifiedProofs", { statement, proofHash, circuitId: "test", createdAt: Date.now() });
  return proof;
}
