# Kilnen — security review & penetration-test report

**Date:** 2026-10-02
**Scope:** `src/` (React/Vite client + Convex backend), `index.html`, PWA
manifest, build/dependency surface.
**Method:** static review, auth/authz trace, secret-flow tracing, input-boundary
review, dependency audit (`bun audit`), and the existing unit/integration suite.
**Posture:** the target is a **simulation**. Findings below that concern real
privacy or custody are *design blockers*, not bugs to patch in a sprint.

---

## Executive summary

No server-side secret exfiltration, no open redirect, no auth bypass, and no
unauthenticated mutation were found. All Convex mutations require an
authenticated user and every admin action is role-gated. Keys are generated
in-browser and never transmitted (verify-only server contract).

The dominant risk is **not** code hygiene — it is that the cryptography is a
simulation. Proofs are forgeable, legacy v1 notes are publicly decryptable, and
the Groth16 verifier is a scaffold that rejects. Until the audited circuit and
Anchor program exist, no real value may touch this system.

| Severity | Count | Blocking mainnet? |
| --- | --- | --- |
| Critical | 3 | Yes |
| High | 3 | Yes |
| Medium | 5 | Mostly |
| Low / Info | 4 | No |

## Findings

### CRITICAL

**F-01 — Forgeable spend authorization (client-declared proofs)**
Evidence: `src/lib/wallet.ts` `buildProof` (SHA-256 of a statement string);
verifiers in `src/convex/protocol.ts`, `market.ts`, `swap.ts`, `vault.ts`,
`staking.ts`, `payroll.ts` recompute the same hash. The spend key never signs
anything and input totals are client-declared.
Impact: anyone can forge ownership/value/conservation; the simulated endpoints
are unsafe for real funds.
Status: **Open (by design).** Fix = implemented + audited join-split circuit.

**F-02 — Legacy v1 note encryption is publicly decryptable**
Evidence: `src/lib/wallet.ts` v1 note key derived from public address +
ephemeral data; `docs/THREAT_MODEL.md` documents it.
Impact: anyone with a shielded address can decrypt that address's v1 notes,
forever. AES-GCM integrity does not restore confidentiality.
Status: **Mitigated for new notes** (v2 ECDH P-256 + HKDF + AES-GCM-256 when a
viewing key is published). **Open for legacy v1** — needs a reviewed migration.

**F-03 — No real authorization binding in the server verifier**
Evidence: `src/convex/groth16.ts` always rejects; `src/lib/groth16.ts` requires
externally supplied wasm/zkey/vkey that are not shipped.
Impact: no server-side proof of ownership, conservation, asset-ID or
nullifier derivation exists yet.
Status: **Open (scaffold).**

### HIGH

**F-04 — Admin bootstrap race (`claimFounder`)**
Evidence: `src/convex/whitelist.ts` grants `role: "admin"` to the first account
created on the deployment.
Impact: on a fresh deployment anyone who signs up first becomes admin and can
pause, reset, or review. Acceptable in dev, unsafe for launch.
Status: **Open.** Recommend restricting to a configured founder identity
(e.g. matching email from deployment env) and claiming it before launch.

**F-05 — No rate limiting / abuse controls**
Evidence: public mutations (`registerWallet`, `openInvoice`, pay-link/payroll
submission) have no per-account or per-IP throttling.
Impact: spam ledger growth (cost/DoS), noisy events, faucet abuse.
Status: **Open.** Add per-account quotas + anomaly alerts.

**F-06 — Dependency advisories reachable at runtime**
Evidence: `bun audit` → 45 vulnerabilities (1 critical, 26 high). Triage:
- `axios` (High: ReDoS, prototype-pollution gadget, SSRF via redirects) is used
  in `src/convex/auth/emailOtp.ts` → **reachable**, upgrade required.
- `hono` (direct dep, several moderate advisories) is **not imported** in
  `src/` → remove or upgrade; verify no Vly tooling depends on the pinned
  version.
- `Auth.js` critical homoglyph-`@` advisory → confirm whether `@auth/core` is
  reachable through `@convex-dev/auth`'s email path; if so, upgrade.
- `browserslist` / `brace-expansion` / `js-yaml` / `underscore` / `postcss` →
  **dev/transitive**, not shipped to the runtime bundle.
Status: **Open.** Upgrade `axios`; remove/upgrade `hono`; confirm Auth.js.

### MEDIUM

**F-07 — Weak local key-encryption password policy**
Evidence: `src/pages/Mint.tsx` enforces only `password.length >= 8`.
Impact: offline brute-force of the local `localStorage` seed blob is cheap if a
user picks a weak password (PBKDF2-SHA256, 120k iterations).
Status: **Open.** Raise minimum, add strength feedback / passphrase guidance.

**F-08 — `dangerouslySetInnerHTML` in chart component**
Evidence: `src/components/ui/chart.tsx` injects CSS via `<style>`. Values come
from static config, not user input.
Impact: low; would require attacker-controlled chart config.
Status: **Accepted** (shadcn scaffold). Revisit if charts ever take user input.

**F-09 — CSV export / import formula-injection**
Evidence: `src/pages/Payroll.tsx` exports request links; memo text is
attacker-influenceable. Spreadsheet apps may execute a memo beginning with
`=`, `+`, `-`, or `@`.
Impact: low (client-side download the user opens locally).
Status: **Open.** Prefix such cells with `'` on export.

**F-10 — Legacy unit scale not migrated**
Evidence: legacy accounting uses 1e8 units/SOL while Solana uses 1e9 lamports;
`docs/THREAT_MODEL.md` documents no silent rescale.
Impact: any RPC integration without a versioned migration would misvalue funds.
Status: **Open.** Needs a reviewed migration before settlement.

**F-11 — Repository secret hygiene**
Evidence: `.gitignore` ignores only `.env.local`.
Impact: a committed `.env` or key file would leak credentials.
Status: **Open.** Broaden ignores; add a pre-commit secret scan.

### LOW / INFORMATIONAL

**F-12 — Pay links are unauthenticated** (by design — URL-fragment requests,
never bearer claims).
**F-13 — `walletId` persisted in `localStorage`** (no secret; acceptable).
**F-14 — No secret material is logged** (verified: no `console.*` of
seed/password/key).
**F-15 — Open-redirect handled correctly**: `src/pages/Auth.tsx` accepts
`returnTo` only when it starts with `/` and not `//`.

## Controls verified good

- Every Convex mutation calls `requireUserId`; admin ops check `role`.
- `resetSimulation`, `setPaused`, `reviewApplication`, `setWhitelistOpen` are
  admin-only.
- Keys never leave the device; server contract is verify-only (`docs/TERMIX.md`).
- No `eval`, `new Function`, `child_process`, `document.write`, or user HTML
  injection in app code.
- Integer-safety helpers (`assertUnits`, `mulDivFloor`) guard arithmetic.
- Nullifiers are permanent; duplicate commitments rejected.

## Fixed during this review

- **Brand rebrand** (Kilnen/$KLN + ember theme) applied without touching any
  hash domain, storage key, or wire format.
- **Testing reset** added (`operations.resetSimulation`) — admin-only, so
  state can be zeroed for tests without a redeploy; self-gated.
- **Key-custody documentation** made explicit across `docs/`.

## Method & limitations

Testing was static + suite-based; no live network exploitation, no fuzzing
harness, and no browser visual verification were available in this environment.
The dependency triage classifies by reachability but did not exploit any
advisory. This is an internal pre-audit, **not** a substitute for the two
independent third-party audits required before mainnet.
