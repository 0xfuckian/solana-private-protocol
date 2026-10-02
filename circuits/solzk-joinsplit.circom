pragma circom 2.1.0;

// SOL-ZK join-split — REVIEW SCAFFOLD, NOT AUDITED, NOT DEPLOYED.
// Purpose: document the exact production statement the app must prove once
// reviewed artifacts (wasm/zkey/vkey), a trusted ceremony, and a deployed
// Solana verifier exist. Demo hashes in convex/* are NOT this circuit.
//
// Public inputs (all bound in the proof):
//   root            — Merkle root of the commitment tree (Poseidon, depth 26)
//   nullifier[i]    — permanent spend tags, 1..16, each = Poseidon(commitment, spendKey)
//   outputCommit[i] — 1..2 new commitments (receiver + change), Poseidon(value, assetId, r, owner)
//   assetId         — 0 = SOLZK; nonzero = shielded SPL asset id (prevents type confusion)
//   feeTokens       — protocol fee in tokens, tier-discounted on-chain
//   relayerFee      — in-note relayer fee (0 when sender pays SOL)
//   domain          — burn/redeem/deposit/swap/trade/payroll domain separator
//   anchorSlot      — fee-share anchor slot (fee-share circuit only)
//
// Private inputs (never revealed):
//   inValue[i], inR[i], inOwner[i], spendKey, pathElements, pathIndices
//
// Constraints (sketch — a real audit must pin every one):
//   1. For each input: commitment == Poseidon(value, assetId, r, owner).
//   2. For each input: Merkle path verifies against `root` (depth 26, Poseidon).
//   3. For each input: nullifier == Poseidon(commitment, spendKey).
//   4. Conservation: sum(inValue) == sum(outValue) + feeTokens + relayerFee + burned.
//   5. assetId is identical across inputs, outputs, fee (no cross-asset spend).
//   6. Output commitments bind (value, assetId, r, ownerPub) — owner is a
//      P-256 viewing-pub hash, NOT the legacy address string.
//   7. Sealed-note ciphertext digest equals Poseidon(ct[0..31]) public input,
//      so the ledger's stored bytes are exactly what was proven.
//   8. Domain separator binds burn/redeem/deposit/swap/trade/payroll intent.
//
// Out of scope for this file: trusted setup ceremony, verifier program,
// relayer authentication, whitelist roots, ASP attestations, lending risk.

template SolzkJoinSplit(N_IN, N_OUT, DEPTH) {
    signal input root;
    signal input nullifier[N_IN];
    signal input outputCommit[N_OUT];
    signal input assetId;
    signal input feeTokens;
    signal input relayerFee;
    signal input domain;
    signal input ctDigest[N_OUT];

    signal input inValue[N_IN];
    signal input inR[N_IN];
    signal input inOwner[N_IN];
    signal input spendKey;
    signal input pathElements[N_IN][DEPTH];
    signal input pathIndices[N_IN][DEPTH];
    signal input outValue[N_OUT];
    signal input outR[N_OUT];
    signal input outOwner[N_OUT];

    // Placeholder: the real constraint system goes here after review.
    // This template deliberately has no satisfiable assignment wired —
    // integrators must replace it with the audited implementation and
    // regenerate wasm/zkey/vkey via the ceremony in circuits/README.md.
    log("SOLZK joinsplit scaffold — do not use in production");
}

component main { public [root, nullifier, outputCommit, assetId, feeTokens, relayerFee, domain, ctDigest] } = SolzkJoinSplit(16, 2, 26);
