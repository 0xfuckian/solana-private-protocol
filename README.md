# SOL-ZK research workspace

React + Vite + Convex simulation of a Solana privacy-protocol product. **Not production, not audited, not private encryption, and not real Solana settlement. Do not use real funds or sensitive information.**

## Implemented in this foundation pass
- Uploaded `public/Glitch.ttf` self-hosted for display typography. Confirm commercial font licensing before launch.
- Depth-26 persistent Poseidon Merkle scaffold for newly inserted notes, indexed current paths and last-100-root retention. Existing notes require migration; legacy commitments are SHA-256 mapped into Fr, not native circuit commitments.
- snarkjs Groth16 client adapter requiring explicit WASM, zkey and verification key. No join-split circuit artifacts included. Production verifier endpoint deliberately rejects; demo hash endpoints remain insecure.
- Integer checks, duplicate-input rejection, dynamic fee-in-note quote, SOLZK-only client spend selection, UTF-8-correct ciphertext padding, conservative bigint AMM quote math, whitelist ownership boundaries.
- Exact-note client guards prevent silent excess-value loss in operations without change outputs. These guards are not server ownership/conservation proofs.
- Admin pause/resume controls with audit events, blocking operations that use the protocol state helper. Not an audited on-chain or multisig pause. `SOLZK_EXECUTION_MODE=production` blocks the simulation state helper; it does not enable production.
- `/payroll`: local CSV validation and unfunded payment-request link export. No funded employee claim flow or atomic batch payment; proposed 1% fee is not collected.
- `/explorer`: indexed 100-row paginated envelope receipts, kind/date filters on loaded pages, decoded public mint and fee summaries. Other event feeds remain limited; asset/tier-wide indexed filtering is outstanding.
- `/docs`: public handbook, threat model, corrected economics, known defects and mainnet acceptance gates, available during the whitelist gate.

## Important remaining defects
Legacy encryption is publicly decryptable given the address. Hash proofs are forgeable. Ownership, input value, asset IDs and conservation are not proven. Order settlement lacks seller-input consumption. Server note-consuming operations do not preserve change. Fee-share claims lack secure ownership/anchor validation and funded reserve accounting. Token transfer fees are historically routed as SOL units. Vault number-based fee accounting still needs versioned bigint checkpoints and withdrawal-accrual handling. Some older marketing descriptions elsewhere in the app describe the intended protocol, not implemented guarantees.

Legacy simulation uses 1e8 accounting units per displayed SOL. Solana uses 1e9 lamports. Existing stored balances/invoices have not been silently migrated. `SOLANA_LAMPORTS_PER_SOL` is the real-chain constant; a reviewed versioned migration is required.

## Checks
```sh
bun run test
bun convex dev --once && bun tsc -b --noEmit
```

51 tests pass: 30 unit/property tests and 21 Convex integration cases. They cover validation, fee conservation, AMM invariants, UTF-8 padding, request parsing, tree paths/root retention, permanent replay rejection, pause/resume and whitelist access isolation. These are not complete end-to-end protocol tests or an audit. Coverage >=80% has not been measured. No browser visual verification was available in this environment.

## Outstanding production work
Staking contracts/reward funding, insurance funding/claims/governance, funded payroll, collateralized lending/liquidation, multi-pair reserve execution, proved ASP roots, signed governance whitelist oracle, independent signed relayers, secure spend/view encryption and stealth addresses, Anchor custody/verifier program, real RPC settlement and indexed all-event explorer remain outstanding.

Two independent audits, multiparty trusted setup, 5-of-7 governance, upgrade timelock, funded insurance, legal review, bug bounty and real relayer operators require external resources. Nothing in this repository implies those gates have been met. See [the handbook](docs/THREAT_MODEL.md) for the acceptance checklist and corrected revenue calculations.

The platform manages development servers. Do not start duplicate dev/preview servers. Secrets belong in the Keys/API keys UI, not committed environment files.
