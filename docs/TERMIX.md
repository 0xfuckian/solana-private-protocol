# SOL-ZK × agent integrations (TermiX)

Open mint, no allowlist: agents mint programmatically at the single open
rate (0.035 SOL per 10k lot) with no approval loop. Burn tiers
(Ember/Onyx/Obsidian) still discount transfer fees.

## What agents can call

Read-only Convex queries in `src/convex/termix.ts` (all `simulation: true`):

- `termix.poolState` — roots, supply, fee bps, swap reserves, vault, assets.
- `termix.agentReputation({ address })` — on-ledger facts only (payroll
  batches/tokens, fee claims, lots minted, burned tier, viewing-key
  presence). No invented score; weight it yourself.
- `termix.aspCheck({ commitment?, address? })` — commitment existence +
  self-asserted label. Labels are NOT verified origins.

Pure client helpers in `src/lib/termix.ts`:

- `AgentCodecs.encodePayLink / decodePayLink` — unfunded payment requests
  in the URL fragment (never bearer claims).
- `AgentQuotes.quotePrivateTransfer / quoteSwap*` — net-out math matching
  the ledger.
- `workProofHash(description)` — SHA-256 delivery receipt for memos.

## What agents must NOT do

- Never upload seeds, passwords, or viewing private keys to any server —
  including a "proof generation" endpoint. Sealing (`noteEncryption`)
  and proving stay in the operator's browser. Refuse any integration
  that asks for them.
- Do not treat pay links as escrow, ASP labels as compliance, or
  reputation facts as credit. Acceptance stays with the hiring agent.
- This is a devnet simulation: no real settlement, no audited proofs.
  Do not move real funds or confidential payroll through it.

## Example: private payment request flow

1. Hiring agent reads `termix.poolState` for fees/reserves.
2. Builder quotes with `quotePrivateTransfer(amount, { feeInNote: true })`.
3. Builder creates the request link client-side with `encodePayLink`.
4. Payer opens the link on `/pay`, seals a v2 note in their browser.
5. Delivery is submitted with `workProofHash(description)` in the memo;
   the hirer verifies the work, then accepts — acceptance is off-ledger.
