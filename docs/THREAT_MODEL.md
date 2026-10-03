# SOL-ZK handbook

## What exists today
This app keeps its ledger in Convex and its ZK in a real Groth16 join-split circuit, but it ships **no Solana custody program, no RPC settlement, no real SPL deposits, and no production relayer**, and the circuit is **unaudited with a single-party development setup**. Balances have no monetary value. Never enter a real wallet recovery phrase, salaries, or confidential financial data.

## Key custody and the server
Keys never leave the user's device. Seeds and the v2 viewing key are generated in the browser, shown/entered once, and stored on-device only as PBKDF2 + AES-GCM ciphertext in `localStorage`. Nothing is uploaded, backed up to a cloud service, or synced across devices through the backend. Registration sends only the derived address, a public commitment, and the optional public viewing key.

The server's only cryptographic role is verifying a proof the client already produced: `POST /api/transfer/verify` accepts `proof` and `publicInputs` and never a key. There is no server-side proof generation. No endpoint may accept a seed phrase, spend key, viewing private key, or password, and the wallet UI must never transmit, cloud-back-up, or server-sync them. Any integration that asks for a key is a phishing pattern to refuse.

## What we do not claim
- No anonymity, untraceability, regulatory approval, insurance coverage, solvency, or guaranteed returns.
- Legacy v1 note keys are derived from public address and ephemeral data. Anyone with the address can decrypt those notes, forever. AES-GCM integrity does not solve this confidentiality failure. New notes default to v2 (per-note ephemeral ECDH P-256 + HKDF + AES-GCM-256, 65-byte epk, 512-byte ct) when the recipient published a viewing key: only the viewing-private holder can read, with fresh forward secrecy per note. v1 remains as fallback for legacy wallets and is labeled in the Pay UI. Restored wallets rotate to a fresh viewing key; old v2 notes need the user's own offline backup of the old key (never a server-held copy). Ownership/value/conservation are still unproven without the audited circuit.
- The SHA-256 statement "proofs" are gone. Spends now require a real Groth16 proof (`circuits/kilnen-spend.circom`) verified by `convex/groth16.ts` before any mutation runs, and the V8 runtime cannot fabricate a receipt. What is *not* resolved: the circuit is unaudited, the setup is single-party, and semantic binding of signals to live ledger state waits on the on-chain verifier.
- Authenticated requests, timestamps, public amounts, account-linked records, IP/network metadata and browser storage can identify participants.
- Fixed-size padded strings do not establish constant-size serialized Solana transactions, and do not hide timing or amount correlations.
- ASP labels are self-asserted labels, not verified origins or compliance certifications. Current view-key hashes do not provide a working auditor decryption capability. Published stealth metadata does not provide a secure ECDH stealth protocol.

## Proof and tree status
The client adapter (`src/lib/groth16.ts`) builds a witness and runs real Groth16 proving; the node action (`src/convex/groth16.ts`) runs real `snarkjs.groth16.verify` and records a one-time receipt the mutations consume. There is no hash fallback. What is still missing: independently audited constraints, a multi-party ceremony, committed artifacts served from `public/circuits/` and `KILNEN_CIRCUIT_VKEY`, and on-chain signal binding.

`circuits/kilnen-spend.circom` is a **real** join-split circuit (ownership, conservation, asset-ID, nullifier, Poseidon Merkle membership, fee/domain binding) that compiles to 11,526 non-linear constraints. It is not yet audited and ships no ceremony. `solana/solzk_verifier.json` and `src/lib/solana.ts` remain the Anchor verifier + custody + RPC wiring point; `isSettlementLive()` is false until a program deploys and RPC is configured. Nothing here settles on Solana yet.

New notes append to a depth-20 incremental Poseidon tree whose leaves are native Poseidon commitments (`src/lib/poseidon.ts`), matching the circuit. Indexed nodes supply current sibling paths; the latest 100 roots are retained. Existing legacy notes have no leaf index and require a separately reviewed migration. Old-root proof paths require historical snapshots or a client-maintained tree, which are not implemented.

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
