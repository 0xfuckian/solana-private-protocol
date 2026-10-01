import { Button } from "@/components/ui/button";
import { GradientBadge, SectionHeading } from "@/components/site/Stat";
import { SiteLayout } from "@/components/site/Layout";
import { api } from "@/convex/_generated/api";
import {
  APPROVED_MAX_LOTS,
  APPROVED_RATE_LAMPORTS,
  ENVELOPE_MINT_BYTES,
  ENVELOPE_TRANSFER_BYTES,
  LOT_SIZE,
  OPEN_MAX_LOTS,
  OPEN_RATE_LAMPORTS,
  TICKER,
  TOTAL_LOTS,
  TOTAL_SUPPLY,
  formatTokenAmount,
  lamportsToSol,
} from "@/lib/protocol";
import { currentSlot } from "@/lib/useSolzk";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  Gauge,
  KeyRound,
  Layers,
  Lock,
  ShieldCheck,
  Waves,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

function Hero() {
  const [slot, setSlot] = useState(0);
  useEffect(() => {
    setSlot(currentSlot());
    const t = setInterval(() => setSlot(currentSlot()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="bg-sol-glow relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
      />
      <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-20 sm:px-6 sm:pt-28">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-start gap-6"
        >
          <GradientBadge>
            <span className="size-1.5 rounded-full bg-primary sol-pulse" />
            Mint live · Slot {slot.toLocaleString()}
          </GradientBadge>

          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            A private ledger that{" "}
            <span className="text-sol-gradient sol-shimmer">
              settles on Solana
            </span>
          </h1>

          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Every ordinary Solana transaction is a public record of who paid
            whom and how much. {TICKER} keeps the settlement and drops the
            disclosure: value moves as encrypted notes inside ordinary
            transactions, proven correct by zero-knowledge proofs. Mint it,
            send it, deposit it, trade it — there is no exit to ordinary
            SOL, and that is the point.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              asChild
              size="lg"
              className="bg-sol-gradient text-[#04101a] font-semibold shadow-[0_0_28px_rgba(20,241,149,0.35)] hover:opacity-90"
            >
              <Link to="/mint">
                Mint {TICKER}
                <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/protocol">Read the protocol</Link>
            </Button>
          </div>

          <p className="text-xs leading-6 text-muted-foreground/80">
            No fork, no bridge, no custodian. Solana orders and timestamps the
            bytes; it never validates them and is never asked to. Your keys
            never leave your browser.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function LiveStats() {
  const state = useQuery(api.protocol.getState);
  const minted = state?.mintedTokens ?? 0;
  const pct = ((minted / TOTAL_SUPPLY) * 100).toFixed(2);

  return (
    <section className="border-y border-border/70 bg-card/40">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4">
        {[
          {
            label: "Supply minted",
            value: `${pct}%`,
            sub: `${formatTokenAmount(minted)} / ${formatTokenAmount(TOTAL_SUPPLY)} ${TICKER}`,
          },
          {
            label: "Ticker",
            value: TICKER,
            sub: `${formatTokenAmount(LOT_SIZE)} per lot`,
          },
          {
            label: "Open rate",
            value: `${lamportsToSol(OPEN_RATE_LAMPORTS)} SOL`,
            sub: `${lamportsToSol(APPROVED_RATE_LAMPORTS)} SOL approved`,
          },
          {
            label: "Lots",
            value: formatTokenAmount(TOTAL_LOTS),
            sub: "first come, first served",
          },
        ].map((s) => (
          <div key={s.label} className="py-8 pr-6">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {s.label}
            </p>
            <p className="mt-2 font-mono-tabular text-2xl font-semibold">
              {s.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const PREMISE = [
  {
    icon: EyeOff,
    title: "Nobody sees your balance",
    body: "Not other users, not the node, not anyone reading the chain. Your keys never leave your browser.",
  },
  {
    icon: Layers,
    title: "No new chain to trust",
    body: "Envelopes ride inside ordinary transactions. Solana orders the bytes; meaning is assigned by anyone who replays them under the same rules.",
  },
  {
    icon: Fingerprint,
    title: "Unlinkable by construction",
    body: "Commitments enter the pool; nullifiers retire them. Nothing on chain connects the two — only your key derives one from the other.",
  },
  {
    icon: ShieldCheck,
    title: "Uniform sizes",
    body: `Every transfer is exactly ${ENVELOPE_TRANSFER_BYTES} bytes, so length never leaks what happened. A mint is ${ENVELOPE_MINT_BYTES} — it carries the amount.`,
  },
];

function Premise() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
      <motion.div {...fadeUp}>
        <SectionHeading
          kicker="01 — Premise"
          title="Settlement without disclosure"
          description="Two independent indexers reading the same chain reach identical state — yet neither can say who owns what."
        />
      </motion.div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {PREMISE.map((p, i) => (
          <motion.div
            key={p.title}
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: i * 0.06 }}
            className="rounded-2xl border border-border/70 bg-card p-6 transition-colors hover:border-primary/30"
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <p.icon className="size-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold">{p.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {p.body}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Rates() {
  return (
    <section className="border-y border-border/70 bg-card/40">
      <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
        <motion.div {...fadeUp}>
          <SectionHeading
            kicker="02 — Rates & caps"
            title="What a lot costs"
            description={`${TICKER} is minted in lots of ${formatTokenAmount(LOT_SIZE)}. Two prices; caps are per wallet across every invoice you open.`}
          />
        </motion.div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <motion.div
            {...fadeUp}
            className="border-sol-gradient relative rounded-2xl p-[1px]"
          >
            <div className="h-full rounded-2xl bg-card p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Approved</h3>
                <GradientBadge>First 200 wallets</GradientBadge>
              </div>
              <p className="mt-4 font-mono-tabular text-3xl font-semibold text-primary">
                {lamportsToSol(APPROVED_RATE_LAMPORTS)} SOL
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / lot
                </span>
              </p>
              <ul className="mt-5 space-y-2.5 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-4 text-primary" />
                  Up to {APPROVED_MAX_LOTS} lots ·{" "}
                  {formatTokenAmount(APPROVED_MAX_LOTS * LOT_SIZE)} {TICKER}
                </li>
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-4 text-primary" />
                  Max spend {lamportsToSol(APPROVED_MAX_LOTS * APPROVED_RATE_LAMPORTS)} SOL
                </li>
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-4 text-primary" />
                  A price, not a guarantee — it does not reserve supply
                </li>
              </ul>
            </div>
          </motion.div>

          <motion.div {...fadeUp} className="rounded-2xl border border-border/70 bg-card p-6">
            <h3 className="text-lg font-semibold">Open</h3>
            <p className="mt-4 font-mono-tabular text-3xl font-semibold">
              {lamportsToSol(OPEN_RATE_LAMPORTS)} SOL
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / lot
              </span>
            </p>
            <ul className="mt-5 space-y-2.5 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 text-primary" />
                Up to {OPEN_MAX_LOTS} lots ·{" "}
                {formatTokenAmount(OPEN_MAX_LOTS * LOT_SIZE)} {TICKER}
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 text-primary" />
                Max spend {lamportsToSol(OPEN_MAX_LOTS * OPEN_RATE_LAMPORTS)} SOL
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 text-primary" />
                Minting is first come, first served until supply is gone
              </li>
            </ul>
          </motion.div>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Protocol limit: {formatTokenAmount(5_000_000)} {TICKER} per single
          mint. Approved is a price, not a reservation.
        </p>
      </div>
    </section>
  );
}

function FeeModel() {
  return (
    <section className="border-y border-border/70 bg-card/40">
      <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
        <motion.div {...fadeUp}>
          <SectionHeading
            kicker="03 — Fees & the vault"
            title="Fees flow to the people who provide liquidity"
            description="Half of every fee goes to the vault's depositors — exactly like transaction fees pay liquidity providers. The other half funds the protocol."
          />
        </motion.div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            {
              pct: "5%",
              title: "Mint fee",
              body: `Of the mint price. 2.5% to vault depositors, 2.5% to the treasury. The other 95% of every mint becomes protocol liquidity inside the vault.`,
            },
            {
              pct: "2%",
              title: "Transfer fee",
              body: "On every shielded transfer, split the same way: half to depositors, half to the treasury.",
            },
            {
              pct: "2%",
              title: "Market fee",
              body: "On every trade in the order book, split the same way. Depositors claim their share pro rata at any time.",
            },
          ].map((f, i) => (
            <motion.div
              key={f.title}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.06 }}
              className="rounded-2xl border border-border/70 bg-card p-6"
            >
              <p className="text-sol-gradient font-mono-tabular text-4xl font-semibold">
                {f.pct}
              </p>
              <h3 className="mt-3 text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {f.body}
              </p>
            </motion.div>
          ))}
        </div>
        <motion.p {...fadeUp} className="mt-8 text-xs leading-6 text-muted-foreground">
          The vault works like a liquidity pool: deposit {TICKER}, receive
          shares, earn fees pro rata, withdraw back to sealed notes. What it
          never does is hand you ordinary SOL — value that enters the
          shielded pool stays in it.
        </motion.p>
      </div>
    </section>
  );
}

const STAGES = [
  {
    n: "1",
    who: "you",
    title: "Create a wallet",
    body: "24 words, set a password. One seed produces both halves: your shielded balance and an ordinary devnet SOL address.",
  },
  {
    n: "2",
    who: "you",
    title: "Fund it",
    body: "Use the devnet faucet — a few SOL is plenty. Send a little more than the mint costs, for the network fee.",
  },
  {
    n: "3",
    who: "you",
    title: "Pay the invoice",
    body: "One click. A one-time deposit address belongs to that invoice alone — that is how the node knows the payment was yours.",
  },
  {
    n: "4",
    who: "chain",
    title: "3 confirmations",
    body: "About 12 seconds. Three slots is the point at which a payment is settled rather than merely seen.",
  },
  {
    n: "5",
    who: "browser",
    title: "Prove in browser",
    body: "The proof is built in your browser; the relayer publishes the envelope and pays the fee. Your SOL never sits in the same transaction as your envelope.",
  },
];

function MintFlow() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
      <motion.div {...fadeUp}>
        <SectionHeading
          kicker="04 — The mint, end to end"
          title="Five stages. You do three."
          description="Everything after the third confirmation happens on its own."
        />
      </motion.div>
      <div className="mt-12 grid gap-4 md:grid-cols-5">
        {STAGES.map((s, i) => (
          <motion.div
            key={s.n}
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: i * 0.05 }}
            className="rounded-2xl border border-border/70 bg-card p-5"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono-tabular text-2xl font-semibold text-sol-gradient">
                {s.n}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  s.who === "you"
                    ? "bg-primary/10 text-primary"
                    : "bg-[#9945FF]/15 text-[#c9b4ff]"
                }`}
              >
                {s.who}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-semibold">{s.title}</h3>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              {s.body}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function LedgerSection() {
  return (
    <section className="border-y border-border/70 bg-card/40">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
        <motion.div {...fadeUp}>
          <SectionHeading
            kicker="05 — What is public"
            title="Exactly what the chain reveals"
            description="A mint is the one moment value enters the pool, so the amount and ticker are public — supply has to be auditable. After that, nothing about your holdings or transfers is."
          />
          <div className="mt-8 grid gap-3">
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <Eye className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="text-sm">
                <p className="font-medium">Visible to everyone</p>
                <p className="mt-1 text-muted-foreground">
                  That an envelope occurred, and when · its size in bytes ·
                  opaque nullifiers and commitments · mint amounts and ticker
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="text-sm">
                <p className="font-medium">Never revealed</p>
                <p className="mt-1 text-muted-foreground">
                  Who owns a note · your balance at any time · sender and
                  receiver of a transfer · the amount transferred · which token
                  moved · which earlier note was spent
                </p>
              </div>
            </div>
          </div>
          <p className="mt-6 text-xs leading-6 text-muted-foreground">
            What still leaks: timing. Uniform sizes hide the contents, not the
            fact that a transaction happened.
          </p>
        </motion.div>

        <motion.div {...fadeUp} className="flex items-center">
          <div className="w-full rounded-2xl border border-border/70 bg-background p-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Waves className="size-4 text-primary" />
              The shielded pool
            </div>
            <div className="mt-4 space-y-2 font-mono-tabular text-xs">
              {[
                "note  →  commitment a3f9…c21b",
                "note  →  commitment 77e0…9d4a",
                "note  →  commitment f01c…e883",
                "spend →  nullifier   5b2e…10fa",
                "spend →  nullifier   c8ad…47de",
              ].map((line, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2.5"
                >
                  <span className="text-muted-foreground">{line}</span>
                  {line.startsWith("note") ? (
                    <span className="size-1.5 rounded-full bg-primary" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-[#9945FF]" />
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Your balance is computed in your browser. The commitment enters
              the pool; the nullifier retires it. Nothing on chain connects
              the two.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

const ROADMAP = [
  {
    title: "Shielded pool + mint",
    status: "shipped",
    body: "Live on the devnet simulation. Encrypted notes, nullifiers, browser-built proofs, relayer settlement.",
  },
  {
    title: "Order book",
    status: "shipped-at-sellout",
    body: "Opens when the mint sells out. Signed limit orders settled in SOL with no custody at any point.",
  },
  {
    title: "Vault (launchpad)",
    status: "shipped",
    body: `Anyone can deploy a shielded token — a ticker, a cap, a per-mint limit — published as an envelope like any other.`,
  },
  {
    title: "Fee sharing",
    status: "intended",
    body: "The market charges 2%. The workable shape is a zero-knowledge claim: prove you held at a past anchor without revealing who you are. A real circuit, not a configuration change.",
  },
];

function Roadmap() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
      <motion.div {...fadeUp}>
        <SectionHeading
          kicker="06 — After the mint"
          title="What comes next"
          description="Two things are built and running; the rest is stated as direction, not promise. Price what is running now."
        />
      </motion.div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {ROADMAP.map((r, i) => (
          <motion.div
            key={r.title}
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: i * 0.05 }}
            className="rounded-2xl border border-border/70 bg-card p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold">{r.title}</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                  r.status === "intended"
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {r.status === "intended"
                  ? "intended"
                  : r.status === "shipped-at-sellout"
                    ? "opens at sellout"
                    : "shipped"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {r.body}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const FAQ = [
  {
    q: "I paid but nothing happened.",
    a: "Payments need three confirmations, roughly 12 seconds on the devnet simulation. The page shows the count as it climbs.",
  },
  {
    q: "I closed the tab mid-mint.",
    a: "Nothing is lost. The proof is built in your browser, so the final step needs the page open — reopen the mint page with the same wallet and it picks the unfinished purchase back up.",
  },
  {
    q: "Can I mint from an exchange withdrawal?",
    a: "The devnet faucet replaces funding here; on mainnet the exact amount must reach the invoice's one-time address before it expires. Paying from your own wallet is safer.",
  },
  {
    q: "I lost my password.",
    a: "Restore from your 24 words and set a new one. Without the words, nothing can be recovered — by anyone.",
  },
];

function Faq() {
  return (
    <section className="border-t border-border/70 bg-card/40">
      <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
        <motion.div {...fadeUp}>
          <SectionHeading
            kicker="07 — Troubleshooting"
            title="Common questions"
          />
        </motion.div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {FAQ.map((f, i) => (
            <motion.div
              key={f.q}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.04 }}
              className="rounded-2xl border border-border/70 bg-card p-6"
            >
              <p className="text-sm font-semibold">{f.q}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {f.a}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="bg-sol-glow">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6">
        <motion.div {...fadeUp} className="flex flex-col items-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-sol-gradient shadow-[0_0_36px_rgba(20,241,149,0.4)]">
            <KeyRound className="size-6 text-[#04101a]" />
          </div>
          <h2 className="mt-6 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
            The mint is open.{" "}
            <span className="text-sol-gradient">Supply is not infinite.</span>
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground sm:text-base">
            {formatTokenAmount(TOTAL_SUPPLY)} {TICKER}.{" "}
            {formatTokenAmount(TOTAL_LOTS)} lots. When it's gone, the market
            opens and the mint never comes back.
          </p>
          <Button
            asChild
            size="lg"
            className="mt-8 bg-sol-gradient font-semibold text-[#04101a] shadow-[0_0_28px_rgba(20,241,149,0.35)] hover:opacity-90"
          >
            <Link to="/mint">
              Create your wallet
              <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <SiteLayout>
      <Hero />
      <LiveStats />
      <Premise />
      <Rates />
      <FeeModel />
      <MintFlow />
      <LedgerSection />
      <Roadmap />
      <Faq />
      <FinalCta />
    </SiteLayout>
  );
}
