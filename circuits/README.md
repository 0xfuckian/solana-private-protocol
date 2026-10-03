# Kilnen join-split circuit

`kilnen-spend.circom` is the real Groth16 spend circuit. It is not a scaffold:
it compiles to a full constraint system and enforces the ownership, value,
conservation, nullifier and Merkle-membership relations the ledger relies on.

```
ownership     C  = Poseidon4(value, assetId, rField, ownerField)
nullifier     nf = Poseidon2(C, spendKey)
Merkle parent    = Poseidon2(left, right)          (depth 20)
```

Public inputs: `root, nullifier[2], outputCommit[2], assetId, feeTokens,
relayerFee, domain`. Private inputs: note values, blindings, owners, the spend
key and the Merkle paths. Constraints (all in the file):

1. each input commitment is recomputed and Merkle-proved against `root`;
2. each `nullifier[i] == Poseidon2(commitment, spendKey)`;
3. each output commitment is recomputed exactly;
4. conservation: `inSum == outSum + feeTokens + relayerFee` (no inflation);
5. `assetId` and `domain` are public, so a proof cannot be replayed across
   assets or intents.

Current shape: 2 inputs × 2 outputs, depth 20 → **11,526 non-linear
constraints, 9 public inputs**.

## Build + setup

```
./circuits/setup.sh          # compile + Groth16 setup (single-party, dev)
node circuits/make-vectors.mjs   # regenerate circuits/vectors.json
```

`setup.sh` produces, under `circuits/build/`:

- `kilnen-spend.r1cs`, `kilnen-spend_js/kilnen-spend.wasm`
- `kilnen-spend.zkey` — proving key
- `verification_key.json`

Copy the wasm/zkey into the served `public/circuits/` directory so the browser
prover can fetch them.

### Trust caveat — read this

`setup.sh` performs a **single-party development setup**. It is a genuine
Groth16 setup (real proofs verify against the produced key), but one party
holds the toxic waste, so it is not production-secure. A production launch
requires a **multi-party Powers-of-Tau + phase-2 ceremony** with published
transcripts before the verification key is trusted. The constraint system
itself does not change; only who participated in the setup does.

## How the app uses it

- Browser prover: `src/lib/groth16.ts` (`proveSpend`) — builds the witness and
  runs `snarkjs.groth16.fullProve`. There is **no hash fallback**.
- Node verifier: `src/convex/groth16.ts` (`verifySpend`, a `"use node"`
  action) — verifies the proof against `KILNEN_CIRCUIT_VKEY`, then records a
  one-time receipt.
- Mutations (`src/convex/spend.ts` `requireVerifiedProof`) consume the receipt.
  The V8 runtime can never verify or fabricate a proof, so no spend is
  authorized without a verified one.
- Field mapping: `src/lib/poseidon.ts` (shared by browser and node) — the
  single source of truth for `commitmentFor`, `nullifierFor`, `hashPair` and
  `fieldFromString`.

`circuits/vectors.json` holds the deterministic witness and public signals
(`proven: true` only once real artifacts exist). `src/lib/poseidon.test.ts`
checks the JS primitives reproduce those values, and that Poseidon matches
circomlib on the curve.
