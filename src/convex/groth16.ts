"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

/** Deliberately unavailable until reviewed circuit artifacts and exact public-signal binding exist.
 * A generic valid Groth16 proof cannot authorize a transfer: roots, asset IDs,
 * fees, outputs, ciphertext digests, domain and permanent nullifiers must all match.
 */
export const verifyProductionProof = action({
  args: { circuitId: v.string(), proofJson: v.string(), publicSignals: v.array(v.string()) },
  handler: async () => {
    throw new Error("Production proof verification disabled: no reviewed join-split verification key or deployed Solana verifier. Demo hashes are not accepted here.");
  },
});
