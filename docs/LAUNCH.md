# Kilnen — pre-launch plan & checklist

> **Reality check.** The repository is a Convex **simulation**: no Solana
> custody program, no RPC settlement, no audited circuit, no real relayer.
> Nothing here is production-ready. This document is the plan to *become*
> launchable, and an honest checklist of what is still open. Do not move real
> funds or sensitive data until every gate below is cleared.

---

## 1. Where the project actually is

| Area | State |
| --- | --- |
| Brand (name/ticker/colours) | ✅ Applied — `Kilnen` / `$KLN`, ember-on-obsidian theme |
| Auth (email OTP) + one-wallet-per-account | ✅ Working in simulation |
| Shielded notes, nullifiers, Merkle tree | ✅ Simulated; v2 ECDH encryption wired |
| Groth16 proving | ⚠️ Scaffold only — no circuit artifacts; server verifier rejects |
| Solana settlement | ⚠️ Scaffold only — `isSettlementLive() === false` |
| Privacy guarantee | ❌ Not real (v1 legacy notes are publicly decryptable) |
| Custody / audits / governance / legal | ❌ None |

## 2. Pre-launch plan (phased)

### Phase 0 — Brand & identity (days)
1. Register `kilnen.com` and the `@kilnen` X handle in the same sitting.
2. Take `t.me/kilnencommunity` and the `kilnen-labs` GitHub org.
3. Trademark search (classes 9 / 36 / 42) **before** spending on the brand.
4. Re-verify the `$KLN` ticker on mint day — listings change daily.
5. Confirm the `Glitch.ttf` font licence (non-commercial today) or swap it.

### Phase 1 — Protocol truth (weeks)
1. Specify the join-split statement, key derivation, ciphertext binding and
   public-signal authorization binding; review before coding.
2. Compile + constrain `circuits/solzk-joinsplit.circom`; run a multiparty
   phase-2 ceremony; publish artifact hashes.
3. Build/test the Anchor custody + verifier program (permanent nullifier PDAs,
   finalized-state checks, emergency pause).
4. Implement secure spend/view-separated encryption + stealth derivation and a
   reviewed migration off legacy v1 notes.
5. Wire RPC settlement behind `isSettlementLive()`; devnet first.

### Phase 2 — Security (weeks, parallel to Phase 1)
1. Two independent audits (crypto + program); publish issues + remediations.
2. Fix the dependency advisories in `docs/AUDIT.md`.
3. Threat-model review, adversarial testing, bug bounty funded.
4. Secret-handling review: keys never leave the device (already enforced).

### Phase 3 — Operations & governance (weeks)
1. 5-of-7 multisig + upgrade timelock; tested pause/recovery drill.
2. At least two independent signed-quote relayers with expiry + replay/domain
   protection and finalized receipts.
3. Monitoring: on-call, alerting on nullifier reuse, reserve drift, paused ops.
4. Funded insurance under a voted claim policy.

### Phase 4 — Legal & launch (weeks)
1. Jurisdiction-specific legal review (token, securities, privacy, custody).
2. Public audit reports + launch criteria published.
3. Mainnet deploy behind the multisig; capped launch limits; incident runbook.

## 3. Launch checklist

### Brand
- [x] Rename `SITE_NAME` → `Kilnen`, `TICKER` → `$KLN` (`src/lib/protocol.ts`)
- [x] Apply ember/obsidian tokens (`src/index.css`), retire Solana chrome
- [x] New annular-eclipse mark (`public/logo.svg`, `src/assets/logo.svg`)
- [x] Manifest + `<title>` / meta updated
- [ ] Register `kilnen.com` + `@kilnen`
- [ ] Trademark search (Classes 9/36/42)
- [ ] Re-verify `$KLN` ticker on mint day
- [ ] Resolve the `Glitch.ttf` commercial licence
- [ ] **Do not rename** `solzk-*` hash domains, the `SOLZK|` envelope prefix,
      `SOLZK-PAY|v1|`, or `solzk.*` storage keys — they are committed to hashes.

### Protocol & crypto
- [ ] Reviewed join-split circuit + trusted setup + artifact hashes
- [ ] Anchor custody/verifier program, permanent nullifiers, pause
- [ ] RPC settlement enabled and reconciled against reserves
- [ ] Secure spend/view encryption + stealth; migrate off legacy v1
- [ ] Historical-tree migration for pre-index notes
- [ ] Unit rescaling migration (1e8 legacy → 1e9 lamports) — never silent

### Security
- [ ] Two independent audits, issues published + fixed
- [ ] Dependency advisories remediated (see `docs/AUDIT.md`)
- [ ] Rate limiting / abuse controls on public mutations
- [ ] Admin bootstrap hardened (first-signup `claimFounder` race)
- [ ] Bug bounty funded; disclosure policy published
- [ ] Password policy strengthened (currently 8 chars min)

### Operations & governance
- [ ] 5-of-7 multisig + timelock; pause/recovery drill recorded
- [ ] ≥2 signed-quote relayers with replay/domain protection
- [ ] Monitoring + on-call + incident runbook
- [ ] Funded insurance under a voted claim policy
- [ ] Governance: real votes, not the current weight preview

### Legal & comms
- [ ] Legal review complete (token/custody/privacy)
- [ ] Public audit + launch-criteria page
- [ ] Status page + comms plan
- [ ] All "simulation" disclosures reviewed by counsel

## 4. Go / no-go gates (all must be true)

1. Audited circuit + published artifacts; server verifies real proofs.
2. Anchor program deployed under multisig; pause tested.
3. No open Critical/High audit findings.
4. Zero open Critical/High dependency advisories reachable at runtime.
5. RPC settlement reconciled; reserves match the ledger.
6. Legal sign-off; insurance funded.
7. Incident + rollback runbook rehearsed.

## 5. Rollback & incident

- **Pause:** `operations.setPaused(true)` freezes state-touching ops.
- **Rollback:** redeploy previous Convex functions; the schema is additive so
  no destructive migration is needed. RPC settlement can be disabled by
  clearing the settlement env so `isSettlementLive()` returns false.
- **Comms:** status page + X; state plainly if funds are at risk.
- **Post-mortem:** publish within 72h; track remediation to closure.
