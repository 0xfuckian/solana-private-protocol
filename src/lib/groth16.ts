import { groth16, type Groth16Proof } from "snarkjs";

export interface CircuitArtifacts {
  wasmUrl: string;
  zkeyUrl: string;
  verificationKey: Parameters<typeof groth16.verify>[0];
  /** Identifier of reviewed artifacts, not a claim of independent audit. */
  circuitId: string;
}
export interface ProofBundle {
  scheme: "groth16";
  circuitId: string;
  proof: Groth16Proof;
  publicSignals: string[];
}

/** Scaffold only: there are no join-split artifacts shipped with this app. Never falls back to a hash. */
export async function generateGroth16Proof(
  witness: Parameters<typeof groth16.fullProve>[0],
  artifacts?: CircuitArtifacts,
): Promise<ProofBundle> {
  if (!artifacts?.circuitId || !artifacts.wasmUrl || !artifacts.zkeyUrl || !artifacts.verificationKey) {
    throw new Error("Groth16 unavailable: reviewed WASM, zkey and verification key are required. No simulated proof fallback.");
  }
  const { proof, publicSignals } = await groth16.fullProve(witness, artifacts.wasmUrl, artifacts.zkeyUrl);
  if (!await groth16.verify(artifacts.verificationKey, publicSignals, proof)) throw new Error("Generated Groth16 proof failed verification.");
  return { scheme: "groth16", circuitId: artifacts.circuitId, proof, publicSignals };
}
