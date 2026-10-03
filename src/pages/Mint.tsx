import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  GradientBadge,
  Stat,
} from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/convex/_generated/api";
import {
  CONFIRMATIONS_REQUIRED,
  ENVELOPE_MINT_BYTES,
  LOT_SIZE,
  MAX_MINT_PER_TX,
  OPEN_MAX_LOTS,
  OPEN_RATE_LAMPORTS,
  TICKER,
  TOTAL_LOTS,
  TOTAL_SUPPLY,
  formatTokenAmount,
  lamportsToSol,
  lotPriceLamports,
} from "@/lib/protocol";
import {
  buildEnvelopePayload,
  commitmentFor,
  sealNoteFor,
} from "@/lib/wallet";
import { buildProof } from "@/lib/wallet";
import { useSolzk } from "@/lib/solzk-context";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleDollarSign,
  Copy,
  Droplets,
  Eye,
  EyeOff,
  FileCheck,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";

type Step = "wallet" | "form" | "invoice" | "done";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Wallet setup: create / restore / unlock
// ---------------------------------------------------------------------------

function WalletSetup({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [mode, setMode] = useState<"create" | "restore" | "unlock">(
    slk.phase === "locked" ? "unlock" : "create",
  );
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [words, setWords] = useState<string[] | null>(null);
  const [restored, setRestored] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const handleCreate = async () => {
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const w = await slk.createWallet(password);
      setWords(w);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    const list = restoreText
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (list.length !== 24) {
      toast.error("Enter all 24 words, in order.");
      return;
    }
    if (password.length < 8) {
      toast.error("Choose a new password (8+ characters).");
      return;
    }
    setBusy(true);
    try {
      const ok = await slk.restoreWallet(list, password);
      if (ok) {
        setRestored(true);
        toast.success("Wallet restored.");
      } else {
        toast.error(slk.error ?? "Restore failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    try {
      const ok = await slk.unlock(password);
      if (!ok) toast.error(slk.error ?? "Wrong password.");
    } finally {
      setBusy(false);
    }
  };

  if (words) {
    return (
      <Card className="border-sol-gradient mx-auto max-w-2xl">
        <CardContent className="p-8">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="size-5" />
            <h2 className="text-lg font-semibold">Write down your 24 words</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            They are the only way to recover the wallet, and they restore both
            your shielded balance and your SOL address. Your password cannot be
            reset and nobody can recover it for you.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {words.map((w, i) => (
              <div
                key={i}
                className="flex items-baseline gap-2 rounded-lg border border-border/70 bg-background px-3 py-2"
              >
                <span className="w-4 text-right font-mono-tabular text-[10px] text-muted-foreground">
                  {i + 1}
                </span>
                <span className="font-mono-tabular text-sm">{w}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(words.join(" "));
                toast.success("Words copied — store them offline.");
              }}
            >
              <Copy className="mr-1.5 size-3.5" /> Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevealed((v) => !v)}
            >
              {revealed ? (
                <EyeOff className="mr-1.5 size-3.5" />
              ) : (
                <Eye className="mr-1.5 size-3.5" />
              )}
              {revealed ? "Blur" : "Reveal"}
            </Button>
          </div>
          <label className="mt-6 flex cursor-pointer items-start gap-2.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={restored}
              onChange={(e) => setRestored(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            I wrote the words down offline. I understand that without them,
            nothing can be recovered — by anyone.
          </label>
          <Button
            className="mt-5 w-full bg-sol-gradient font-semibold text-primary-foreground hover:opacity-90"
            disabled={!restored}
            onClick={() => {
              setWords(null);
              setPassword("");
            }}
          >
            Continue to the mint
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-8">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {mode === "unlock" ? (
              <Lock className="size-5" />
            ) : (
              <KeyRound className="size-5" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold">
              {mode === "unlock"
                ? "Unlock your wallet"
                : mode === "restore"
                  ? "Restore from 24 words"
                  : "Create a wallet"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {mode === "unlock"
                ? "Your seed is encrypted on this device."
                : mode === "restore"
                  ? "The words restore both your SOL and your shielded balance."
                  : "One seed produces both halves: shielded balance and SOL address."}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            Keys are generated on this device and never sent anywhere. No
            upload, cloud backup, or cross-device sync — not even to us.
          </span>
        </div>

        <div className="mt-6 space-y-4">
          {mode === "restore" && (
            <textarea
              value={restoreText}
              onChange={(e) => setRestoreText(e.target.value)}
              placeholder="word one word two … all 24, in order"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              placeholder={
                mode === "unlock" ? "Password" : "Set a password (8+ chars)"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) {
                  if (mode === "unlock") handleUnlock();
                  else if (mode === "restore") handleRestore();
                }
              }}
              className="pr-10"
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPw ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>

          <Button
            className="w-full bg-sol-gradient font-semibold text-primary-foreground hover:opacity-90"
            disabled={busy || !password}
            onClick={() => {
              if (mode === "unlock") handleUnlock();
              else if (mode === "restore") handleRestore();
              else handleCreate();
            }}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 size-4" />
            )}
            {mode === "unlock"
              ? "Unlock"
              : mode === "restore"
                ? "Restore wallet"
                : "Create wallet"}
          </Button>

          <div className="flex items-center justify-between pt-1 text-xs">
            {mode === "unlock" ? (
              <button
                className="text-primary hover:underline"
                onClick={() => {
                  setMode("create");
                }}
              >
                Create a new wallet instead
              </button>
            ) : (
              <button
                className="text-primary hover:underline"
                onClick={() => setMode("restore")}
              >
                Restore from 24 words
              </button>
            )}
            {slk.phase === "locked" && (
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  slk.forgetWallet();
                  setMode("create");
                  toast.info(
                    "Encrypted seed removed from this device. Your words still restore it.",
                  );
                }}
              >
                <RotateCcw className="mr-1 inline size-3" />
                Forget on this device
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function RegisterCard({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [busy, setBusy] = useState(false);
  const registered = slk.serverWallet !== null && slk.serverWallet !== undefined;

  const register = async () => {
    setBusy(true);
    try {
      await slk.registerOnChain();
      toast.success("Wallet registered on the ledger.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      if (msg.includes(`already holds a ${TICKER} wallet`)) {
        toast.error(
          `This account already holds a ${TICKER} wallet — one account, one wallet. Open the dashboard to see it.`,
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Wallet className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">
          {registered ? `You hold a ${TICKER} wallet` : "Register your wallet"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {registered
            ? "Unlock it above to mint. One account binds one wallet — neither can be multiplied."
            : "Publishes your shielded address to the ledger. Fund it with a real deposit before minting."}
        </p>
        {!registered && (
          <Button
            className="mt-6 w-full bg-sol-gradient font-semibold text-primary-foreground hover:opacity-90"
            disabled={busy}
            onClick={register}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Droplets className="mr-2 size-4" />
            )}
            Register wallet
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The mint form
// ---------------------------------------------------------------------------

function MintForm({
  slk,
  onInvoiceOpened,
}: {
  slk: ReturnType<typeof useSolzk>;
  onInvoiceOpened: (invoiceId: string) => void;
}) {
  const wallet = slk.serverWallet;
  const protocol = slk.protocol;
  const openInvoiceMut = useMutation(api.protocol.openInvoice);

  const [lots, setLots] = useState(1);
  const [busy, setBusy] = useState(false);

  // Open mint: one price for everyone. Burn tiers still discount transfers.
  const tier = "open" as const;
  const cap = OPEN_MAX_LOTS;
  const perLot = OPEN_RATE_LAMPORTS;
  const lotsUsed = wallet?.lotsMinted ?? 0;
  const lotsLeft = Math.max(0, cap - lotsUsed);
  const remainingSupply = Math.max(
    0,
    TOTAL_SUPPLY - (protocol?.mintedTokens ?? 0),
  );
  const maxLotsNow = Math.min(
    lotsLeft,
    Math.floor(remainingSupply / LOT_SIZE),
    Math.floor(MAX_MINT_PER_TX / LOT_SIZE),
  );
  const totalLamports = lotPriceLamports(tier, lots);

  const open = async () => {
    if (!slk.address || !slk.seedHex) {
      toast.error("Unlock your wallet first.");
      return;
    }
    setBusy(true);
    try {
      const r = crypto.randomUUID();
      const value = lots * LOT_SIZE;
      const sealed = await sealNoteFor(slk.address, {
        value,
        memo: "mint",
        r,
      });
      const commitment = await commitmentFor(value, r, slk.address);
      const res = await openInvoiceMut({
        lots,
        tier,
        commitment,
        noteR: r,
      });
      toast.success("Invoice opened — the deposit address is yours alone.");
      onInvoiceOpened(res.invoiceId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open invoice");
    } finally {
      setBusy(false);
    }
  };  if (!wallet) return null;

  const mintedPct = (
    ((protocol?.mintedTokens ?? 0) / TOTAL_SUPPLY) *
    100
  ).toFixed(2);
  const feeLamports = Math.ceil((totalLamports * 500) / 10_000);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Step tracker — Privacy Cash deposit→withdraw clarity: you always know which stage you're in */}
      <ol className="grid gap-2 sm:grid-cols-5">
        {[
          ["1", "Wallet", "Unlocked"],
          ["2", "Registered", "On ledger"],
          ["3", "Sized", `${lots} lot${lots > 1 ? "s" : ""}`],
          ["4", "Pay", "Invoice"],
          ["5", "Settle", "3 confs"],
        ].map(([n, t, sub], i) => {
          const active = (i === 0 || i === 1 || i === 2);
          return (
            <li key={t} className={`rounded-xl border px-3 py-2.5 ${active ? "border-primary/40 bg-primary/5" : "border-border/60 bg-card"}`}>
              <p className="font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Step {n}</p>
              <p className={`mt-0.5 text-sm font-semibold ${active ? "text-primary" : "text-foreground"}`}>{t}</p>
              <p className="font-mono-tabular text-[11px] text-muted-foreground">{sub}</p>
            </li>
          );
        })}
      </ol>
      {/* Issuance parameters — the terminal-style panel */}
      <div className="rounded-xl border border-primary/25 bg-card/60">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <p className="font-mono-tabular text-[11px] font-semibold uppercase tracking-[0.25em] text-primary">
            Issuance parameters
          </p>
          <span className="rounded border border-primary/40 px-2 py-0.5 font-mono-tabular text-[11px] text-primary">
            {TICKER}
          </span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border/40 sm:grid-cols-3">
          <div className="p-5">
            <p className="font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Open mint rate
            </p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-semibold text-primary">
              {lamportsToSol(OPEN_RATE_LAMPORTS)} SOL
            </p>
            <p className="mt-1 font-mono-tabular text-[11px] text-muted-foreground">
              10,000 {TICKER} · 0.035 SOL
            </p>
          </div>
          <div className="p-5">
            <p className="font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Your cap
            </p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-semibold">
              {formatTokenAmount(cap * LOT_SIZE)}
            </p>
            <p className="mt-1 font-mono-tabular text-[11px] text-muted-foreground">
              {TICKER} max · {cap} lots
            </p>
          </div>
          <div className="p-5">
            <p className="font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Minted
            </p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-semibold">
              {mintedPct}%
            </p>
            <p className="mt-1 font-mono-tabular text-[11px] text-muted-foreground">
              {formatTokenAmount(protocol?.mintedTokens ?? 0)} /{" "}
              {formatTokenAmount(TOTAL_SUPPLY)}
            </p>
          </div>
        </div>
        <div className="border-t border-border/60 px-5 py-4">
          <div className="flex items-center justify-between font-mono-tabular text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.2em]">Supply issued</span>
            <span>
              {formatTokenAmount(protocol?.mintedTokens ?? 0)} /{" "}
              {formatTokenAmount(TOTAL_SUPPLY)} · {mintedPct}%
            </span>
          </div>
          <Progress
            value={((protocol?.mintedTokens ?? 0) / TOTAL_SUPPLY) * 100}
            className="mt-2 h-1.5"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Amount minted is public; the recipient is not.
          </p>
        </div>
      </div>

      {/* Acquisition */}
      <div className="rounded-xl border border-border/70 bg-card">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <p className="font-mono-tabular text-[11px] font-semibold uppercase tracking-[0.25em] text-foreground">
            Acquisition
          </p>
          <span className="rounded border border-border px-2 py-0.5 font-mono-tabular text-[11px] uppercase tracking-wider text-muted-foreground">
            open mint
          </span>
        </div>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold">Size the purchase</h2>

          <div className="mt-5 grid gap-6 sm:grid-cols-[1fr_240px]">
            <div>
              <p className="font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Lots
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={maxLotsNow}
                  value={lots}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v))
                      setLots(
                        Math.max(1, Math.min(maxLotsNow || 1, Math.floor(v))),
                      );
                  }}
                  className="h-11 w-24 text-center font-mono-tabular text-lg"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 px-4 font-mono-tabular"
                  disabled={maxLotsNow <= 0}
                  onClick={() => setLots(maxLotsNow)}
                >
                  MAX {maxLotsNow}
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[1, 5, 10, 25, 100].map((n) => (
                  <Button
                    key={n}
                    variant="secondary"
                    size="sm"
                    disabled={n > maxLotsNow}
                    onClick={() => setLots(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>

              <div className="mt-5 space-y-1.5 font-mono-tabular text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>
                    {lots} lot{lots > 1 ? "s" : ""} ·{" "}
                    {lamportsToSol(perLot)} SOL
                  </span>
                  <span>{lamportsToSol(totalLamports)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span>protocol fee · 5% (2.5% to the vault)</span>
                  <span>{lamportsToSol(feeLamports)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span>network fee (once per mint)</span>
                  <span>0.00005 SOL</span>
                </div>
                <div className="flex justify-between">
                  <span>
                    allocation {wallet.lotsMinted + 1} / {cap} · max {cap} per
                    invoice set
                  </span>
                  <span />
                </div>
              </div>

              <Button
                className="mt-6 w-full bg-sol-gradient py-6 font-semibold text-primary-foreground hover:opacity-90"
                disabled={busy || lots < 1 || lots > maxLotsNow}
                onClick={open}
              >
                {busy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <FileCheck className="mr-2 size-4" />
                )}
                Open invoice
              </Button>

              <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
                Caps are per wallet across every invoice: {lotsLeft} of {cap}{" "}
                lots left at {lamportsToSol(perLot)} SOL per lot. First come, first served.
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-background p-4 text-right">
              <p className="font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                You receive
              </p>
              <p className="mt-1 font-mono-tabular text-3xl font-semibold text-primary">
                {formatTokenAmount(lots * LOT_SIZE)}
              </p>
              <p className="font-mono-tabular text-xs text-muted-foreground">
                {TICKER}
              </p>
              <p className="mt-4 font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                You pay
              </p>
              <p className="mt-1 font-mono-tabular text-2xl font-semibold">
                {lamportsToSol(totalLamports + 5_000)} SOL
              </p>
              <p className="mt-1 font-mono-tabular text-[11px] text-muted-foreground">
                incl. fees
              </p>
              <div className="mt-4 border-t border-border/60 pt-3 text-left font-mono-tabular text-[11px] text-muted-foreground">
                <p>
                  Your SOL balance:{" "}
                  <span className="text-foreground">
                    {lamportsToSol(wallet.fundingLamports)}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Funded by real deposits only — there is no faucet.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Shielded balance"
          value={`${formatTokenAmount(slk.balance)} ${TICKER}`}
          sub={slk.scanning ? "Scanning the pool…" : "Only you can read this"}
        />
        <Stat
          label="Vault fee pool"
          value={`${lamportsToSol(slk.vaultPool?.feePoolLamports ?? 0)} SOL`}
          sub="2.5% of every mint goes to depositors"
        />
        <Stat
          label="Envelope"
          value={`${ENVELOPE_MINT_BYTES} bytes`}
          sub="Uniform mint size — the amount is inside, sealed"
        />
      </div>

      {/* Fee schedule — Privacy Cash-style explicit table: every fee, no surprises */}
      <div className="rounded-xl border border-border/70 bg-card">
        <div className="border-b border-border/60 px-5 py-3">
          <p className="font-mono-tabular text-[11px] font-semibold uppercase tracking-[0.25em] text-foreground">
            Fee schedule
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Fee</th>
                <th className="px-5 py-3 font-medium">Where it goes</th>
              </tr>
            </thead>
            <tbody className="font-mono-tabular text-[13px]">
              <tr className="border-b border-border/40">
                <td className="px-5 py-3 font-semibold text-foreground">Mint</td>
                <td className="px-5 py-3">5% of price + 0.00005 SOL network</td>
                <td className="px-5 py-3 text-muted-foreground">2.5% vault pool · 2.5% treasury · 95% protocol liquidity</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="px-5 py-3 font-semibold text-foreground">Transfer</td>
                <td className="px-5 py-3">2% (1% if staked) · burn tiers −25/−50/−75%</td>
                <td className="px-5 py-3 text-muted-foreground">Half vault pool · half treasury</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="px-5 py-3 font-semibold text-foreground">Relayer</td>
                <td className="px-5 py-3">0.00005 SOL flat, or fee-in-note from 25 {TICKER}</td>
                <td className="px-5 py-3 text-muted-foreground">Relayer fee vault (public, in explorer)</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-semibold text-foreground">Swap / redeem</td>
                <td className="px-5 py-3">0.3% swap · 2% exit fee on redeem</td>
                <td className="px-5 py-3 text-muted-foreground">Half vault pool · half treasury</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Privacy tips — Privacy Cash caveats, adapted: what the sim hides and what it doesn't */}
      <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-5">
        <p className="font-mono-tabular text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-400">
          Privacy notes — read before you mint
        </p>
        <ul className="mt-3 space-y-2 text-[13px] leading-6 text-muted-foreground">
          <li>· Mint amounts are public (supply must be auditable). Privacy starts after the mint — transfers hide sender, receiver, amount and asset.</li>
          <li>· Timing leaks: the chain shows an envelope landed at a slot. Avoid minting a unique lot count and moving it seconds later.</li>
          <li>· Keep this tab open through settlement — the proof is built in your browser. Closing loses nothing: reopen and the invoice resumes.</li>
        </ul>
      </div>

      {/* Mint FAQ */}
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["I paid but nothing happened.", `Payments need ${CONFIRMATIONS_REQUIRED} confirmations (~12s). The invoice page shows the count climbing, then settlement starts by itself — there is no mint button.`],
          ["I closed the tab mid-mint.", "Nothing is lost. Reopen the mint page with the same wallet; the newest unsettled invoice resumes automatically."],
          ["Why is my cap lower than expected?", `Caps are per wallet across every invoice: ${lotsLeft} of ${cap} lots left at the open mint rate. First come, first served.`],
          ["Where does the 5% go?", "Half to the vault fee pool (claimable by depositors), half to the treasury. The other 95% becomes protocol liquidity backing redemptions."],
        ].map(([q, a]) => (
          <div key={q as string} className="rounded-xl border border-border/70 bg-card p-4">
            <p className="text-sm font-semibold text-foreground">{q}</p>
            <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">{a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice: pay, wait for confirmations, auto-mint (no button)
// ---------------------------------------------------------------------------

function InvoiceFlow({
  slk,
  invoiceId,
  onDone,
}: {
  slk: ReturnType<typeof useSolzk>;
  invoiceId: string;
  onDone: () => void;
}) {
  const now = useNow(1000);
  const invoices = useQuery(api.protocol.listMyInvoices);
  const payInvoiceMut = useMutation(api.protocol.payInvoice);
  const settleInvoiceMut = useMutation(api.protocol.settleInvoice);
  const [paying, setPaying] = useState(false);
  const [proving, setProving] = useState(false);
  const settlingRef = useRef(false);

  const invoice = useMemo(
    () => invoices?.find((i) => i._id === invoiceId),
    [invoices, invoiceId],
  );

  // Confirmations climb client-side from paidAt; the server double-checks.
  const confirmations = useMemo(() => {
    if (!invoice?.paidAt) return 0;
    return Math.min(
      CONFIRMATIONS_REQUIRED,
      Math.floor((now - invoice.paidAt) / 4000),
    );
  }, [invoice?.paidAt, now]);

  const expired = invoice ? now > invoice.expiresAt : false;

  // The mint has no button: the moment the payment settles, the browser
  // builds the proof and hands the envelope to the relayer.
  useEffect(() => {
    if (!invoice || invoice.status !== "seen" || !slk.address) return;
    if (confirmations < CONFIRMATIONS_REQUIRED) return;
    if (settlingRef.current) return;
    settlingRef.current = true;
    (async () => {
      setProving(true);
      try {
        const r = invoice.noteR;
        const value = invoice.lots * LOT_SIZE;
        const sealed = await sealNoteFor(slk.address!, {
          value,
          memo: "mint",
          r,
        });
        const payload = buildEnvelopePayload(
          "mint",
          sealed,
          ENVELOPE_MINT_BYTES,
        );
        const { proof } = await buildProof(payload);
        await settleInvoiceMut({ invoiceId: invoice._id, proof, payload });
        slk.refreshNotes();
        toast.success(`${formatTokenAmount(value)} ${TICKER} minted.`);
        onDone();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Settlement failed — retrying",
        );
      } finally {
        setProving(false);
        settlingRef.current = false;
      }
    })();
  }, [invoice, confirmations, slk, settleInvoiceMut, onDone]);

  if (!invoice) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Invoice not found.
          <Button variant="link" onClick={onDone}>
            Back to the mint
          </Button>
        </CardContent>
      </Card>
    );
  }

  const minutesLeft = Math.max(0, Math.ceil((invoice.expiresAt - now) / 60000));

  if (invoice.status === "awaiting_payment") {
    return (
      <Card className="border-sol-gradient mx-auto max-w-2xl">
        <CardContent className="p-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Pay {lamportsToSol(invoice.lamports)} SOL
            </h2>
            <GradientBadge>
              {expired ? "Expired" : `Expires in ${minutesLeft}m`}
            </GradientBadge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This deposit address belongs to this invoice alone — that is how
            the node knows the payment was yours. Send the exact amount, or
            press Pay.
          </p>

          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-border/70 bg-background p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                One-time deposit address
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <code className="break-all font-mono-tabular text-xs">
                  {invoice.depositAddress}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(invoice.depositAddress);
                    toast.success("Address copied.");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Stat label="Amount due" value={`${lamportsToSol(invoice.lamports)} SOL`} />
              <Stat
                label="You receive"
                value={`${formatTokenAmount(invoice.lots * LOT_SIZE)} ${TICKER}`}
              />
            </div>

            {!expired ? (
              <Button
                className="w-full bg-sol-gradient py-6 font-semibold text-primary-foreground hover:opacity-90"
                disabled={paying}
                onClick={async () => {
                  setPaying(true);
                  try {
                    await payInvoiceMut({ invoiceId: invoice._id });
                    toast.success("Payment broadcast. Waiting for confirmations.");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Payment failed");
                  } finally {
                    setPaying(false);
                  }
                }}
              >
                {paying ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <CircleDollarSign className="mr-2 size-4" />
                )}
                Pay from wallet — one click
              </Button>
            ) : (
              <Button variant="outline" className="w-full" onClick={onDone}>
                Open a new invoice
              </Button>
            )}
            <p className="text-center text-xs text-muted-foreground">
              Keep this tab open while it finishes — the proof is built in
              your browser. If you close it, nothing is lost: come back and
              this page picks the purchase up.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (invoice.status === "seen" || proving) {
    return (
      <Card className="border-sol-gradient mx-auto max-w-2xl">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <RefreshCw
              className={`size-6 text-primary ${proving ? "animate-spin" : "sol-pulse"}`}
            />
          </div>
          <h2 className="mt-4 text-lg font-semibold">
            {proving
              ? "Building the proof in your browser…"
              : "Payment seen — waiting for confirmations"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {confirmations} of {CONFIRMATIONS_REQUIRED} confirmations. Three
            slots is the point at which a payment is settled rather than
            merely seen.
          </p>
          <div className="mx-auto mt-6 flex max-w-xs justify-center gap-2">
            {Array.from({ length: CONFIRMATIONS_REQUIRED }).map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full ${
                  i < confirmations
                    ? "bg-sol-gradient"
                    : "bg-muted sol-pulse"
                }`}
              />
            ))}
          </div>
          <p className="mt-6 text-xs leading-5 text-muted-foreground">
            Minting starts by itself. There is no button. Your envelope is
            published by the relayer, which pays the fee from its own coins.
          </p>
        </CardContent>
      </Card>
    );
  }

  // minted
  return (
    <Card className="border-sol-gradient mx-auto max-w-2xl">
      <CardContent className="p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-sol-gradient shadow-[0_0_28px_rgba(242,97,12,0.4)]">
          <Sparkles className="size-6 text-primary-foreground" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">
          {formatTokenAmount(invoice.lots * LOT_SIZE)} {TICKER} is in your
          wallet
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The envelope is in a block. Only you can read it.
        </p>
        {invoice.signature && (
          <Link
            to={`/explorer?tx=${invoice.signature}`}
            className="mt-4 inline-block font-mono-tabular text-xs text-primary hover:underline"
          >
            {invoice.signature.slice(0, 24)}… — view in the explorer
          </Link>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <Button
            className="bg-sol-gradient font-semibold text-primary-foreground hover:opacity-90"
            onClick={onDone}
          >
            Mint more
          </Button>
          <Button variant="outline" asChild>
            <Link to="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function MintPageInner() {
  const slk = useSolzk();
  const invoices = useQuery(
    api.protocol.listMyInvoices,
    slk.serverWallet ? {} : "skip",
  );
  const [activeInvoice, setActiveInvoice] = useState<string | null>(null);

  // Resume an unfinished purchase: the newest invoice that can still settle.
  const resumable = useMemo(
    () =>
      invoices?.find(
        (i) =>
          i.status === "seen" ||
          (i.status === "awaiting_payment" && i.expiresAt > Date.now()),
      ),
    [invoices],
  );

  useEffect(() => {
    if (!activeInvoice && resumable) setActiveInvoice(resumable._id);
  }, [activeInvoice, resumable]);

  let body: React.ReactNode;
  if (slk.phase === "locked" || slk.phase === "none") {
    body = <WalletSetup slk={slk} />;
  } else if (!slk.address) {
    body = (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (!slk.serverWallet) {
    body = <RegisterCard slk={slk} />;
  } else if (activeInvoice) {
    body = (
      <InvoiceFlow
        slk={slk}
        invoiceId={activeInvoice}
        onDone={() => setActiveInvoice(null)}
      />
    );
  } else {
    body = (
      <MintForm
        slk={slk}
        onInvoiceOpened={(id) => setActiveInvoice(id)}
      />
    );
  }

  return (
    <PageShell>
      <div className="mb-8 flex flex-col gap-1">
        <GradientBadge className="w-fit">
          <span className="size-1.5 rounded-full bg-primary sol-pulse" />
          Mint live · open mint — no allowlist
        </GradientBadge>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Mint {TICKER}
        </h1>
        <p className="text-sm text-muted-foreground">
          Lots of {formatTokenAmount(LOT_SIZE)} · {lamportsToSol(OPEN_RATE_LAMPORTS)} SOL per lot
        </p>
      </div>
      {body}
    </PageShell>
  );
}

export default function MintPage() {
  return (
    <RequireAuth
      title="Sign in to mint"
      description={`Your ${TICKER} wallet lives inside your account. Sign in to create or unlock it.`}
    >
      <SiteLayout>
        <MintPageInner />
      </SiteLayout>
    </RequireAuth>
  );
}
