import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  GradientBadge,
  Stat,
} from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/convex/_generated/api";
import {
  LOT_SIZE,
  RATE_TIERS,
  RELAYER_FEE_LAMPORTS,
  RELAYER_FEE_NOTE_TOKENS,
  TICKER,
  TOTAL_SUPPLY,
  discountTierForBurned,
  formatTokenAmount,
  lamportsToSol,
  nextDiscountTier,
  payLinkUrl,
  shortAddress,
  transferFeeTokens,
} from "@/lib/protocol";
import { useSolzk } from "@/lib/solzk-context";
import {
  ArrowRight,
  Copy,
  Droplets,
  Eye,
  Flame,
  Ghost,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Tags,
  Unlock,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

function UnlockGate({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (slk.phase === "none") {
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
          {busy ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Unlock className="mr-2 size-4" />}
          Unlock
        </Button>
      </CardContent>
    </Card>
  );
}

function SendCard({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [feeInNote, setFeeInNote] = useState(false);
  const [stealth, setStealth] = useState(false);
  const [busy, setBusy] = useState(false);

  const payeeLabels = useQuery(
    api.asp.getLabels,
    !stealth && receiver.length === 44 ? { address: receiver } : "skip",
  );

  const amountNum = Number(amount) || 0;
  const burned = slk.serverWallet?.burnedTokens ?? 0;
  const tier = discountTierForBurned(burned);
  const fee = amountNum > 0 ? transferFeeTokens(amountNum, tier.discountBps) : 0;
  const relayerFee = feeInNote ? RELAYER_FEE_NOTE_TOKENS : 0;
  const net = Math.max(0, amountNum - fee - relayerFee);

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
            placeholder={
              stealth
                ? "Recipient stealth meta secret (hex)"
                : "Receiver shielded address (44 chars)"
            }
            value={receiver}
            onChange={(e) => setReceiver(e.target.value.trim())}
            className="font-mono-tabular text-xs"
          />
          {payeeLabels && payeeLabels.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
                <ShieldAlert className="size-3.5" /> Paying to a labelled address
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {payeeLabels.map((l) => (
                  <span
                    key={l._id}
                    className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-500"
                  >
                    {l.label}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                Public association-set labels attached to this payee. The ledger
                still links nothing — resolve before you send.
              </p>
            </div>
          )}
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

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold">Stealth address</p>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Pay a fresh one-time address — no stable identifier on chain.
              </p>
            </div>
            <Switch checked={stealth} onCheckedChange={setStealth} />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold">Fee-in-note</p>
              <p className="text-[11px] leading-4 text-muted-foreground">
                The note pays the relayer — send with zero SOL in the wallet.
              </p>
            </div>
            <Switch checked={feeInNote} onCheckedChange={setFeeInNote} />
          </div>

          <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Protocol fee ({tier.label}
                {tier.discountBps > 0
                  ? ` · −${(tier.discountBps / 100).toFixed(1).replace(".0", "")}%`
                  : ""}
                )
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
            {amountNum > 0 && (
              <div className="mt-1 flex justify-between border-t border-border/50 pt-1">
                <span className="text-muted-foreground">Receiver gets</span>
                <span className="font-mono-tabular text-primary">
                  {formatTokenAmount(net)} {TICKER}
                </span>
              </div>
            )}
          </div>

          <Button
            className="w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
            disabled={
              busy ||
              !slk.address ||
              !receiver ||
              amountNum <= 0 ||
              amountNum > slk.balance ||
              (amountNum > 0 && net <= 0)
            }
            onClick={async () => {
              setBusy(true);
              try {
                const res = stealth
                  ? await slk.sendStealth(
                      receiver,
                      Number(amount),
                      memo || "stealth transfer",
                      { feeInNote },
                    )
                  : await slk.sendPrivate(
                      receiver,
                      Number(amount),
                      memo || "transfer",
                      { feeInNote },
                    );
                toast.success(
                  `Sent. Envelope in slot ${res.slot.toLocaleString()} — ${shortAddress(res.signature, 8, 6)}${stealth ? " · stealth" : ""}${feeInNote ? " · relayer paid in-note" : ""}`,
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
            Available: {formatTokenAmount(slk.balance)} {TICKER} across{" "}
            {slk.notes.length} note{slk.notes.length === 1 ? "" : "s"}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

const BURN_OPTIONS = [1_000, 10_000, 100_000] as const;

function BurnCard({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [busy, setBusy] = useState(false);
  const burned = slk.serverWallet?.burnedTokens ?? 0;
  const tier = discountTierForBurned(burned);
  const next = nextDiscountTier(burned);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Burn for fee discount</h2>
          <Flame className="size-4 text-primary" />
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Burn {TICKER} from your notes to set a permanent, public fee tier.
          Burned tokens leave the supply forever — the discount applies to
          every transfer you ever send.
        </p>
        <div className="mt-4 rounded-lg border border-border/60 bg-background px-3 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Your tier</span>
            <span className="font-semibold text-primary">
              {tier.label}
              {tier.discountBps > 0
                ? ` · −${(tier.discountBps / 100).toFixed(1).replace(".0", "")}% fees`
                : ""}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Burned</span>
            <span className="font-mono-tabular">
              {formatTokenAmount(burned)} {TICKER}
            </span>
          </div>
          {next && (
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Next: {next.label} at −{(next.discountBps / 100).toFixed(1).replace(".0", "")}%
              </span>
              <span className="font-mono-tabular">
                {formatTokenAmount(Math.max(0, next.minBurned - burned))} to go
              </span>
            </div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {BURN_OPTIONS.map((opt) => (
            <Button
              key={opt}
              variant="outline"
              size="sm"
              className="font-mono-tabular"
              disabled={busy || opt > slk.balance}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await slk.burnForTier(opt);
                  toast.success(
                    `Burned ${formatTokenAmount(opt)} ${TICKER} — ${r.tierLabel} tier: −${(r.discountBps / 100).toFixed(1).replace(".0", "")}% fees.`,
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Burn failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <Flame className="mr-1 size-3 text-primary" />
              )}
              {formatTokenAmount(opt)}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          Ember 1,000 → −25% · Onyx 10,000 → −50% · Obsidian 100,000 → −75%.
          Needs notes to cover the burn.
        </p>
      </CardContent>
    </Card>
  );
}

function ViewKeysCard({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [scanAddr, setScanAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    { commitment: string; value: number; memo: string; slot: number }[] | null
  >(null);
  const [scannedFor, setScannedFor] = useState("");

  const masked = (k: string | null) => (k ? `${k.slice(0, 10)}…${k.slice(-6)}` : "—");

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">View keys</h2>
          <KeyRound className="size-4 text-primary" />
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Derived from your seed, held on this device. The incoming key can
          read what you receive without spending it; the outgoing key reads
          your sent memos. Share with auditors only — they see value, never
          spend authority.
        </p>
        <div className="mt-4 space-y-2">
          {[
            { label: "Incoming (IVK)", key: slk.viewKeys.incoming },
            { label: "Outgoing (OVK)", key: slk.viewKeys.outgoing },
          ].map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium">{row.label}</p>
                <code className="font-mono-tabular text-[11px] text-muted-foreground">
                  {masked(row.key)}
                </code>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={!row.key}
                onClick={() => {
                  navigator.clipboard.writeText(row.key ?? "");
                  toast.success(`${row.label} copied — treat it like a read-only key.`);
                }}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          1-byte view tags are embedded in every new note — this scan matched{" "}
          <span className="font-semibold text-primary">{slk.tagMatches}</span>{" "}
          tag{slk.tagMatches === 1 ? "" : "s"} and decrypted those first.
        </p>

        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="flex items-center gap-2">
            <ScanLine className="size-3.5 text-primary" />
            <p className="text-xs font-semibold">Read-only scan</p>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            Paste any shielded address to view its incoming notes — values and
            memos, no nullifiers, nothing spendable.
          </p>
          <div className="mt-2 flex gap-2">
            <Input
              placeholder="Shielded address (44 chars)"
              value={scanAddr}
              onChange={(e) => setScanAddr(e.target.value.trim())}
              className="font-mono-tabular text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy || scanAddr.length !== 44}
              onClick={async () => {
                setBusy(true);
                try {
                  const out = await slk.scanAddress(scanAddr);
                  setResults(out);
                  setScannedFor(shortAddress(scanAddr));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Scan"}
            </Button>
          </div>
          {results !== null && (
            <div className="mt-2 space-y-1">
              {results.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No notes found for {scannedFor}.
                </p>
              ) : (
                results.map((r) => (
                  <div
                    key={r.commitment}
                    className="flex items-center justify-between rounded-md border border-border/50 px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-mono-tabular">
                      {formatTokenAmount(r.value)} {TICKER}
                    </span>
                    <span className="text-muted-foreground">
                      {r.memo} · slot {r.slot.toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RequestPaymentCard({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [link, setLink] = useState("");

  const amountNum = Number(amount) || 0;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Request payment</h2>
          <Link2 className="size-4 text-primary" />
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Generate a pay link: {TICKER} amount and memo encoded in the URL
          fragment — it never touches a server. Anyone with a SOL-ZK wallet
          opens the link and pays in one tap.
        </p>
        <div className="mt-4 flex gap-3">
          <Input
            type="number"
            placeholder={`Amount (${TICKER})`}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setLink("");
            }}
            className="font-mono-tabular"
          />
          <Input
            placeholder="Memo (optional)"
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value);
              setLink("");
            }}
            maxLength={24}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={!slk.address || amountNum <= 0}
          onClick={() => {
            const url = payLinkUrl({
              to: slk.address!,
              amount: amountNum,
              memo: memo || undefined,
            });
            setLink(url);
          }}
        >
          <Link2 className="mr-1.5 size-3.5" /> Create pay link
        </Button>
        {link && (
          <div className="mt-3 rounded-lg border border-border/60 bg-background p-3">
            <code className="block break-all font-mono-tabular text-[11px] leading-4 text-muted-foreground">
              {link}
            </code>
            <Button
              size="sm"
              className="mt-2 bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
              onClick={() => {
                navigator.clipboard.writeText(link);
                toast.success("Pay link copied — share it anywhere.");
              }}
            >
              <Copy className="mr-1.5 size-3.5" /> Copy link
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssociationSetsCard({ slk }: { slk: ReturnType<typeof useSolzk> }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = useQuery(api.asp.getMyLabels, {});
  const recent = useQuery(api.asp.listRecentLabels, {});
  const register = useMutation(api.asp.registerLabel);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Association sets</h2>
          <Tags className="size-4 text-primary" />
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          The public label registry. Anyone can assert a label against any
          shielded address; senders resolve labels before paying. The ledger
          itself links nothing — labels are assertions, not verdicts.
        </p>

        <div className="mt-4 rounded-lg border border-border/60 bg-background px-3 py-2.5">
          <p className="text-xs font-medium">
            How the pool sees you{" "}
            {mine && (
              <span className="font-mono-tabular text-muted-foreground">
                {shortAddress(mine.address)}
              </span>
            )}
          </p>
          {mine && mine.labels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {mine.labels.map((l) => (
                <span
                  key={l._id}
                  className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                >
                  {l.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {mine ? "No labels attached — unlabelled in the registry." : "Loading…"}
            </p>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Assert a label for your address (2–32 chars)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={32}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || label.trim().length < 2 || !slk.address}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await register({ address: slk.address!, label });
                toast.success(
                  r.alreadyRegistered
                    ? `Label "${r.label}" was already on your address.`
                    : `Label "${r.label}" published to the registry.`,
                );
                setLabel("");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not register label");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Publish"}
          </Button>
        </div>

        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="text-xs font-semibold">Recent registry activity</p>
          <div className="mt-2 space-y-1">
            {recent && recent.length > 0 ? (
              recent.slice(0, 6).map((l) => (
                <div
                  key={l._id}
                  className="flex items-center justify-between rounded-md border border-border/50 px-2.5 py-1.5 text-xs"
                >
                  <span className="text-primary">{l.label}</span>
                  <span className="font-mono-tabular text-muted-foreground">
                    {shortAddress(l.address)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {recent ? "Registry is empty — publish the first label." : "Loading…"}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardInner() {
  const slk = useSolzk();
  const invoices = useQuery(
    api.protocol.listMyInvoices,
    slk.serverWallet ? {} : "skip",
  );
  const topUp = useMutation(api.protocol.faucet);

  if (slk.phase !== "unlocked") {
    return <UnlockGate slk={slk} />;
  }

  const wallet = slk.serverWallet;
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

  const approved = wallet.approved;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Shielded balance"
          value={`${formatTokenAmount(slk.balance)} ${TICKER}`}
          accent
          sub={slk.scanning ? "Scanning the pool…" : "Computed in your browser"}
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
          sub={`${lamportsToSol(RATE_TIERS[approved ? "approved" : "open"].perLotLamports)} SOL per lot · ${RATE_TIERS[approved ? "approved" : "open"].maxLots.toLocaleString()}-lot cap`}
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
            <div className="mt-3 rounded-lg border border-border/60 bg-background px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">Stealth meta secret</p>
                  <code className="font-mono-tabular text-[11px] text-muted-foreground">
                    {slk.viewKeys.stealthMeta
                      ? `${slk.viewKeys.stealthMeta.slice(0, 14)}…${slk.viewKeys.stealthMeta.slice(-8)}`
                      : "—"}
                  </code>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!slk.viewKeys.stealthMeta}
                  onClick={() => {
                    navigator.clipboard.writeText(slk.viewKeys.stealthMeta ?? "");
                    toast.success(
                      "Stealth meta copied — share it to receive one-time payments.",
                    );
                  }}
                >
                  <Ghost className="size-4" />
                </Button>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Publish this instead of a payment address: senders derive a
                fresh one-time address per payment; only your scan recognizes
                them. It never grants spend authority.
              </p>
            </div>
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
                onClick={() => slk.lock()}
              >
                Lock
              </Button>
            </div>
          </CardContent>
        </Card>

        <SendCard slk={slk} />

        <Card>
          <CardContent className="p-6">
            <h2 className="text-base font-semibold">Notes you hold</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sealed records of value. The ledger stores commitments and
              ciphertexts only — you are reading them with your own key.
            </p>
            <div className="mt-4 space-y-2">
              {slk.notes.length === 0 ? (
                <p className="rounded-xl border border-border/70 bg-background p-4 text-sm text-muted-foreground">
                  No notes yet. Mint to receive your first sealed note.
                </p>
              ) : (
                slk.notes.map((n) => (
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
                        {n.stealth ? " · stealth" : n.tagHit ? " · tag match" : ""}
                      </p>
                    </div>
                    <span className="size-1.5 rounded-full bg-primary" />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <BurnCard slk={slk} />

        <ViewKeysCard slk={slk} />

        <RequestPaymentCard slk={slk} />

        <AssociationSetsCard slk={slk} />
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
            {(((slk.protocol?.mintedTokens ?? 0) / TOTAL_SUPPLY) * 100).toFixed(2)}% —{" "}
            {formatTokenAmount(TOTAL_SUPPLY - (slk.protocol?.mintedTokens ?? 0))}{" "}
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
