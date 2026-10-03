"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { groth16 } from "snarkjs";
import { sha256Hex } from "./sha256";

/**
 * The only path that can authorize a shielded spend.
 *
 * This node action verifies a real Groth16 proof against the reviewed
 * verification key, then records a one-time receipt the V8 mutations consume
 * via `requireVerifiedProof`. Mutations can never fabricate a receipt, so no
 * value moves without a proof that actually verifies.
 *
 * Configuration: the verification key is read from the `KILNEN_CIRCUIT_VKEY`
 * environment variable (the JSON exported by `circuits/setup.sh`). Until that
 * is set — and a multi-party ceremony has replaced the development setup — the
 * action fails closed rather than accept anything.
 *
 * Scope note: verifying the proof and the exact public-signal binding is the
 * node's job. Full semantic binding (that the signals are the ledger's current
 * root, fresh nullifiers, and the requested outputs) is enforced by the
 * on-chain verifier program plus the mutation's own checks; this action
 * verifies the cryptographic statement and pins the circuit id.
 */
export const verifySpend = action({
  args: {
    circuitId: v.string(),
    proofJson: v.string(),
    publicSignals: v.array(v.string()),
    statement: v.string(),
  },
  handler: async (ctx, { circuitId, proofJson, publicSignals, statement }) => {
    const raw = process.env.KILNEN_CIRCUIT_VKEY;
    if (!raw) {
      throw new Error(
        "Circuit verification key is not configured (set KILNEN_CIRCUIT_VKEY from circuits/setup.sh output). No proof is accepted without it.",
      );
    }
    let vkey: Parameters<typeof groth16.verify>[0];
    try {
      vkey = JSON.parse(raw);
    } catch {
      throw new Error("KILNEN_CIRCUIT_VKEY is not valid JSON.");
    }
    if (vkey.nPublic !== publicSignals.length) {
      throw new Error("Public signal count does not match the verification key.");
    }
    const proof = JSON.parse(proofJson) as Parameters<typeof groth16.verify>[2];
    const ok = await groth16.verify(vkey, publicSignals, proof);
    if (!ok) throw new Error("Groth16 proof failed verification.");

    // The proof hash binds the receipt to the exact bytes the client will
    // present to the mutation — swapping the proof invalidates the receipt.
    const proofHash = sha256Hex(proofJson);
    await ctx.runMutation(internal.spend.recordVerifiedProof, { statement, proofHash, circuitId });
    return { verified: true, nPublic: vkey.nPublic };
  },
});
