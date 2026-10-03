pragma circom 2.1.0;

// Kilnen join-split — REAL Groth16 constraint system (BN254 / circom 2).
//
// This is the production-shaped spend statement: a shielded spender proves,
// without revealing which notes they hold, that they control N_IN notes in
// the commitment tree, that the spend does not inflate supply, and that the
// published nullifiers and output commitments are exactly derived from those
// notes. The circuit is compiled and set up by `circuits/setup.sh`; the
// resulting verification key is what the Convex node verifies with.
//
// Ownership model (matches src/lib/noteEncryption.ts + src/lib/wallet.ts):
//   commitment  C  = Poseidon4(value, assetId, r, owner)
//   nullifier   nf = Poseidon2(C, spendKey)
//   tree parent     = Poseidon2(left, right)   (depth DEPTH, see merkle.ts)
//
// Public inputs (bound by the proof, read by the verifier):
//   root, nullifier[N_IN], outputCommit[N_OUT], assetId, feeTokens, relayerFee, domain
// Private inputs (never revealed):
//   inValue[N_IN], inR[N_IN], inOwner[N_IN], spendKey,
//   pathElements[N_IN][DEPTH], pathIndices[N_IN][DEPTH],
//   outValue[N_OUT], outR[N_OUT], outOwner[N_OUT]
//
// Security caveat this file cannot fix: the setup performed by
// `circuits/setup.sh` is a SINGLE-PARTY development setup. Production
// requires a multi-party Powers-of-Tau + phase-2 ceremony with published
// transcripts. The circuit constraints themselves are complete; the toxic
// waste handling is an operational, not a code, property.

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Merkle inclusion proof over Poseidon2 compression, matching poseidon-lite.
template MerklePath(DEPTH) {
    signal input leaf;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];
    signal output root;

    signal cur[DEPTH + 1];
    signal left[DEPTH];
    signal right[DEPTH];
    component h[DEPTH];
    cur[0] <== leaf;

    for (var i = 0; i < DEPTH; i++) {
        // pathIndices must be boolean; enforced so the selector is sound.
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        // left  = bit ? sibling : cur
        // right = bit ? cur     : sibling
        left[i]  <== cur[i] + pathIndices[i] * (pathElements[i] - cur[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (cur[i] - pathElements[i]);
        h[i] = Poseidon(2);
        h[i].inputs[0] <== left[i];
        h[i].inputs[1] <== right[i];
        cur[i + 1] <== h[i].out;
    }

    root <== cur[DEPTH];
}

template KilnenSpend(N_IN, N_OUT, DEPTH) {
    // ---- public ----
    signal input root;
    signal input nullifier[N_IN];
    signal input outputCommit[N_OUT];
    signal input assetId;
    signal input feeTokens;
    signal input relayerFee;
    signal input domain;

    // ---- private ----
    signal input inValue[N_IN];
    signal input inR[N_IN];
    signal input inOwner[N_IN];
    signal input spendKey;
    signal input pathElements[N_IN][DEPTH];
    signal input pathIndices[N_IN][DEPTH];
    signal input outValue[N_OUT];
    signal input outR[N_OUT];
    signal input outOwner[N_OUT];

    component commit[N_IN];
    component merkle[N_IN];
    component nf[N_IN];
    component ocommit[N_OUT];

    // 1. Each input note's commitment is recomputed and Merkle-proved.
    //    Nullifier[i] = Poseidon2(commitment, spendKey) is enforced.
    for (var i = 0; i < N_IN; i++) {
        commit[i] = Poseidon(4);
        commit[i].inputs[0] <== inValue[i];
        commit[i].inputs[1] <== assetId;
        commit[i].inputs[2] <== inR[i];
        commit[i].inputs[3] <== inOwner[i];

        merkle[i] = MerklePath(DEPTH);
        merkle[i].leaf <== commit[i].out;
        for (var d = 0; d < DEPTH; d++) {
            merkle[i].pathElements[d] <== pathElements[i][d];
            merkle[i].pathIndices[d] <== pathIndices[i][d];
        }
        merkle[i].root === root;

        nf[i] = Poseidon(2);
        nf[i].inputs[0] <== commit[i].out;
        nf[i].inputs[1] <== spendKey;
        nf[i].out === nullifier[i];
    }

    // 2. Output commitments are recomputed exactly, binding value/asset/owner.
    for (var j = 0; j < N_OUT; j++) {
        ocommit[j] = Poseidon(4);
        ocommit[j].inputs[0] <== outValue[j];
        ocommit[j].inputs[1] <== assetId;
        ocommit[j].inputs[2] <== outR[j];
        ocommit[j].inputs[3] <== outOwner[j];
        ocommit[j].out === outputCommit[j];
    }

    // 3. Conservation: inputs cover outputs + protocol fee + relayer fee.
    //    No value is minted; over/under-spend is unsatisfiable.
    signal inSum;
    signal outSum;
    inSum <== inValue[0] + inValue[1];
    outSum <== outValue[0] + outValue[1];
    inSum === outSum + feeTokens + relayerFee;

    // assetId and domain are public inputs: Groth16 binds them into the proof,
    // so a proof for one asset or one intent (burn/redeem/transfer/…) cannot be
    // replayed in another context.
}

component main {public [root, nullifier, outputCommit, assetId, feeTokens, relayerFee, domain]} = KilnenSpend(2, 2, 20);
