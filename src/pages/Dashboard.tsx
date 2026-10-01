import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  GradientBadge,
  Stat,
} from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/convex/_generated/api";
import {
  LOT_SIZE,
  TICKER,
  TOTAL_SUPPLY,
  formatTokenAmount,
  lamportsToSol,
  shortAddress,
} from "@/lib/protocol";
import { useS404 } from "@/lib/useS404";
import {
  ArrowRight,
  Copy,
  Droplets,
  Eye,
  Lock,
  RefreshCw,
  Unlock,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

function UnlockGate({ s404 }: { s404: ReturnType<typeof useS404> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (s404.phase === "none") {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="size-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">No wallet yet</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create your shielded wallet on the mint page — it takes about a
            minute and produces both halves: your shielded balance and your
            devnet SOL.
          </p>
          <Button asChild className="mt-6 bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90">
            <Link to="/mint">
              Create a wallet <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Wallet locked</h2>
            <p className="text-xs text-muted-foreground">
              Enter your password to decrypt the seed on this device.
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
              const ok = await s404.unlock(password);
              if (!ok) toast.error(s404.error ?? "Wrong password.");
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
            const ok = await s404.unlock(password);
            if (!ok) toast.error(s404.error ?? "Wrong password.");
            setBusy(false);
          }}
        >
          {busy ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Unlock className="mr-2 size-4" />}
          Unlock
        </Button>
      </CardContent>
    </Card>
  );
}

function SendCard({ s404 }: { s404: ReturnType<typeof useS404> }) {
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-base font-semibold">Send privately</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Spend notes by nullifier, seal a new note to the receiver. The
          ledger links neither to each other — and neither to you.
        </p>
        <div className="mt-4 space-y-3">
          <Input
            placeholder="Receiver shielded address (44 chars)"
            value={receiver}
            onChange={(e) => setReceiver(e.target.value.trim())}
            className="font-mono-tabular text-xs"
          />
          <div className="flex gap-3">
            <Input
              type="number"
              placeholder={`Amount (${TICKER})`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono-tabular"
            />
            <Input
              placeholder="Memo (optional)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={24}
            />
          </div>
          <Button
            className="w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
            disabled={
              busy ||
              !s404.address ||
              !receiver ||
              Number(amount) <= 0 ||
              Number(amount) > s404.balance
            }
            onClick={async () => {
              setBusy(true);
              try {
                const res = await s404.sendPrivate(
                  receiver,
                  Number(amount),
                  memo || "transfer",
                );
                toast.success(
                  `Sent. Envelope in slot ${res.slot.toLocaleString()} — ${shortAddress(res.signature, 8, 6)}`,
                );
                setReceiver("");
                setAmount("");
                setMemo("");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Send failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <RefreshCw className="mr-2 size-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 size-4" />
            )}
            Send {amount && Number(amount) > 0 ? formatTokenAmount(Number(amount)) : ""} {TICKER}
          </Button>
          <p className="text-xs text-muted-foreground">
            Available: {formatTokenAmount(s404.balance)} {TICKER} across{" "}
            {s404.notes.length} note{s404.notes.length === 1 ? "" : "s"}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardInner() {
  const s404 = useS404();
  const invoices = useQuery(
    api.protocol.listMyInvoices,
    s404.serverWallet ? {} : "skip",
  );
  const topUp = useMutation(api.protocol.faucet);

  if (s404.phase !== "unlocked") {
    return <UnlockGate s404={s404} />;
  }

  const wallet = s404.serverWallet;
  if (!wallet) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <h2 className="text-lg font-semibold">Register on the ledger</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your wallet exists on this device but has not been registered.
            Open the mint page to register it and claim devnet SOL.
          </p>
          <Button asChild className="mt-6">
            <Link to="/mint">Go to the mint</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const approved = wallet.faucetTotalLamports > 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Shielded balance"
          value={`${formatTokenAmount(s404.balance)} ${TICKER}`}
          accent
          sub={s404.scanning ? "Scanning the pool…" : "Computed in your browser"}
        />
        <Stat
          label="Devnet SOL"
          value={`${lamportsToSol(wallet.fundingLamports)} SOL`}
          sub={
            <button
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={async () => {
                try {
                  await topUp({ lamports: 10_000_000_000 });
                  toast.success("10 devnet SOL added.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Faucet failed");
                }
              }}
            >
              <Droplets className="size-3" /> Top up
            </button>
          }
        />
        <Stat
          label="Lots minted"
          value={formatTokenAmount(wallet.lotsMinted)}
          sub={`${formatTokenAmount(wallet.lotsMinted * LOT_SIZE)} ${TICKER}`}
        />
        <Stat
          label="Rate tier"
          value={approved ? "Approved" : "Open"}
          sub={
            approved
              ? "0.0035 SOL per lot · 100-lot cap"
              : "0.01 SOL per lot · 500-lot cap"
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Shielded address</h2>
              <GradientBadge>never revealed on chain</GradientBadge>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background p-3">
              <code className="break-all font-mono-tabular text-xs">
                {wallet.address}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(wallet.address);
                  toast.success("Address copied.");
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Share this to receive shielded transfers. The address is never
              linked to what you hold or move — the pool only ever sees
              commitments and nullifiers. {shortAddress(wallet.address)} is
              yours alone.
            </p>
            <div className="mt-4 flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/vault">
                  <Eye className="mr-1.5 size-3.5" /> Vault
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/market">Market</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => s404.lock()}
              >
                Lock
              </Button>
            </div>
          </CardContent>
        </Card>

        <SendCard s404={s404} />

        <Card>
          <CardContent className="p-6">
            <h2 className="text-base font-semibold">Notes you hold</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sealed records of value. The ledger stores commitments and
              ciphertexts only — you are reading them with your own key.
            </p>
            <div className="mt-4 space-y-2">
              {s404.notes.length === 0 ? (
                <p className="rounded-xl border border-border/70 bg-background p-4 text-sm text-muted-foreground">
                  No notes yet. Mint to receive your first sealed note.
                </p>
              ) : (
                s404.notes.map((n) => (
                  <div
                    key={n._id}
                    className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-4 py-3"
                  >
                    <div>
                      <p className="font-mono-tabular text-sm font-semibold">
                        {formatTokenAmount(n.value)} {TICKER}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {n.memo} · slot {n.slot.toLocaleString()}
                      </p>
                    </div>
                    <span className="size-1.5 rounded-full bg-primary" />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-6">
          <h2 className="text-base font-semibold">Mint history</h2>
          <div className="mt-4 overflow-x-auto">
            {invoices && invoices.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Lots</th>
                    <th className="pb-2 pr-4 font-medium">Amount</th>
                    <th className="pb-2 pr-4 font-medium">Tier</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Signature</th>
                  </tr>
                </thead>
                <tbody className="font-mono-tabular">
                  {invoices.map((inv) => (
                    <tr
                      key={inv._id}
                      className="border-t border-border/60"
                    >
                      <td className="py-3 pr-4">{inv.lots}</td>
                      <td className="py-3 pr-4">{lamportsToSol(inv.lamports)} SOL</td>
                      <td className="py-3 pr-4 capitalize">{inv.tier}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={
                            inv.status === "minted"
                              ? "text-primary"
                              : inv.status === "seen"
                                ? "text-[#c9b4ff]"
                                : "text-muted-foreground"
                          }
                        >
                          {inv.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="py-3">
                        {inv.signature ? (
                          <Link
                            to={`/explorer?tx=${inv.signature}`}
                            className="text-xs text-primary hover:underline"
                          >
                            {inv.signature.slice(0, 16)}…
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-xl border border-border/70 bg-background p-4 text-sm text-muted-foreground">
                No invoices yet.
              </p>
            )}
          </div>
          <Button asChild className="mt-5 bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90">
            <Link to="/mint">
              Mint more {TICKER} <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            Supply minted:{" "}
            {(((s404.protocol?.mintedTokens ?? 0) / TOTAL_SUPPLY) * 100).toFixed(2)}% —{" "}
            {formatTokenAmount(TOTAL_SUPPLY - (s404.protocol?.mintedTokens ?? 0))}{" "}
            {TICKER} remaining.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  return (
    <RequireAuth>
      <SiteLayout>
        <PageShell>
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your wallet, your notes, your history — visible to nobody else.
            </p>
          </div>
          <DashboardInner />
        </PageShell>
      </SiteLayout>
    </RequireAuth>
  );
}
