# SOL-ZK join-split circuit — review scaffold

`solzk-joinsplit.circom` documents the production statement. It is **not audited, not set up, not deployed**. Demo hashes in `src/convex/*` do not satisfy it.

## What production requires

1. **Review the circuit** — ownership, value, conservation, asset-ID binding, nullifier permanence, Merkle path (Poseidon, depth 26), ciphertext digest, fee and domain binding.
2. **Trusted setup ceremony** — Powers-of-Tau + circuit-specific phase, 2+ independent contributors, published transcripts.
3. **Artifacts** — `solzk-joinsplit.wasm`, `solzk-joinsplit.zkey`, `verification_key.json`. Serve over HTTPS; pin `circuitId` in `src/lib/groth16.ts`.
4. **Solana verifier** — deploy the Anchor program in `solana/` (Groth16 verifier + custody + Merkle roots + nullifier set + fee routing). Record the program ID in `src/lib/solana.ts`.
5. **Vectors** — replace `vectors.json` placeholders with real Poseidon/Merkle outputs; wire `bun run test` to check them before enabling `SOLZK_EXECUTION_MODE=production`.

Until all five land, the app stays a devnet simulation and says so on every page.
