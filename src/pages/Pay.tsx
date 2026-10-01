import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GradientBadge } from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import {
  RELAYER_FEE_LAMPORTS,
  RELAYER_FEE_NOTE_TOKENS,
  TICKER,
  decodePayLink,
  formatTokenAmount,
  lamportsToSol,
  shortAddress,
  transferFeeTokens,
} from "@/lib/protocol";
import { useSolzk } from "@/lib/solzk-context";
import {
  ArrowRight,
  BadgeCheck,
  Copy,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  Unlock,
  Wallet,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";

function UnlockInline({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Unlock to pay</h2>
            <p className="text-xs text-muted-foreground">
              The payment request is loaded — decrypt your wallet to send.
            </p>
          </div>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && password && !busy) {
              setBusy(true);
              const ok = await slk.unlock(password);
              if (!ok) toast.error(slk.error ?? "Wrong password.");
              setBusy(false);
            }
          }}
          placeholder="Password"
          className="mt-6 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          className="mt-3 w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
          disabled={busy || !password}
          onClick={async () => {
            setBusy(true);
            const ok = await slk.unlock(password);
            if (!ok) toast.error(slk.error ?? "Wrong password.");
            setBusy(false);
          }}
        >
          {busy ? (
            <RefreshCw className="mr-2 size-4 animate-spin" />
          ) : (
            <Unlock className="mr-2 size-4" />
          )}
          Unlock
        </Button>
      </CardContent>
    </Card>
  );
}

function PayInner() {
  const slk = useSolzk();
  const fragment = useLocation().hash.slice(1);
  const link = useMemo(() => decodePayLink(fragment), [fragment]);

  const [feeInNote, setFeeInNote] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<{
    signature: string;
    slot: number;
    net: number;
  } | null>(null);

  if (!link) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="p-8 text-center">
          <Link2 className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">
            No payment in this link
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            A SOL-ZK pay link carries the recipient, amount and memo in the
            URL fragment after <code className="font-mono-tabular">#</code> —
            it never touches a server, but this one is missing or malformed.
            You can create your own from the dashboard.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">
              Open the dashboard <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (slk.phase === "none") {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <Wallet className="mx-auto size-8 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">
            You need a SOL-ZK wallet
          </h2>
          <p className="mx-auto mt-2 text-sm leading-6 text-muted-foreground">
            Create one on the mint page — about a minute — then come back to
            this link to pay.
          </p>
          <Button asChild className="mt-6 bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90">
            <Link to="/mint">Create a wallet</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (slk.phase !== "unlocked") {
    return <UnlockInline slk={slk} />;
  }

  if (paid) {
    return (
      <Card className="mx-auto max-w-lg border-sol-gradient">
        <CardContent className="p-8 text-center">
          <BadgeCheck className="mx-auto size-10 text-primary" />
          <h2 className="mt-4 text-xl font-semibold">Payment sent</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {formatTokenAmount(paid.net)} {TICKER} sealed to{" "}
            <span className="font-mono-tabular">{shortAddress(link.to)}</span>{" "}
            in slot {paid.slot.toLocaleString()} — the memo travels inside the
            ciphertext, invisible to the ledger.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/explorer?tx=${paid.signature}`}>
                View the envelope
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const burned = slk.serverWallet?.burnedTokens ?? 0;
  const tierLabel = burned > 0 ? "burn-tier discount applied" : null;
  const fee = transferFeeTokens(link.amount, slk.serverWallet?.discountBps ?? 0);
  const relayerFee = feeInNote ? RELAYER_FEE_NOTE_TOKENS : 0;
  const net = link.amount - fee - relayerFee;
  const affordable = slk.balance >= link.amount;

  return (
    <Card className="mx-auto max-w-lg border-sol-gradient">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Payment request</h2>
          <GradientBadge>
            <Zap className="size-3" /> one tap, one envelope
          </GradientBadge>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Recipient, amount and memo arrived in the URL fragment — no server
          ever saw this request.
        </p>

        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2.5">
            <span className="text-xs text-muted-foreground">Pay to</span>
            <code className="flex items-center gap-2 font-mono-tabular text-xs">
              {shortAddress(link.to, 8, 8)}
              <button
                className="text-primary hover:underline"
                onClick={() => {
                  navigator.clipboard.writeText(link.to);
                  toast.success("Address copied.");
                }}
              >
                <Copy className="size-3.5" />
              </button>
            </code>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2.5">
            <span className="text-xs text-muted-foreground">Amount</span>
            <span className="font-mono-tabular text-sm font-semibold">
              {formatTokenAmount(link.amount)} {TICKER}
            </span>
          </div>
          {link.memo && (
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2.5">
              <span className="text-xs text-muted-foreground">Memo</span>
              <span className="text-sm">{link.memo}</span>
            </div>
          )}
          <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Protocol fee{tierLabel ? ` (${tierLabel})` : ""}
              </span>
              <span className="font-mono-tabular">
                {formatTokenAmount(fee)} {TICKER}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">
                {feeInNote ? "Relayer fee · in-note" : "Network fee · SOL"}
              </span>
              <span className="font-mono-tabular">
                {feeInNote
                  ? `${RELAYER_FEE_NOTE_TOKENS} ${TICKER}`
                  : `${lamportsToSol(RELAYER_FEE_LAMPORTS)} SOL`}
              </span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border/50 pt-1">
              <span className="text-muted-foreground">Recipient gets</span>
              <span className="font-mono-tabular text-primary">
                {formatTokenAmount(Math.max(0, net))} {TICKER}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold">Fee-in-note</p>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Pay even with zero SOL in your wallet.
              </p>
            </div>
            <button
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                feeInNote
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary text-muted-foreground"
              }`}
              onClick={() => setFeeInNote((v) => !v)}
            >
              {feeInNote ? "ON" : "OFF"}
            </button>
          </div>
          {!affordable && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Your shielded balance is {formatTokenAmount(slk.balance)}{" "}
              {TICKER} — this request needs {formatTokenAmount(link.amount)}.
            </p>
          )}
        </div>

        <Button
          className="mt-5 w-full bg-sol-gradient py-5 font-semibold text-[#04101a] hover:opacity-90"
          disabled={busy || !affordable || net <= 0}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await slk.sendPrivate(link.to, link.amount, link.memo || "pay link", {
                feeInNote,
              });
              setPaid({ signature: res.signature, slot: res.slot, net });
              toast.success(`Paid ${formatTokenAmount(net)} ${TICKER}.`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Payment failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <ArrowRight className="mr-2 size-4" />
          )}
          Pay {formatTokenAmount(link.amount)} {TICKER}
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Your balance: {formatTokenAmount(slk.balance)} {TICKER}
          {lamportsToSol(slk.serverWallet?.fundingLamports ?? 0) !== "0" && (
            <> · {lamportsToSol(slk.serverWallet?.fundingLamports ?? 0)} SOL</>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export default function Pay() {
  return (
    <RequireAuth>
      <SiteLayout>
        <PageShell>
          <div className="mb-8">
            <GradientBadge className="mb-2">pay links</GradientBadge>
            <h1 className="text-3xl font-semibold tracking-tight">Pay</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              A payment request that lives entirely in the link. Open it, tap
              once, and the envelope lands on the ledger — memo sealed, sender
              unlinkable.
            </p>
          </div>
          <PayInner />
        </PageShell>
      </SiteLayout>
    </RequireAuth>
  );
}
