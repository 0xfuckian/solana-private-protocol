import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useSolzk } from "@/lib/solzk-context";
import {
  APPROVED_MAX_LOTS,
  APPROVED_RATE_LAMPORTS,
  LOT_SIZE,
  OPEN_RATE_LAMPORTS,
  SITE_NAME,
  TICKER,
  formatTokenAmount,
  hexHashOf,
  lamportsToSol,
} from "@/lib/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SectionHeading, GradientBadge } from "@/components/site/Stat";
import {
  BadgeCheck,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";

const ANNOUNCE_URL = "https://x.com/solzk/status/1974000000000000000";

/**
 * Minimal chrome for the standalone application page: brand mark, phase
 * badge, and a sign-in/out button. No site nav — the whitelist page is the
 * only page until the founder opens the whitelist.
 */
function WhitelistChrome() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-sol-gradient">
            <Lock className="size-4 text-[#04101a]" strokeWidth={2.5} />
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-foreground font-display">
            {SITE_NAME}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-400 sm:inline-flex">
            <span className="size-1.5 rounded-full bg-amber-400 sol-pulse" />
            pre-launch · whitelist phase
          </span>
          {user ? (
            <Button variant="outline" size="sm" onClick={async () => {
              await signOut();
              navigate("/whitelist");
            }}>
              Sign out
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/auth?returnTo=%2Fwhitelist")}
            >
              Sign in to apply
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Access card — the SOL-ZK clearance card: dark terminal frame, big gradient
// mark, mono rows, barcode, pixel block.
// ---------------------------------------------------------------------------

function barcodeBars(id: string): number[] {
  let acc = 0;
  for (let i = 0; i < id.length; i++) acc = (acc * 31 + id.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < 44; i++) {
    acc = (acc * 1103515245 + 12345) >>> 0;
    bars.push((acc >>> 16) % 4);
  }
  return bars;
}

/** Deterministic pixel block — the card's "sealed" visual fingerprint. */
function pixelCells(seed: string): boolean[] {
  let acc = 0;
  for (let i = 0; i < seed.length; i++) acc = (acc * 131 + seed.charCodeAt(i)) >>> 0;
  const cells: boolean[] = [];
  for (let i = 0; i < 100; i++) {
    acc = (acc * 1103515245 + 12345) >>> 0;
    cells.push((((acc >>> 16) % 100) & 1) === 0 ? ((acc >>> 8) & 1) === 1 : i % 3 === 0);
  }
  return cells;
}

export function AccessCard({
  walletAddress,
  handle,
  approved,
  pending,
  className,
}: {
  walletAddress: string;
  handle: string;
  approved: boolean;
  pending: boolean;
  className?: string;
}) {
  const cardId = useMemo(() => {
    const h = hexHashOf(`solzk-access:${walletAddress}`);
    return `${h.slice(0, 4).toUpperCase()}-${h.slice(4, 12).toUpperCase()}`;
  }, [walletAddress]);
  const commit = useMemo(() => hexHashOf(`solzk-commit:${walletAddress}`), [walletAddress]);
  const bars = useMemo(() => barcodeBars(cardId), [cardId]);
  const cells = useMemo(() => pixelCells(walletAddress), [walletAddress]);
  const clearance = approved ? "CLEAR" : "PENDING";

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-sol-green/25 bg-[#05080d] font-mono-tabular shadow-[0_0_60px_-12px_rgba(20,241,149,0.35)] ${className ?? ""}`}
    >
      {/* corner brackets */}
      <span className="pointer-events-none absolute left-2 top-2 size-4 border-l-2 border-t-2 border-sol-green/60" />
      <span className="pointer-events-none absolute right-2 top-2 size-4 border-r-2 border-t-2 border-sol-green/60" />
      <span className="pointer-events-none absolute bottom-2 left-2 size-4 border-b-2 border-l-2 border-sol-green/60" />
      <span className="pointer-events-none absolute bottom-2 right-2 size-4 border-b-2 border-r-2 border-sol-green/60" />

      <div className="p-6 sm:p-8">
        {/* header */}
        <div className="flex items-start justify-between gap-4">
          <p className="text-4xl font-black tracking-tight text-sol-gradient sm:text-5xl">
            {SITE_NAME}
          </p>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Access card
            </p>
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-sol-green/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sol-green">
              <span className="size-1.5 rounded-full bg-sol-green sol-pulse" />
              Shielded
            </span>
          </div>
        </div>
        <div className="mt-5 border-t border-border/60" />

        {/* identity block */}
        <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center gap-4">
              <span className="flex size-14 items-center justify-center rounded-md border border-border bg-secondary">
                <Wallet className="size-6 text-muted-foreground" />
              </span>
              <div>
                <p className="text-xl font-semibold tracking-tight text-foreground">
                  {handle ? `@${handle}` : shortWallet(walletAddress)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Solana · pre-launch
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-2 text-[13px]">
              <CardRow label="ID" value={cardId} accent />
              <CardRow label="WALLET" value={shortWallet(walletAddress)} />
              <CardRow label="SEALED" value={`slot #${slotOf(commit)}`} />
              <CardRow label="COMMIT" value={shortHash(commit)} />
              <CardRow
                label="CLEARANCE"
                value={clearance}
                accent
                valueClass={
                  approved
                    ? "text-sol-green font-semibold"
                    : "text-foreground/80 font-semibold"
                }
              />
            </div>
          </div>

          {/* pixel block */}
          <div className="hidden rounded-lg border border-border/70 bg-[#02040a] p-3 sm:block">
            <div className="grid grid-cols-10 gap-[3px]">
              {cells.map((on, i) => (
                <span
                  key={i}
                  className={`size-[7px] sm:size-[8px] ${on ? "bg-sol-green/85" : "bg-sol-green/5"}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* barcode + motto */}
        <div className="mt-8 flex items-end justify-between gap-6">
          <div className="flex h-12 items-end gap-[2px]">
            {bars.map((w, i) => (
              <span
                key={i}
                style={{ width: `${1 + w}px` }}
                className={`h-full ${i % 2 === 0 ? "bg-foreground/80" : "bg-foreground/30"}`}
              />
            ))}
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-foreground">
              Not found. <span className="text-sol-gradient">By design.</span>
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              {SITE_NAME.toLowerCase()}.site
            </p>
          </div>
        </div>
      </div>

      {approved ? (
        <div className="absolute right-6 top-1/2 hidden -rotate-12 items-center justify-center rounded-md border-2 border-sol-green/70 px-4 py-1.5 md:flex">
          <span className="text-lg font-black uppercase tracking-[0.25em] text-sol-green/90">
            Clear
          </span>
        </div>
      ) : pending ? (
        <div className="absolute right-6 top-1/2 hidden -rotate-12 items-center justify-center rounded-md border-2 border-amber-400/60 px-4 py-1.5 md:flex">
          <span className="text-lg font-black uppercase tracking-[0.25em] text-amber-400/90">
            Pending
          </span>
        </div>
      ) : null}
    </div>
  );
}

function shortWallet(a: string): string {
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function shortHash(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-8)}`;
}
function slotOf(h: string): string {
  return (parseInt(h.slice(0, 6), 16) % 900_000).toLocaleString("en-US");
}

function CardRow({
  label,
  value,
  accent = false,
  valueClass,
}: {
  label: string;
  value: string;
  accent?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </span>
      <span className={`truncate ${accent ? "text-sol-green" : "text-foreground/90"} ${valueClass ?? ""}`}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Status = "none" | "pending" | "approved" | "rejected";

const STEPS = [
  {
    icon: BadgeCheck,
    title: "Follow the announcement",
    body: "Follow @solzk on X so you see the launch as it happens.",
  },
  {
    icon: RefreshCw,
    title: "Repost or reply",
    body: "Repost the announcement (a reply works too) and copy the link to that post.",
  },
  {
    icon: Wallet,
    title: "Paste your link + wallet",
    body: "Drop the post link and your Solana wallet below. Every application is reviewed by hand.",
  },
];

export default function Whitelist() {
  const { user } = useAuth();
  const slk = useSolzk();

  const defaultAddress =
    slk.phase === "unlocked" && slk.address
      ? slk.address
      : (slk.serverWallet?.address ?? "");
  const [address, setAddress] = useState(defaultAddress);
  const [handle, setHandle] = useState("");
  const [postLink, setPostLink] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!address && defaultAddress) setAddress(defaultAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAddress]);

  const myApp = useQuery(
    api.whitelist.getMyApplication,
    defaultAddress ? { address: defaultAddress } : "skip",
  );
  const stats = useQuery(api.whitelist.getWhitelistStats, {});

  const submit = useMutation(api.whitelist.submitApplication);

  const status: Status = (myApp?.status as Status) ?? "none";

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await submit({ walletAddress: address.trim(), xHandle: handle, postLink: postLink.trim() });
      toast.success("Application submitted — review is manual, check back soon.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setBusy(false);
    }
  };

  const valid =
    /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(address.trim()) &&
    /^[A-Za-z0-9_]{1,15}$/.test(handle.trim().replace(/^@+/, "")) &&
    /^https:\/\/(www\.)?(x|twitter)\.com\/\S+$/i.test(postLink.trim());

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <WhitelistChrome />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-6">
        {/* Hero */}
        <div className="mx-auto max-w-3xl text-center">
          <GradientBadge className="mx-auto">
            <Sparkles className="size-3.5" />
            Pre-launch whitelist
          </GradientBadge>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Get on the <span className="text-sol-gradient">list</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            {TICKER} mints at {lamportsToSol(APPROVED_RATE_LAMPORTS)} SOL per
            lot for the whitelist and {lamportsToSol(OPEN_RATE_LAMPORTS)} SOL
            for everyone else. Three steps, reviewed by hand — no bots, no
            snapshot games.
          </p>
          {stats && (
            <div className="mt-6 flex items-center justify-center gap-6 font-mono-tabular text-xs text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">{stats.approved}</span> approved
              </span>
              <span>
                <span className="font-semibold text-foreground">{stats.pending}</span> in review
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-sol-green sol-pulse" />
                reviewing daily
              </span>
            </div>
          )}
        </div>

        {/* Steps + form */}
        <div className="mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-border/70 bg-card p-6">
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </span>
                <span className="font-mono-tabular text-xs text-muted-foreground">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.body}</p>
              <a
                href={i === 0 ? ANNOUNCE_URL : i === 1 ? ANNOUNCE_URL : undefined}
                target={i < 2 ? "_blank" : undefined}
                rel="noreferrer"
                className={`mt-4 inline-flex items-center gap-1.5 text-xs font-medium ${
                  i < 2 ? "text-primary hover:underline" : "text-muted-foreground"
                }`}
              >
                {i === 0 && "Open the announcement"}
                {i === 1 && "Open the post to repost"}
                {i === 2 && "Then fill in the form below"}
              </a>
            </div>
          ))}
        </div>

        <Card className="mx-auto mt-6 max-w-5xl border-primary/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TerminalSquare className="size-5 text-primary" />
              Apply
            </CardTitle>
            <CardDescription>
              One application per wallet. Rejected wallets can reapply with
              corrected details.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {status === "approved" ? (
              <ApprovedNotice />
            ) : status === "pending" ? (
              <PendingNotice />
            ) : (
              <>
                {status === "rejected" && <RejectedNotice />}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="wl-handle">X handle</Label>
                    <Input
                      id="wl-handle"
                      placeholder="@yourhandle"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      className="font-mono-tabular"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wl-link">Link to your reply or repost</Label>
                    <Input
                      id="wl-link"
                      placeholder="https://x.com/you/status/…"
                      value={postLink}
                      onChange={(e) => setPostLink(e.target.value)}
                      className="font-mono-tabular"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wl-wallet">Solana wallet address</Label>
                  <Input
                    id="wl-wallet"
                    placeholder="Paste the wallet that will mint"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="font-mono-tabular"
                  />
                  <p className="text-xs text-muted-foreground">
                    Approval is bound to this address — the approved rate
                    follows the wallet, not the account. You can paste any
                    Solana wallet, including the one you create on the{" "}
                    <a href="/mint" className="text-primary underline underline-offset-2">
                      mint page
                    </a>
                    .
                  </p>
                </div>
                <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                  <p className="max-w-md text-xs leading-5 text-muted-foreground">
                    By applying you confirm you completed both steps. Fake
                    links are rejected and the wallet stays on the open rate.
                  </p>
                  <Button
                    disabled={!valid || busy || !user}
                    onClick={handleSubmit}
                    className="bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
                  >
                    {busy ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 size-4" />
                    )}
                    {status === "rejected" ? "Reapply" : "Submit application"}
                  </Button>
                </div>
                {!user && (
                  <p className="text-xs text-amber-400/90">
                    Sign in first — the apply button unlocks once you have an
                    account.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Status + card preview — visible once an application exists */}
        {status !== "none" && (
        <div className="mx-auto mt-14 max-w-5xl">
          <SectionHeading
            kicker="Your clearance"
            title="The access card"
            description="Approved wallets get a card. Keep it — the approved rate is bound to the address printed on it, and it unlocks the moment you mint."
          />
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <AccessCard
              walletAddress={
                myApp?.walletAddress ?? (address.trim() || "0".repeat(44))
              }
              handle={myApp?.xHandle ?? handle.trim().replace(/^@+/, "")}
              approved={status === "approved"}
              pending={status === "pending"}
            />
            <div className="flex flex-col justify-center gap-4">
              <StatusRow
                icon={status === "approved" ? CheckCircle2 : Clock3}
                label="Status"
                value={
                  status === "approved"
                    ? "Approved — cleared for the approved rate"
                    : status === "pending"
                      ? "In review — checked by hand, usually within a day"
                      : status === "rejected"
                        ? "Rejected — fix the details and reapply"
                        : "No application yet"
                }
                tone={status}
              />
              <div className="rounded-2xl border border-border/70 bg-card p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                  What approval unlocks
                </p>
                <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 text-primary" />
                    {lamportsToSol(APPROVED_RATE_LAMPORTS)} SOL per lot instead
                    of {lamportsToSol(OPEN_RATE_LAMPORTS)} SOL
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 text-primary" />
                    Up to {APPROVED_MAX_LOTS} lots ·{" "}
                    {formatTokenAmount(APPROVED_MAX_LOTS * LOT_SIZE)} {TICKER}
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 text-primary" />
                    The rate is bound to your wallet address — mint from any
                    account that holds that wallet
                  </li>
                </ul>
                <p className="mt-4 text-xs leading-5 text-muted-foreground/80">
                  The mint hasn't started. Apply now, mint at the approved rate
                  when the block goes up.
                </p>
              </div>
            </div>
          </div>
        </div>
        )}
        {/* Founder console (admin only) */}
        <FounderConsole />
        </div>
      </main>
      <footer className="border-t border-border/70 py-8 text-center text-xs text-muted-foreground">
        {SITE_NAME} — a private ledger that settles on Solana. Devnet
        simulation; nothing here is financial advice.
      </footer>
    </div>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  tone: Status;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4">
      <Icon
        className={`mt-0.5 size-5 ${
          tone === "approved"
            ? "text-sol-green"
            : tone === "rejected"
              ? "text-destructive"
              : "text-amber-400"
        }`}
      />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-foreground">{value}</p>
      </div>
    </div>
  );
}

function ApprovedNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-sol-green/30 bg-sol-green/5 p-4">
      <CheckCircle2 className="mt-0.5 size-5 text-sol-green" />
      <div>
        <p className="text-sm font-semibold text-sol-green">You're approved.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your card below is live. When the mint opens, open an invoice from
          this wallet and the approved rate applies automatically.
        </p>
      </div>
      <Badge className="ml-auto shrink-0 border-sol-green/40 bg-transparent text-sol-green">
        <Lock className="mr-1 size-3" /> Cleared
      </Badge>
    </div>
  );
}

function PendingNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4">
      <Clock3 className="mt-0.5 size-5 text-amber-400" />
      <div>
        <p className="text-sm font-semibold text-amber-400">In review.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Applications are checked by hand — this usually takes less than a
          day. Your card below shows PENDING until then.
        </p>
      </div>
    </div>
  );
}

function RejectedNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <XCircle className="mt-0.5 size-5 text-destructive" />
      <div>
        <p className="text-sm font-semibold text-destructive">Rejected.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Most rejections are a bad post link or a wallet typo. Fix the details
          and submit again — reapplying replaces the old application.
        </p>
      </div>
    </div>
  );
}

/**
 * Founder console — visible only to accounts with the admin role.
 * The first account created on a fresh deployment can claim the role.
 */
function FounderConsole() {
  const user = useQuery(api.users.currentUser);
  const isAdmin = user?.role === "admin";
  const apps = useQuery(api.whitelist.listApplications, isAdmin ? {} : "skip");
  const review = useMutation(api.whitelist.reviewApplication);
  const claimFounder = useMutation(api.whitelist.claimFounder);
  const gate = useQuery(api.whitelist.getGate);
  const setGate = useMutation(api.whitelist.setWhitelistOpen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [gateBusy, setGateBusy] = useState(false);

  if (user === undefined) return null;

  if (!isAdmin) {
    return (
      <Card className="mx-auto mt-6 max-w-5xl border-dashed">
        <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">
            Reviewing applications yourself? The first account created on this
            deployment can claim the founder console.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!user}
            onClick={async () => {
              try {
                const r = await claimFounder({});
                if (r.claimed) toast.success("Founder console unlocked.");
                else toast.error("This account isn't the first account.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              }
            }}
          >
            <Lock className="mr-1.5 size-3.5" /> Claim founder console
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-6 max-w-5xl border-sol-violet/30">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Lock className="size-5 text-sol-violet" />
            Founder console
          </span>
          <Badge variant="outline" className="border-sol-violet/40 text-sol-violet">
            manual review
          </Badge>
        </CardTitle>
        <CardDescription>
          Approve or reject applications by checking the X link yourself. Approvals
          bind the wallet address printed here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Phase control: the gate that locks every other page. */}
        <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold">
              Whitelist phase: {gate === undefined ? "…" : gate.open ? "OPEN" : "CLOSED"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              While closed, this application page is the only page the site
              serves. Opening it unlocks the whole site.
            </p>
          </div>
          <Button
            size="sm"
            variant={gate?.open ? "outline" : "default"}
            className={gate?.open ? "" : "bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"}
            disabled={gateBusy || gate === undefined}
            onClick={async () => {
              setGateBusy(true);
              try {
                await setGate({ open: !gate?.open });
                toast.success(gate?.open ? "Whitelist closed — site locked to this page." : "Whitelist opened — the full site is live.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setGateBusy(false);
              }
            }}
          >
            {gateBusy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : gate?.open ? <XCircle className="mr-1.5 size-3.5" /> : <CheckCircle2 className="mr-1.5 size-3.5" />}
            {gate?.open ? "Close the whitelist" : "Open the whitelist"}
          </Button>
        </div>
        {!apps && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading applications…
          </div>
        )}
        {apps && apps.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No applications yet. Share the announcement post.
          </p>
        )}
        {apps?.map((a) => (
          <div
            key={a._id}
            className="rounded-lg border border-border/70 bg-background p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono-tabular text-sm font-semibold text-foreground">
                  @{a.xHandle}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {a.accountEmail ?? "no email"}
                  </span>
                </p>
                <p className="mt-1 truncate font-mono-tabular text-xs text-muted-foreground">
                  {a.walletAddress}
                </p>
                <a
                  href={a.postLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block truncate font-mono-tabular text-xs text-primary underline underline-offset-2"
                >
                  {a.postLink}
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    a.status === "approved"
                      ? "border-sol-green/40 text-sol-green"
                      : a.status === "rejected"
                        ? "border-destructive/40 text-destructive"
                        : "border-amber-400/40 text-amber-400"
                  }
                >
                  {a.status}
                </Badge>
                {a.status !== "approved" && (
                  <Button
                    size="sm"
                    disabled={busyId === a._id}
                    onClick={async () => {
                      setBusyId(a._id);
                      try {
                        await review({ applicationId: a._id, approve: true });
                        toast.success(`@${a.xHandle} approved`);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    {busyId === a._id ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1 size-3.5" />
                    )}
                    Approve
                  </Button>
                )}
                {a.status !== "rejected" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === a._id}
                    onClick={async () => {
                      setBusyId(a._id);
                      try {
                        await review({ applicationId: a._id, approve: false });
                        toast.success(`@${a.xHandle} rejected`);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    <XCircle className="mr-1 size-3.5" />
                    Reject
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
