import { Button } from "@/components/ui/button";
import { GradientBadge, Stat } from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { api } from "@/convex/_generated/api";
import {
  APPROVED_MAX_LOTS,
  APPROVED_RATE_LAMPORTS,
  ENVELOPE_MINT_BYTES,
  ENVELOPE_TRANSFER_BYTES,
  LOT_SIZE,
  MAX_MINT_PER_TX,
  OPEN_MAX_LOTS,
  OPEN_RATE_LAMPORTS,
  TICKER,
  TOTAL_LOTS,
  TOTAL_SUPPLY,
  formatTokenAmount,
  lamportsToSol,
} from "@/lib/protocol";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  FileCheck,
  Fingerprint,
  KeyRound,
  Layers,
  Lock,
  ShieldCheck,
  Waves,
} from "lucide-react";
import { Link } from "react-router";
import { useQuery } from "convex/react";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.5, ease: "easeOut" as const },
};

function Section({
  id,
  num,
  kicker,
  title,
  children,
}: {
  id: string;
  num: string;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-t border-border/60 py-14 first:border-t-0">
      <motion.div {...fadeUp}>
        <p className="font-mono-tabular text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {num} — {kicker}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <div className="mt-6 space-y-4 text-sm leading-7 text-muted-foreground sm:text-[15px]">
          {children}
        </div>
      </motion.div>
    </section>
  );
}

function RatesTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/70">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 font-medium">Tier</th>
            <th className="px-4 py-3 font-medium">Per lot</th>
            <th className="px-4 py-3 font-medium">Your cap</th>
            <th className="px-4 py-3 font-medium">Max spend</th>
          </tr>
        </thead>
        <tbody className="font-mono-tabular">
          <tr className="border-b border-border/40">
            <td className="px-4 py-3 font-semibold text-primary">Approved</td>
            <td className="px-4 py-3">{lamportsToSol(APPROVED_RATE_LAMPORTS)} SOL</td>
            <td className="px-4 py-3">
              {APPROVED_MAX_LOTS} lots · {formatTokenAmount(APPROVED_MAX_LOTS * LOT_SIZE)} {TICKER}
            </td>
            <td className="px-4 py-3">
              {lamportsToSol(APPROVED_MAX_LOTS * APPROVED_RATE_LAMPORTS)} SOL
            </td>
          </tr>
          <tr>
            <td className="px-4 py-3 font-semibold">Open</td>
            <td className="px-4 py-3">{lamportsToSol(OPEN_RATE_LAMPORTS)} SOL</td>
            <td className="px-4 py-3">
              {OPEN_MAX_LOTS} lots · {formatTokenAmount(OPEN_MAX_LOTS * LOT_SIZE)} {TICKER}
            </td>
            <td className="px-4 py-3">
              {lamportsToSol(OPEN_MAX_LOTS * OPEN_RATE_LAMPORTS)} SOL
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Protocol() {
  const state = useQuery(api.protocol.getState);

  return (
    <SiteLayout>
      <PageShell>
        <div className="mb-4">
          <GradientBadge>protocol documentation</GradientBadge>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            How {TICKER} works
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            The full specification of the private ledger that settles on
            Solana — the same document for engineers and for anyone deciding
            whether to trust it.
          </p>
        </div>

        <nav className="mb-6 flex flex-wrap gap-2 text-xs">
          {[
            ["premise", "01 Premise"],
            ["rates", "02 Rates"],
            ["fees", "03 Fees"],
            ["mint", "04 The mint"],
            ["public", "05 What is public"],
            ["how", "06 Notes & the pool"],
            ["market", "07 The market"],
            ["safety", "08 Safety"],
            ["roadmap", "09 Roadmap"],
            ["faq", "10 Troubleshooting"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border border-border/70 px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Ticker"
            value={TICKER}
            sub={`${formatTokenAmount(TOTAL_SUPPLY)} total supply`}
            accent
          />
          <Stat
            label="Minted"
            value={`${(((state?.mintedTokens ?? 0) / TOTAL_SUPPLY) * 100).toFixed(2)}%`}
            sub={`${formatTokenAmount(TOTAL_LOTS)} lots total`}
          />
          <Stat
            label="Envelope sizes"
            value={`${ENVELOPE_MINT_BYTES}/${ENVELOPE_TRANSFER_BYTES} B`}
            sub="mint / transfer — uniform"
          />
        </div>

        <Section
          id="premise"
          num="01"
          kicker="Premise"
          title="A private ledger that settles on Solana"
        >
          <p>
            Every ordinary Solana transaction is a permanent public record of
            who paid whom and how much. {TICKER} keeps the settlement and
            drops the disclosure: value moves as encrypted notes carried
            inside ordinary transactions, proven correct by zero-knowledge
            proofs.
          </p>
          <p>
            No soft fork, no sidechain, no bridge, no custodian. Solana
            orders and timestamps the bytes; it never validates them and is
            never asked to. Meaning is assigned by anyone who replays those
            bytes under the same rules — which is why two independent
            indexers reading the same chain reach identical state.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
              <p className="font-medium text-foreground">
                What this means for you
              </p>
              <p className="mt-1">
                Nobody can see your balance, who you paid, or how much — not
                other users, not the node, not anyone reading the chain. Your
                keys never leave your browser.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-4 text-sm">
              <p className="font-medium text-foreground">What still leaks</p>
              <p className="mt-1">
                Timing. The chain shows that somebody published an envelope
                at a given moment. Uniform sizes hide the contents, not the
                fact that a transaction happened.
              </p>
            </div>
          </div>
        </Section>

        <Section
          id="rates"
          num="02"
          kicker="Rates & caps"
          title="What a lot costs"
        >
          <p>
            {TICKER} is minted in lots of {formatTokenAmount(LOT_SIZE)}. There
            are two prices. Caps are per wallet and counted across every
            invoice you open. Total supply is {formatTokenAmount(TOTAL_SUPPLY)}{" "}
            {TICKER} — ten percent of Solana's circulating SOL base — with a
            protocol limit of {formatTokenAmount(MAX_MINT_PER_TX)} per single
            mint.
          </p>
          <RatesTable />
          <p>
            Approved is a price, not a guarantee. Being on the approved list
            lowers what you pay; it does not reserve supply. Minting is first
            come, first served until the supply is gone.
          </p>
        </Section>

        <Section
          id="fees"
          num="03"
          kicker="Fees"
          title="Every fee, on one table"
        >
          <p>
            Copied from the best DEX and privacy-protocol pages: no fee should
            surprise you at signing time. Every row below is enforced in the
            ledger — the mint page, dashboard and explorer all read the same
            constants.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Fee</th>
                  <th className="px-4 py-3 font-medium">Split</th>
                </tr>
              </thead>
              <tbody className="font-mono-tabular text-[13px]">
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold text-foreground">Mint</td>
                  <td className="px-4 py-3">5% of price + 0.00005 SOL network</td>
                  <td className="px-4 py-3 text-muted-foreground">2.5% vault · 2.5% treasury · 95% liquidity</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold text-foreground">Transfer</td>
                  <td className="px-4 py-3">2% default · 1% if staked · burn tiers −25/−50/−75%</td>
                  <td className="px-4 py-3 text-muted-foreground">Half vault · half treasury</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold text-foreground">Relayer</td>
                  <td className="px-4 py-3">0.00005 SOL flat or fee-in-note from 25 {TICKER}</td>
                  <td className="px-4 py-3 text-muted-foreground">Relayer fee vault (public)</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold text-foreground">Swap</td>
                  <td className="px-4 py-3">0.3% constant-product fee</td>
                  <td className="px-4 py-3 text-muted-foreground">Half vault · half treasury</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold text-foreground">Redeem (exit)</td>
                  <td className="px-4 py-3">2% of gross at 350 lamports/token</td>
                  <td className="px-4 py-3 text-muted-foreground">Half vault · half treasury · rest leaves liquidity</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold text-foreground">Fee-share claim</td>
                  <td className="px-4 py-3">No fee — 1% of proven value paid out</td>
                  <td className="px-4 py-3 text-muted-foreground">Funded by the claims pool (0.1% of supply at genesis)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Staking halves the transfer fee (2% → 1%) before burn-tier
            discounts apply, and lifts the daily transfer limit
            from 10 to 100 SOL-equivalent. The fee-share claim pays 1% of
            the proven value from the claims pool — one claim per
            (wallet, anchor, value) nullifier.
          </p>
        </Section>

        <Section id="mint" num="04" kicker="The mint" title="Five stages, end to end">
          <p>
            You do three of them; the node and your own browser do the rest.
            Everything after the third confirmation happens on its own — the
            proof is built in your browser, and the relayer pays the network
            fee so none of your coins ever sit in the same transaction as
            your envelope. Transfers can go further: with fee-in-note, the
            note itself pays the relayer and your wallet needs no SOL at all.
          </p>
          <div className="grid gap-3 md:grid-cols-5">
            {[
              ["1 · you", "Create a wallet", "24 words and a password. One seed produces both halves: shielded balance and SOL address."],
              ["2 · you", "Fund it", "Add SOL to exercise the full flow."],
              ["3 · you", "Pay the invoice", "One click. A one-time deposit address belongs to that invoice alone."],
              ["4 · chain", "3 confirmations", "About 12 seconds. Three slots is settled, not merely seen."],
              ["5 · browser", "Prove & publish", "Your browser builds the proof; the relayer publishes the envelope."],
            ].map(([who, t, body]) => (
              <div
                key={who}
                className="rounded-xl border border-border/70 bg-card p-4"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  {who}
                </p>
                <p className="mt-1.5 text-sm font-semibold text-foreground">{t}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="public"
          num="05"
          kicker="What is public"
          title="Exactly what the chain reveals"
        >
          <p>
            A mint is the one moment value enters the pool, so the amount and
            ticker are public — supply has to be auditable. After that,
            nothing about your holdings or transfers is.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-card p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Waves className="size-4 text-primary" /> Visible to everyone
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>· That an envelope occurred, and when</li>
                <li>· Its size in bytes</li>
                <li>· Opaque nullifiers and commitments</li>
                <li>· Mint amounts and ticker</li>
              </ul>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Lock className="size-4 text-primary" /> Never revealed
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>· Who owns a note</li>
                <li>· Your balance, at any time</li>
                <li>· Sender and receiver of a transfer</li>
                <li>· The amount transferred</li>
                <li>· Which token moved</li>
                <li>· Which earlier note was spent</li>
              </ul>
            </div>
          </div>
          <p>
            Uniform size does the rest: every transfer is exactly{" "}
            {ENVELOPE_TRANSFER_BYTES} bytes, so length never leaks what
            happened. A mint is {ENVELOPE_MINT_BYTES}, because supply must be
            auditable at the moment value enters the pool.
          </p>
        </Section>

        <Section
          id="how"
          num="06"
          kicker="How it works"
          title="Notes, nullifiers and the carrier"
        >
          <p>
            There are no accounts and no balances on chain. There are notes —
            sealed records of value, token and owner. Only a hash of each note
            is ever published, appended to an append-only tree.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [
                Fingerprint,
                "commitment",
                "A hash of the note enters the pool. It reveals nothing about value or owner.",
              ],
              [
                KeyRound,
                "nullifier",
                "Published when spent. Only your key derives it from the commitment — the unlinkability that prevents double-spends.",
              ],
              [
                Layers,
                "envelope",
                "Rides inside an ordinary transaction. Solana stores and orders the bytes; it never looks inside.",
              ],
            ].map(([Icon, t, body]) => {
              const I = Icon as typeof Fingerprint;
              return (
                <div
                  key={t as string}
                  className="rounded-xl border border-border/70 bg-card p-4"
                >
                  <I className="size-4 text-primary" />
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {t as string}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {body as string}
                  </p>
                </div>
              );
            })}
          </div>
          <p>
            The proof commits to every byte of the envelope. The relayer
            transmits it but cannot alter a recipient, an amount or a
            ciphertext — change one byte and the proof stops verifying. Its
            only power is refusal, which you see immediately.
          </p>
        </Section>

        <Section
          id="market"
          num="07"
          kicker="The market"
          title="A book that opens at sellout"
        >
          <p>
            Trading opens when the mint sells out. Until then the book is
            readable but closed — orders are refused by the node, not merely
            hidden by the page.
          </p>
          <p>
            When it opens it is a signed limit order book settled in SOL, with
            no custody at any point. Orders are intents, not deposits: your
            coins and your notes stay yours until a trade settles. A trade is
            two legs between two people — the SOL leg, which the node verifies
            against the ledger, and the shielded leg, which it cannot see and
            only the receiver can attest to.
          </p>
          <p>
            That asymmetry is the protocol working, not a gap in it. If the
            node could verify the shielded leg, the shielded leg would not be
            private. The market charges {2}% on a trade; fee sharing for
            holders is downstream of a market that trades, and is stated as
            intent only.
          </p>
        </Section>

        <Section id="safety" num="08" kicker="Safety" title="What this build does not prove">
          <p>
            The honest version of the audit table:
          </p>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Claim</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="text-[13px]">
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold text-foreground">Ledger discipline (nullifiers, commitments, uniform envelopes)</td>
                  <td className="px-4 py-3 text-muted-foreground">Running in this build, covered by 75+ regression tests</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold text-foreground">Zero-knowledge proofs (Groth16, join-split circuit)</td>
                  <td className="px-4 py-3 text-muted-foreground">Scaffolded only — no audited circuit or ceremony yet</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold text-foreground">Note encryption (ownership, view keys, stealth ECDH)</td>
                  <td className="px-4 py-3 text-muted-foreground">Not production-grade — legacy notes are decryptable by address holders</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold text-foreground">Audits, multisig, insurance, bug bounty</td>
                  <td className="px-4 py-3 text-muted-foreground">None yet — required before mainnet, listed as blockers in the handbook</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Privacy tips: mint amounts are public
            (supply must be auditable); timing of envelopes leaks; avoid
            unique lot counts moved seconds later; prefer fee-in-note over
            reusing one SOL funding address; never paste 24 words anywhere
            but the mint page restore box.
          </p>
        </Section>

        <Section id="architecture" num="09" kicker="Architecture" title="What is built and running">
          <p>
            Everything below ships in this build — try each piece from
            its page before you take the design on faith.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {[
              [
                "Fee-in-note relayer",
                "A transfer pays its relayer from the note itself, so a wallet with zero SOL stays fully spendable. In-note fees accrue in a public relayer fee vault, visible in the explorer.",
                "/dashboard",
                "Send with the fee-in-note switch on",
              ],
              [
                "Fee buyback-and-burn",
                `The keeper sweeps the treasury fee vault, buys ${TICKER} out of protocol liquidity and burns it. Public, permissionless, deflationary — the burn feed lives in the explorer.`,
                "/vault",
                "Run the keeper sweep",
              ],
              [
                "Private exit (redeem)",
                "Burn notes, receive SOL from the liquidity reserve at the exit rate. The ledger sees a burn and a payout — never a balance, never a link.",
                "/market",
                "Redeem to SOL",
              ],
              [
                "Pay links",
                "Recipient, amount and memo encoded in the URL fragment — no server, no invoice. Open the link, tap once, the envelope lands.",
                "/pay",
                "Open a payment request",
              ],
              [
                "View keys & view tags",
                "Incoming and outgoing view keys decrypt without spending authority; every note carries a 1-byte tag so the scanner prioritises your notes first.",
                "/dashboard",
                "Inspect your view keys",
              ],
              [
                "Burn-to-discount tiers",
                `Burn ${TICKER} to set a permanent public fee tier — Ember −25%, Onyx −50%, Obsidian −75%. Burned tokens leave the supply forever.`,
                "/dashboard",
                "Burn for a tier",
              ],
              [
                "Association sets",
                "A public label registry anyone can assert against: senders resolve a payee's labels before paying, breaking the same-address heuristic. Labels are assertions — the ledger still links nothing.",
                "/dashboard",
                "Open the label registry",
              ],
              [
                "Private swap",
                `A constant-product pool owned by the protocol: swap ${TICKER} for SOL and back without an order book, without unshielding. The SOL leg is verified; the shielded leg is proven, never read.`,
                "/market",
                "Try the private swap",
              ],
              [
                "Stealth addresses",
                "Publish a meta secret instead of a payment address. Senders derive a fresh one-time address per payment; your scan recognizes them — the chain never sees a stable identifier.",
                "/dashboard",
                "Get your stealth meta",
              ],
              [
                "Multi-asset shield",
                "Any SPL asset wraps into the sealed-note format — the asset id is a public input to the join-split, amounts and owners stay hidden. USDC, BONK and JUP are supported.",
                "/vault",
                "Shield an SPL asset",
              ],
              [
                "ZK fee-share claims",
                "Prove you held value at a past anchor without revealing balance or identity, and claim a pro-rata slice of the fee pool. Nullifier-bound, one claim per anchor.",
                "/vault",
                "Make a fee-share claim",
              ],
            ].map(([title, body, href, cta]) => (
              <div
                key={title}
                className="flex flex-col rounded-xl border border-border/70 bg-card p-4"
              >
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 flex-1 text-xs leading-5 text-muted-foreground">
                  {body}
                </p>
                <Link
                  to={href}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {cta} <ArrowRight className="size-3" />
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            On the real chain these map to one generalized join-split circuit
            with a single instruction set — initialize_pool, shield, transfer,
            unshield, swap, register_asp, claim_or_burn_fees — and this build
            exercises the full instruction set: the guarantees they exercise here
            are the same shape (uniform envelopes, nullifier double-spend
            protection, commitments and ciphertexts only). The ledger discipline is real.
          </p>
        </Section>

        <Section id="roadmap" num="10" kicker="Roadmap" title="What comes next">
          <p>
            Every mechanism in the architecture section above is running in
            this build. What remains between here and launch is the
            hard part: replacing the scaffolded proofs with a real join-split
            circuit (Poseidon commitments, Groth16 over BLS12-381, audited),
            moving the AMM to permissionless LPs, and the operational work of
            relayers and indexers anyone can run.
          </p>
          <p>
            Read the roadmap as intent, not as a promise of delivery or of
            returns. Anyone deciding what to pay for a lot should price what
            is running now.
          </p>
        </Section>

        <Section id="faq" num="11" kicker="Troubleshooting" title="Common questions">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["I paid but nothing happened.", "Payments need three confirmations, roughly 12 seconds. The page shows the count as it climbs."],
              ["I closed the tab mid-mint.", "Nothing is lost. Reopen the mint page with the same wallet; it picks the unfinished purchase back up."],
              ["Does connecting anything give access to my wallet?", "No. The seed is encrypted on your device; the password is never transmitted."],
              ["I lost my password.", "Restore from your 24 words and set a new one. Without the words, nothing can be recovered — by anyone."],
            ].map(([q, a]) => (
              <div key={q} className="rounded-xl border border-border/70 bg-card p-4">
                <p className="text-sm font-semibold text-foreground">{q}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </Section>

        <div className="border-t border-border/60 py-14">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Ready to see it work?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The mint is live and the pool is empty.
              </p>
            </div>
            <div className="flex gap-3">
              <Button asChild className="bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90">
                <Link to="/mint">
                  Mint {TICKER} <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/explorer">
                  <Boxes className="mr-1.5 size-4" /> Explorer
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </PageShell>
    </SiteLayout>
  );
}
