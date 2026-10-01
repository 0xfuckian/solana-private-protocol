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
  APPROVED_MAX_LOTS,
  CONFIRMATIONS_REQUIRED,
  ENVELOPE_MINT_BYTES,
  LOT_SIZE,
  MAX_MINT_PER_TX,
  OPEN_MAX_LOTS,
  OPEN_RATE_LAMPORTS,
  APPROVED_RATE_LAMPORTS,
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
import { useS404 } from "@/lib/s404-context";
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

const FAUCET_LAMPORTS = 10_000_000_000; // 10 SOL on first registration

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

function WalletSetup({ s404 }: { s404: ReturnType<typeof useS404> }) {
  const [mode, setMode] = useState<"create" | "restore" | "unlock">(
    s404.phase === "locked" ? "unlock" : "create",
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
      const w = await s404.createWallet(password);
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
      const ok = await s404.restoreWallet(list, password);
      if (ok) {
        setRestored(true);
        toast.success("Wallet restored.");
      } else {
        toast.error(s404.error ?? "Restore failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    try {
      const ok = await s404.unlock(password);
      if (!ok) toast.error(s404.error ?? "Wrong password.");
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
            your shielded balance and your devnet SOL. Your password cannot be
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
              className="mt-0.5 size-4 accent-[#14f195]"
            />
            I wrote the words down offline. I understand that without them,
            nothing can be recovered — by anyone.
          </label>
          <Button
            className="mt-5 w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
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
                  : "One seed produces both halves: shielded balance and devnet SOL."}
            </p>
          </div>
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
            className="w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
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
            {s404.phase === "locked" && (
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  s404.forgetWallet();
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
// Registration + faucet
// ---------------------------------------------------------------------------

function RegisterCard({ s404 }: { s404: ReturnType<typeof useS404> }) {
  const [busy, setBusy] = useState(false);
  const registered = s404.serverWallet !== null && s404.serverWallet !== undefined;

  const register = async () => {
    setBusy(true);
    try {
      await s404.registerOnChain(FAUCET_LAMPORTS);
      toast.success(
        "Wallet registered on the ledger. 10 devnet SOL deposited.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      if (msg.includes("already holds an S404 wallet")) {
        toast.error(
          "This account already holds an S404 wallet — one account, one wallet. Open the dashboard to see it.",
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
          {registered ? "You hold an S404 wallet" : "Register your wallet"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {registered
            ? "Unlock it above to mint. One account binds one wallet — neither can be multiplied."
            : "Publishes your shielded address to the ledger and deposits 10 devnet SOL so you can mint immediately."}
        </p>
        {!registered && (
          <Button
            className="mt-6 w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
            disabled={busy}
            onClick={register}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Droplets className="mr-2 size-4" />
            )}
            Register & claim 10 devnet SOL
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
  s404,
  onInvoiceOpened,
}: {
  s404: ReturnType<typeof useS404>;
  onInvoiceOpened: (invoiceId: string) => void;
}) {
  const wallet = s404.serverWallet;
  const protocol = s404.protocol;
  const openInvoiceMut = useMutation(api.protocol.openInvoice);

  const [lots, setLots] = useState(1);
  const [busy, setBusy] = useState(false);

  const approved = wallet?.approved ?? false;
  const tier = approved ? "approved" : "open";
  const cap = approved ? APPROVED_MAX_LOTS : OPEN_MAX_LOTS;
  const perLot = approved ? APPROVED_RATE_LAMPORTS : OPEN_RATE_LAMPORTS;
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
    if (!s404.address || !s404.seedHex) {
      toast.error("Unlock your wallet first.");
      return;
    }
    setBusy(true);
    try {
      const r = crypto.randomUUID();
      const value = lots * LOT_SIZE;
      const sealed = await sealNoteFor(s404.address, {
        value,
        memo: "mint",
        r,
      });
      const commitment = await commitmentFor(value, r, s404.address);
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
  };

  if (!wallet) return null;

  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Choose how much</h2>
            <GradientBadge>
              {approved ? (
                <>
                  <BadgeCheck className="size-3.5" /> Approved rate
                </>
              ) : (
                "Open rate"
              )}
            </GradientBadge>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setLots((v) => Math.max(1, v - 1))}
              disabled={lots <= 1}
            >
              −
            </Button>
            <Input
              type="number"
              min={1}
              max={maxLotsNow}
              value={lots}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v))
                  setLots(Math.max(1, Math.min(maxLotsNow || 1, Math.floor(v))));
              }}
              className="h-12 text-center font-mono-tabular text-lg"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setLots((v) => Math.min(maxLotsNow, v + 1))}
              disabled={lots >= maxLotsNow}
            >
              +
            </Button>
            <span className="text-sm text-muted-foreground">
              lots of {formatTokenAmount(LOT_SIZE)}
            </span>
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
                {n} lot{n > 1 ? "s" : ""}
              </Button>
            ))}
          </div>

          <div className="mt-6 space-y-2 rounded-xl border border-border/70 bg-background p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rate</span>
              <span className="font-mono-tabular">
                {lamportsToSol(perLot)} SOL / lot
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">You receive</span>
              <span className="font-mono-tabular">
                {formatTokenAmount(lots * LOT_SIZE)} {TICKER}
              </span>
            </div>
            <div className="flex justify-between border-t border-border/60 pt-2 text-base font-semibold">
              <span>Total</span>
              <span className="font-mono-tabular text-primary">
                {lamportsToSol(totalLamports)} SOL
              </span>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              A one-time deposit address reserves this invoice for 60 minutes.
              The relayer publishes the envelope from its own coins — your SOL
              never sits in the same transaction.
            </p>
          </div>

          <Button
            className="mt-6 w-full bg-sol-gradient py-6 font-semibold text-[#04101a] hover:opacity-90"
            disabled={busy || lots < 1 || lots > maxLotsNow}
            onClick={open}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <FileCheck className="mr-2 size-4" />
            )}
            Open invoice for {lots} lot{lots > 1 ? "s" : ""}
          </Button>

          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Caps are per wallet and counted across every invoice you open:{" "}
            {lotsLeft} of {cap} lots left on the {tier} rate. Minting is first
            come, first served until the supply is gone.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Stat
          label="Your devnet SOL"
          value={`${lamportsToSol(wallet.fundingLamports)} SOL`}
          accent
          sub={
            <button
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={async () => {
                try {
                  await s404.topUpFaucet(10_000_000_000);
                  toast.success("10 devnet SOL added.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Faucet failed");
                }
              }}
            >
              <Droplets className="size-3" /> Top up with the faucet
            </button>
          }
        />
        <Stat
          label="Shielded balance"
          value={`${formatTokenAmount(s404.balance)} ${TICKER}`}
          sub={s404.scanning ? "Scanning the pool…" : "Only you can read this"}
        />
        <Stat
          label="Supply minted"
          value={`${((protocol?.mintedTokens ?? 0) / TOTAL_SUPPLY * 100).toFixed(2)}%`}
          sub={`${formatTokenAmount(remainingSupply)} ${TICKER} remaining`}
        />
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <Progress
            value={((protocol?.mintedTokens ?? 0) / TOTAL_SUPPLY) * 100}
            className="h-2"
          />
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {formatTokenAmount(TOTAL_LOTS)} lots exist. When the last one is
            minted, the market opens and the mint never comes back.
          </p>
        </div>
        <Stat label="Envelope" value={`${ENVELOPE_MINT_BYTES} bytes`} sub="Uniform mint size — the amount is inside, sealed" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice: pay, wait for confirmations, auto-mint (no button)
// ---------------------------------------------------------------------------

function InvoiceFlow({
  s404,
  invoiceId,
  onDone,
}: {
  s404: ReturnType<typeof useS404>;
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
    if (!invoice || invoice.status !== "seen" || !s404.address) return;
    if (confirmations < CONFIRMATIONS_REQUIRED) return;
    if (settlingRef.current) return;
    settlingRef.current = true;
    (async () => {
      setProving(true);
      try {
        const r = invoice.noteR;
        const value = invoice.lots * LOT_SIZE;
        const sealed = await sealNoteFor(s404.address!, {
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
        s404.refreshNotes();
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
  }, [invoice, confirmations, s404, settleInvoiceMut, onDone]);

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
                className="w-full bg-sol-gradient py-6 font-semibold text-[#04101a] hover:opacity-90"
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
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-sol-gradient shadow-[0_0_28px_rgba(20,241,149,0.4)]">
          <Sparkles className="size-6 text-[#04101a]" />
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
            className="bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
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
  const s404 = useS404();
  const invoices = useQuery(
    api.protocol.listMyInvoices,
    s404.serverWallet ? {} : "skip",
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
  if (s404.phase === "locked" || s404.phase === "none") {
    body = <WalletSetup s404={s404} />;
  } else if (!s404.address) {
    body = (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (!s404.serverWallet) {
    body = <RegisterCard s404={s404} />;
  } else if (activeInvoice) {
    body = (
      <InvoiceFlow
        s404={s404}
        invoiceId={activeInvoice}
        onDone={() => setActiveInvoice(null)}
      />
    );
  } else {
    body = (
      <MintForm
        s404={s404}
        onInvoiceOpened={(id) => setActiveInvoice(id)}
      />
    );
  }

  return (
    <PageShell>
      <div className="mb-8 flex flex-col gap-1">
        <GradientBadge className="w-fit">
          <span className="size-1.5 rounded-full bg-primary sol-pulse" />
          Mint live · first come, first served
        </GradientBadge>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Mint {TICKER}
        </h1>
        <p className="text-sm text-muted-foreground">
          Lots of {formatTokenAmount(LOT_SIZE)} · {lamportsToSol(OPEN_RATE_LAMPORTS)} SOL open ·{" "}
          {lamportsToSol(APPROVED_RATE_LAMPORTS)} SOL approved
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
      description="Your S404 wallet lives inside your account. Sign in to create or unlock it."
    >
      <SiteLayout>
        <MintPageInner />
      </SiteLayout>
    </RequireAuth>
  );
}
