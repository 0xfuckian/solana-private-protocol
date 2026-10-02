# SOL-ZK handbook

## What exists today
This app is a Convex simulation. No Solana custody program, RPC settlement, real SPL deposits, audited join-split circuit, or production relayer is shipped. Demo balances have no monetary value. Never enter a real wallet recovery phrase, salaries, or confidential financial data.

## What we do not claim
- No anonymity, untraceability, regulatory approval, insurance coverage, solvency, or guaranteed returns.
- The legacy note encryption key is derived from public address and ephemeral data. Anyone with the address can decrypt those notes. AES-GCM integrity does not solve this confidentiality failure.
- Legacy SHA-256 statement hashes are forgeable by anybody. They prove neither ownership, membership, input value, nor conservation. The simulated spending endpoints remain unsafe for real funds.
- Authenticated requests, timestamps, public amounts, account-linked records, IP/network metadata and browser storage can identify participants.
- Fixed-size padded strings do not establish constant-size serialized Solana transactions, and do not hide timing or amount correlations.
- ASP labels are self-asserted labels, not verified origins or compliance certifications. Current view-key hashes do not provide a working auditor decryption capability. Published stealth metadata does not provide a secure ECDH stealth protocol.

## Proof and tree scaffolding
The snarkjs client adapter calls real Groth16 proving and verifies the result, but requires explicitly supplied WASM, zkey and verification key. No circuit artifacts are included. The production server action always rejects until a reviewed circuit and complete public-signal authorization binding are implemented. The demo hash proof is not upgraded by these adapters.

New notes append to a depth-26 incremental Poseidon tree. Indexed nodes supply current sibling paths; the latest 100 roots are retained. Legacy SHA-256 commitments are reduced into the BN254 scalar field only for the scaffold; this is not the future circuit's native commitment format. Existing notes have no leaf index and require a separately reviewed migration. Old-root proof paths require historical snapshots or a client-maintained tree, which are not implemented.

A production join-split must range-check integer values; prove ownership, secret-key-derived nullifiers, membership, asset/domain binding, output commitments and input = output + fee conservation. Public signals must bind root, chain/program/circuit domain, fees, nullifiers, outputs and a reviewed ciphertext digest construction. Uniqueness is enforced atomically by the authoritative ledger, not by a circuit that cannot observe global state. Nullifiers remain spent forever: slots annotate finality, never reset spent status. Reorg reconciliation must be tied to finalized on-chain state.

The server must not decrypt private outputs. Clients must verify received plaintext against commitments. Binding an arbitrary ciphertext hash alone does not prove its plaintext/encryption correctness; verifiable encryption or a reviewed sender/receiver construction is required.

## Implemented simulation utilities
Burns, redemptions, vault deposits, token swaps and mock-asset unshielding now return excess declared input value as change. Seller trade settlement consumes supplied nullifiers, publishes buyer/change outputs and conserves the buyer-paid SOL escrow fee. New statements canonically bind output ciphertexts and change. These checks do not prove actual ownership or input amounts; client-declared totals remain forgeable without the circuit.

Vault rewards use bigint decimal-string indices and per-position checkpoints at a 1e18 scale. Fractional credit survives deposits, claims and zero-share withdrawals. Existing numeric checkpoints are converted lazily; already-lost legacy precision cannot be recovered. Claims do not fabricate implied sellout fees. Fees collected without holders are explicitly unallocated until the next first deposit; already-attributed dust is not reassigned.

Simulation staking locks principal for seven days after the latest deposit. Active stakes lower the base transfer fee to 1% (burn discounts apply afterward), raise the daily limit from 10 to 100 demo-SOL-equivalent and display 1-token/1-weight governance previews, not actual votes. The vault half of NEW token transfer/payroll fees funds staking rewards when active stakes exist. Rewards are paid only from the funded token reserve; no APY guarantee. Without stakes that half stays in a separate token reward reserve; historical reserves are not retroactively distributed. SOL fees remain in the SOL vault.

Transfer/payroll limits use UTC calendar days and the fixed simulation exit rate, not a live market oracle or a production risk limit. Staking and payroll still depend on insecure legacy hash authorization and must not receive real funds.

Payroll dispatch creates up to 20 recipient notes plus change atomically, charges ceil(total/100) SOLZK on top of net employee amounts and routes the fee half/half. Failure rolls back the full batch. CSV request preparation supports up to 100 payees locally. Dispatch exposes addresses/amounts to Convex; exported links are requests, not bearer-funded claims. Real employee unshielding and private custody are not available.

Client scanning now excludes decoded plaintext that does not match its commitment. Legacy notes with incorrect randomness/commitment binding can disappear from spendable balances and require a reviewed migration; this check does not repair public-address-derived encryption.

## Fees and units
Legacy demo accounting uses 100,000,000 units per displayed SOL. Real Solana uses 1,000,000,000 lamports per SOL. A named real-chain constant is provided; legacy stored balances and invoices have NOT been silently rescaled. A versioned migration is required before any RPC integration.

Mint fee: 5%; transfers/trades: 2% before burn discounts; swaps: 0.3%. Fee charges round upward to integer units. Odd fee splits round upward to the vault, with treasury receiving the remainder, so the split conserves the fee. Fee-in-note quote = max(25, ceil(amount / 1000)) SOLZK. No signed competitive relayer quotes exist. New transfer token fees are stored in token-denominated treasury/reward reserves, not SOL pools. Historical misclassification still needs a reviewed denomination migration.

Payroll request generation charges nothing. Atomic simulation dispatch collects a 1% token fee in addition to net payee amounts. Existing individual payment links use their normal transfer fees. Links preserve the SOLZK-PAY|v1| codec; payment requests are not funded escrow claims.

## Economic corrections
210M / 10,000 = 21,000 lots. 100,000 tokens = 10 lots = 0.15 SOL at 0.015 SOL per lot; 100 lots = 1M tokens = 1.5 SOL. 1,000 open lots cost 35 SOL; their treasury mint fee is 0.875 SOL, not 250 SOL. 1M tokens at the open rate cost 3.5 SOL with a treasury share of 0.0875 SOL. Token market price does not turn minted token units into treasury revenue.

10.5M tokens is 5% of total supply, not 5% of an unspecified treasury. No such insurance reserve has been funded. Returns require actual fee volume, available reserves and allocations; 5% APY is not guaranteed. Burned supply alone does not increase fee revenue or APY. Lending needs collateral valuation, liquidation, bad-debt handling and funded liquidity before borrowing can be enabled.

## Production acceptance gates (none satisfied for mainnet)
1. Specify and review circuit, encryption/key derivation, ciphertext binding, asset IDs and public signals.
2. Compile and constrain circuits; independent audits by two firms; publish issues and remediations.
3. Run/document multiparty phase-2 setup; verify Powers of Tau provenance, contributions and artifact hashes.
4. Build/test an Anchor custody/verifier program with permanent nullifier PDAs, finalized state and emergency pause.
5. Test large-tree migration, output change, asset segregation, escrow conservation, fee denominations and fixed-point reward accounting.
6. Implement staking locks/rewards/governance; fund insurance under a voted claim policy; do not mint an unfunded reserve fixture.
7. Implement funded atomic payroll; lending collateral/liquidation; segregated multi-pair pools and reserve provenance.
8. Implement proved ASP origin sets, signed governance whitelist roots and threshold-signature oracle verification.
9. Deploy at least two independent signed-quote relayers with expiry, replay/domain protection, monitoring and finalized receipts.
10. Replace legacy public-address encryption with audited spend/view-separated encryption and stealth derivation; migrate wallets safely.
11. Add decoded explorer pagination and filters for all event classes; private payloads remain private only after the crypto is replaced.
12. Verify unit/property/integration/adversarial coverage; target 80% coverage is a goal, not an achieved result.
13. Configure RPC endpoints via Keys UI; deploy devnet first, run capped adversarial trials, reconcile reserves.
14. Establish funded 5-of-7 governance, timelock and tested pause/recovery controls; no single-key custody.
15. Obtain jurisdiction-specific legal review, fund bug bounty, publish audits and launch criteria before mainnet.

Independent audits, setup contributions, governance approvals, insurance funding, real relayer operators and legal opinions require external people and resources. They cannot be created by a UI button or a successful TypeScript check.
