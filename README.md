# SOL-ZK research workspace

React + Vite + Convex simulation of a Solana privacy-protocol product. **Not production, not audited, not private encryption, and not real Solana settlement. Do not use real funds or sensitive information.**

## Implemented in this foundation pass
- Uploaded `public/Glitch.ttf` self-hosted for display typography. Confirm commercial font licensing before launch.
- Depth-26 persistent Poseidon Merkle scaffold for newly inserted notes, indexed current paths and last-100-root retention. Existing notes require migration; legacy commitments are SHA-256 mapped into Fr, not native circuit commitments.
- snarkjs Groth16 client adapter requiring explicit WASM, zkey and verification key. No join-split circuit artifacts included. Production verifier endpoint deliberately rejects; demo hash endpoints remain insecure.
- Integer checks, duplicate-input rejection, dynamic fee-in-note quote, SOLZK-only client spend selection, UTF-8-correct ciphertext padding, conservative bigint AMM quote math, whitelist ownership boundaries.
- Change-preserving demo spends for burns, redemptions, deposits, token swaps and asset unshielding; versioned statements bind declared totals, inputs and change. Actual input values and ownership are still not proven.
- Market settlement retires seller nullifiers, returns change, releases gross SOL to the seller and routes the buyer-paid fee once. Filled orders leave the book; pending fills do not set the last settled price.
- Separate SOLZK treasury/reward balances; new token fees no longer credit SOL pools. Historical misclassified fees require reviewed migration.
- Bigint-string vault reward indices/checkpoints preserve fractional entitlement across deposits, claims and withdrawals. Legacy precision cannot be recovered. Claims no longer manufacture backfill fees.
- Dashboard simulation staking: seven-day locks, funded pro-rata SOLZK rewards, 1% base transfer fee before burn discounts, 100 vs 10 demo-SOL daily transfer allowance and governance-weight preview. No on-chain staking contract or actual DAO voting.
- Admin pause/resume controls with audit events, blocking operations that use the protocol state helper. Not an audited on-chain or multisig pause. `SOLZK_EXECUTION_MODE=production` blocks the simulation state helper; it does not enable production.
- `/payroll`: local CSV/request-link preparation plus atomic simulation dispatch for up to 20 payees, recipient notes, excess change and a 1% token fee. Exported links remain unfunded requests, not employee bearer claims. Dispatch uploads payees/amounts and is not private payroll.
- `/explorer`: indexed 100-row paginated envelope receipts, kind/date filters on loaded pages, decoded public mint and fee summaries. Other event feeds remain limited; asset/tier-wide indexed filtering is outstanding.
- `/docs`: public handbook, threat model, corrected economics, known defects and mainnet acceptance gates, available during the whitelist gate.

## Important remaining defects
Legacy encryption is publicly decryptable given the address. Hash proofs are forgeable. Ownership, input value, asset IDs and conservation are not proven. Declared input totals remain client-controlled despite change arithmetic and permanent nullifier checks. Fee-share claims lack secure ownership/anchor validation and funded reserve accounting. Historical token fees were misclassified as SOL; legacy balances and reward precision require reviewed migration. Some older marketing descriptions elsewhere in the app describe the intended protocol, not implemented guarantees.

Legacy simulation uses 1e8 accounting units per displayed SOL. Solana uses 1e9 lamports. Existing stored balances/invoices have not been silently migrated. `SOLANA_LAMPORTS_PER_SOL` is the real-chain constant; a reviewed versioned migration is required.

## Checks
```sh
bun run test
bun convex dev --once && bun tsc -b --noEmit
```

Unit/property and Convex integration tests cover the foundation plus change rollback, seller-input settlement, escrow conservation, fee denominations, vault checkpoints, staking locks/rewards and atomic payroll. Run `bun run test` for the current count. They cover validation, fee conservation, AMM invariants, UTF-8 padding, request parsing, tree paths/root retention, permanent replay rejection, pause/resume and whitelist access isolation. These are not complete end-to-end protocol tests or an audit. Coverage >=80% has not been measured. No browser visual verification was available in this environment.

## Outstanding production work
On-chain staking contracts/governance, insurance funding/claims, real funded payroll and employee claim flows, collateralized lending/liquidation, multi-pair reserve execution, proved ASP roots, signed governance whitelist oracle, independent signed relayers, secure spend/view encryption and stealth addresses, Anchor custody/verifier program, real RPC settlement and indexed all-event explorer remain outstanding.

Two independent audits, multiparty trusted setup, 5-of-7 governance, upgrade timelock, funded insurance, legal review, bug bounty and real relayer operators require external resources. Nothing in this repository implies those gates have been met. See [the handbook](docs/THREAT_MODEL.md) for the acceptance checklist and corrected revenue calculations.

The platform manages development servers. Do not start duplicate dev/preview servers. Secrets belong in the Keys/API keys UI, not committed environment files.
