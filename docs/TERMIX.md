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

## Server contract: verify-only

Keys never leave the user's device. Period. There is no endpoint — here or
in the reference SDK — that accepts a seed, spend key, viewing private key,
password, or mnemonic. Any integration that asks for one is hostile; refuse
it and report it.

The only server-side crypto role is verification of a proof the client
already produced:

```typescript
// ✓ Server receives a proof only — never a key.
POST /api/transfer/verify
  Input:  proof, publicInputs
  Output: verified, gasEstimate
```

### What must stay client-side (in the user's browser)

- Proof generation. The spend key and seed are read from local encrypted
  storage, used to build the proof, and never serialized into a request.

```typescript
// ✓ Runs in the user's browser; the key stays here.
const proof = await solzk.proveTransfer({
  senderKey, // derived locally; never transmitted
  amount,
  recipient,
  asset,
});
// Only `proof` is posted. The key is not part of the request body.
```

- Sealing (`noteEncryption`) and note scanning.
- Wallet creation, restore, and local encrypted key storage.

### Forbidden server behavior (never build or call)

- ❌ Any endpoint taking `senderKey`, seed phrase, password, or viewing key.
- ❌ Server-side proof generation or server-held signing material.
- ❌ Uploading, cloud-backing-up, or server-syncing seeds or keys.
- ❌ Cross-device key sync through the backend.

This is the phishing pattern to reject: a "proof generation" API that takes
the user's key and returns a proof. The server has no reason to see the key.

## What agents must NOT do

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
