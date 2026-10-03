import { groth16, type Groth16Proof } from "snarkjs";
import { FIELD } from "./poseidon";

/**
 * Real client-side Groth16 prover for the join-split spend circuit.
 *
 * Artifacts are produced by `circuits/setup.sh` and served from the web root
 * (`public/circuits/...`). There is no simulated fallback: if the artifacts
 * are absent, proving throws. The proof is then verified on the node by
 * `convex/groth16.ts` (a real verifier) before a spend can be authorized.
 */
export const CIRCUIT_ID = "kilnen-joinsplit-v1";
export const ARTIFACT_BASE = "/circuits";

export interface CircuitArtifacts {
  wasmUrl: string;
  zkeyUrl: string;
  circuitId: string;
}
export interface ProofBundle {
  scheme: "groth16";
  circuitId: string;
  proof: Groth16Proof;
  publicSignals: string[];
  /** Serialized bundle — the exact string the mutation is given as `proof`. */
  proofJson: string;
}

export function defaultArtifacts(): CircuitArtifacts {
  return {
    circuitId: CIRCUIT_ID,
    wasmUrl: `${ARTIFACT_BASE}/kilnen-spend_js/kilnen-spend.wasm`,
    zkeyUrl: `${ARTIFACT_BASE}/kilnen-spend.zkey`,
  };
}

/** Witness for the circuit — decimal field strings, exactly as circom reads. */
export interface JoinSplitWitness {
  root: string;
  nullifier: [string, string];
  outputCommit: [string, string];
  assetId: string;
  feeTokens: string;
  relayerFee: string;
  domain: string;
  inValue: [string, string];
  inR: [string, string];
  inOwner: [string, string];
  spendKey: string;
  pathElements: [string[], string[]];
  pathIndices: [number[], number[]];
  outValue: [string, string];
  outR: [string, string];
  outOwner: [string, string];
}

function asField(value: bigint): string {
  if (value < 0n || value >= FIELD) throw new Error("Witness value out of the scalar field.");
  return value.toString();
}

/**
 * Build a well-formed witness from an already-computed spend. The caller is
 * responsible for supplying the true note preimages (value, blinding `r`,
 * owner fields) and the Merkle path served by `api.merkle.getPath` — this
 * function only shapes and bounds-checks them.
 */
export function buildSpendWitness(input: {
  root: string;
  nullifiers: [string, string];
  outputCommit: [string, string];
  assetId: number;
  feeTokens: number;
  relayerFee: number;
  domainField: string;
  inValue: [number, number];
  inR: [string, string];
  inOwner: [string, string];
  spendKey: string;
  pathElements: [string[], string[]];
  pathIndices: [number[], number[]];
  outValue: [number, number];
  outR: [string, string];
  outOwner: [string, string];
}): JoinSplitWitness {
  return {
    root: input.root,
    nullifier: input.nullifiers,
    outputCommit: input.outputCommit,
    assetId: String(input.assetId),
    feeTokens: String(input.feeTokens),
    relayerFee: String(input.relayerFee),
    domain: input.domainField,
    inValue: input.inValue.map(v => asField(BigInt(v))) as [string, string],
    inR: input.inR,
    inOwner: input.inOwner,
    spendKey: input.spendKey,
    pathElements: input.pathElements,
    pathIndices: input.pathIndices,
    outValue: input.outValue.map(v => asField(BigInt(v))) as [string, string],
    outR: input.outR,
    outOwner: input.outOwner,
  };
}

/** Produce a real Groth16 proof. Never falls back to a hash. */
export async function proveSpend(
  witness: JoinSplitWitness,
  artifacts: CircuitArtifacts = defaultArtifacts(),
): Promise<ProofBundle> {
  if (!artifacts.wasmUrl || !artifacts.zkeyUrl) {
    throw new Error("Groth16 unavailable: run circuits/setup.sh to produce wasm/zkey. No simulated proof fallback.");
  }
  const { proof, publicSignals } = await groth16.fullProve(witness as never, artifacts.wasmUrl, artifacts.zkeyUrl);
  const proofJson = JSON.stringify(proof);
  return { scheme: "groth16", circuitId: artifacts.circuitId, proof, publicSignals, proofJson };
}

/** Local sanity check before submitting to a relayer. */
export async function verifyLocally(
  bundle: ProofBundle,
  verificationKey: unknown,
): Promise<boolean> {
  return groth16.verify(verificationKey as never, bundle.publicSignals, bundle.proof);
}
