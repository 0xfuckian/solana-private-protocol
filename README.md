# SOL-ZK

**A private ledger that settles on Solana.** Value moves as encrypted notes
carried inside ordinary transactions, proven correct by zero-knowledge
proofs. Solana orders the bytes; it never sees inside them.

This repository is the full protocol site and devnet simulation: mint,
shielded wallet, private market, liquidity vault, explorer, pay links,
private swap, multi-asset shield, stealth addresses, and ZK fee-share
claims — every mechanism of the design, runnable end to end.

> **No "404" strings appear anywhere in this project** — the ticker is
> `SOLZK` and the protocol name is SOL-ZK throughout.

---

## What is running

| Feature | Where | Mechanism |
| --- | --- | --- |
| Shielded notes | `/mint` → `/dashboard` | 24-word seed → spend key; commitments and AES-GCM sealed notes; nullifier double-spend protection |
| Mint with fees | `/mint` | Lots at 0.015/0.035 SOL; 5% fee split half vault depositors / half treasury; 95% becomes protocol liquidity |
| Private transfers | `/dashboard` | Spend notes by nullifier, seal new notes; 2% fee with burn-tier discounts; fee-in-note option (relayer paid from the note itself) |
| Signed order book | `/market` | Intents, not deposits; SOL leg escrowed and verified, shielded leg proven |
| Private swap | `/market` | Constant-product AMM over protocol reserves; both directions; 0.3% fee routed like every other fee |
| Private exit (redeem) | `/market` | Burn notes → SOL from the liquidity reserve; deflationary |
| Liquidity vault | `/vault` | Deposit notes as shares; pro-rata fee stream in SOL, claimable any time |
| Keeper buyback-and-burn | `/vault` | Treasury fee vault swept → SOLZK bought from liquidity → burned |
| Burn-to-discount tiers | `/dashboard` | Ember −25% / Onyx −50% / Obsidian −75%; permanent, public, supply-shrinking |
| View keys + view tags | `/dashboard` | IVK/OVK decrypt without spend authority; 1-byte tags prioritize scanning |
| Stealth addresses | `/dashboard` | Meta secret → fresh one-time address per payment; scan recognizes via (meta, nonce) re-derivation |
| Multi-asset shield | `/vault` | SPL assets (devnet: USDC, BONK, JUP) sealed into notes; shield/unshield flows |
| ZK fee-share claims | `/vault` | Prove holding at a past anchor; pro-rata payout from the claims pool; nullifier-bound |
| Association sets (ASP) | `/dashboard` | Public label registry; senders resolve payee labels; assertions, not verdicts |
| Pay links | `/pay` | Recipient+amount+memo in the URL `#fragment`; one-tap payment |
| Explorer | `/explorer` | Every byte the chain reveals — envelopes, proofs, burns, swaps, asset flows, fee vaults |

## Protocol constants

| Constant | Value | Note |
| --- | --- | --- |
| `TOTAL_SUPPLY` | 210,000,000 SOLZK | 10% of Solana's SOL base |
| `LOT_SIZE` | 10,000 | Minting unit; 21,000 lots total |
| Approved / open rate | 0.015 / 0.035 SOL per lot | Approved = whitelist-cleared |
| `MINT_FEE_BPS` | 500 | Half to vault depositors, half to treasury |
| `MARKET_FEE_BPS` | 200 | Also the transfer fee; tier-discountable |
| `SWAP_FEE_BPS` | 30 | AMM fee, same routing |
| `RELAYER_FEE_NOTE_TOKENS` | 25 SOLZK | Flat fee-in-note relayer fee |
| `REDEEM_LAMPORTS_PER_TOKEN` | 350 | Exit rate against liquidity |
| Envelope sizes | 934 B mint / 921 B transfer | Uniform — length leaks nothing |

## Architecture

```
Browser (trust root)                Convex backend ("the chain")
────────────────────                ───────────────────────────
src/lib/wallet.ts                   src/convex/
  seed → spend key                    protocol.ts   mint, transfers, burns,
  commitments (SHA-256)                             redeem, claims, shield
  sealed notes (AES-GCM)              swap.ts       private swap AMM
  nullifiers                          market.ts     order book + settlement
  view keys + tags                    vault.ts      shares + fee stream
  stealth addresses                   asp.ts        label registry
src/lib/useSolzk.ts                   notes.ts      pool queries
  scan: tag-match → stealth           users.ts      auth helpers
  → trial-decrypt                     schema.ts     tables + indexes
  balance = sum of unspent notes
```

**The node never learns ownership.** It stores commitments, ciphertexts and
nullifiers; the browser trial-decrypts the pool locally. Balances exist
only as the sum of notes your key opens.

**Fees route one way:** half of every fee (mint 5%, transfer/trade 2%,
swap 0.3%) goes to the vault fee pool for depositors; half to the treasury,
which the keeper converts to SOLZK and burns.

## Key files

- `src/lib/protocol.ts` — every constant, plus swap/quote math, tiers,
  pay-link codec, asset metadata. Shared verbatim by frontend and backend.
- `src/lib/wallet.ts` — the client cryptography: derivation, sealing,
  view tags, stealth addresses, proof commitments.
- `src/lib/useSolzk.ts` — the wallet hook: session, scanning, every action.
- `src/convex/protocol.ts` / `swap.ts` / `market.ts` / `vault.ts` — the
  ledger: proof verification, fee routing, reserves.
- `src/pages/*` — the product surface; `/protocol` is the living spec.

## Development

The project runs in a managed Freebuff environment (Vite + React 19 +
Tailwind v4 + shadcn/ui + Convex + Convex Auth). Package manager: **bun**.

```bash
# Regenerate Convex types + deploy backend functions
bun convex dev --once

# Typecheck
bun tsc -b --noEmit
```

Conventions:

- Backend changes require `bun convex dev --once` before frontend code that
  consumes new queries/mutations.
- Never edit `src/convex/_generated/*` — it is codegen.
- Auth is Convex Auth (email OTP); protected routes use `RequireAuth`.
- One wallet per account; the encrypted seed lives in `localStorage` and
  the password never leaves the device.

## Simulation notice

This is a **devnet simulation**: slots, confirmations, the AMM, asset
prices and the faucet are simulated for coherence and speed. The proof
system is a SHA-256 commitment scheme standing in for a real circuit; the
ledger discipline (uniform envelopes, nullifier uniqueness, commitments and
ciphertexts only) is real. Nothing here is financial advice or an offer of
securities.
