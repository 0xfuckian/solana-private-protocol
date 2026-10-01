import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GradientBadge, Stat } from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/convex/_generated/api";
import {
  MINT_FEE_BPS,
  MARKET_FEE_BPS,
  formatTokenAmount,
  lamportsToSol,
} from "@/lib/protocol";
import { useSolzk } from "@/lib/solzk-context";
import { buildProof, commitmentFor, sealNoteFor } from "@/lib/wallet";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  Droplets,
  HandCoins,
  Loader2,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

interface VaultToken {
  _id: string;
  ticker: string;
  name: string;
  maxSupply: number;
  mintedTokens: number;
  priceLamportsPerKilo: number;
  mintOpen: boolean;
  isProtocolToken: boolean;
  creator: string | null;
  createdAt: number;
  holders: number;
}

interface PoolInfo {
  depositedTokens: number;
  totalShares: number;
  feePoolLamports: number;
  feesDistributedLamports: number;
  liquidityLamports: number;
  treasuryLamports: number;
}

interface MyPosition {
  shares: number;
  depositedTokens: number;
  accumulatedFees: number;
  claimableLamports: number;
  poolSharePct: number;
}

// ---------------------------------------------------------------------------
// Liquidity panel: deposit / claim / withdraw
// ---------------------------------------------------------------------------

function LiquidityPanel() {
  const slk = useSolzk();
  const pool = slk.vaultPool as PoolInfo | undefined;
  const position = useQuery(
    api.vault.getMyPosition,
    slk.phase === "unlocked" ? {} : "skip",
  ) as MyPosition | undefined;

  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawPct, setWithdrawPct] = useState(50);
  const [busy, setBusy] = useState<string | null>(null);

  if (slk.phase !== "unlocked") {
    return (
      <Card className="border-sol-gradient">
        <CardContent className="p-8 text-center">
          <ShieldCheck className="mx-auto size-8 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">
            Unlock to provide liquidity
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            The vault pays its depositors the vault's half of every mint,
            transfer and trade fee — proportional to shares, claimable any
            time, no lockup.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="border-sol-gradient lg:col-span-2">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">
              Provide liquidity
            </h2>
            <GradientBadge>
              <Droplets className="size-3.5" /> earns {MARKET_FEE_BPS / 100}% of
              every trade
            </GradientBadge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Deposit SOLZK notes into the pool. Your shares earn the vault's
            half of every protocol fee — mint fees, transfer fees, market
            fees — paid out in SOL, claimable whenever you like.
          </p>

          <div className="mt-5 flex gap-3">
            <div className="flex-1">
              <Input
                type="number"
                placeholder={`Amount (${`SOLZK`})`}
                value={depositAmt}
                onChange={(e) => setDepositAmt(e.target.value)}
                className="font-mono-tabular"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Shielded balance: {formatTokenAmount(slk.balance)} SOLZK
                <button
                  className="ml-2 text-primary hover:underline"
                  onClick={() => setDepositAmt(String(slk.balance))}
                >
                  max
                </button>
              </p>
            </div>
            <Button
              className="bg-sol-gradient px-6 font-semibold text-[#04101a] hover:opacity-90"
              disabled={
                busy !== null ||
                !depositAmt ||
                Number(depositAmt) <= 0 ||
                Number(depositAmt) > slk.balance
              }
              onClick={async () => {
                setBusy("deposit");
                try {
                  await slk.depositToVault(Number(depositAmt));
                  toast.success(
                    `${formatTokenAmount(Number(depositAmt))} SOLZK deposited. Shares are earning fees.`,
                  );
                  setDepositAmt("");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Deposit failed");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "deposit" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="mr-2 size-4" />
              )}
              Deposit
            </Button>
          </div>

          {position && position.shares > 0 && (
            <div className="mt-6 rounded-xl border border-border/70 bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Your position
                  </p>
                  <p className="mt-1 font-mono-tabular text-lg font-semibold">
                    {formatTokenAmount(position.shares)} shares
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {position.poolSharePct.toFixed(2)}% of the pool
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Claimable fees
                  </p>
                  <p className="mt-1 font-mono-tabular text-lg font-semibold text-primary">
                    {lamportsToSol(position.claimableLamports)} SOL
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  className="bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
                  disabled={busy !== null || position.claimableLamports <= 0}
                  onClick={async () => {
                    setBusy("claim");
                    try {
                      const r = await slk.claimVaultFees();
                      toast.success(
                        `${lamportsToSol(r.claimedLamports)} SOL claimed to your wallet.`,
                      );
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : "Claim failed",
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "claim" ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <HandCoins className="mr-1.5 size-3.5" />
                  )}
                  Claim fees
                </Button>

                <div className="flex flex-1 items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={withdrawPct}
                    onChange={(e) => setWithdrawPct(Number(e.target.value))}
                    className="w-32 accent-[#14f195]"
                  />
                  <span className="font-mono-tabular text-xs text-muted-foreground">
                    withdraw {withdrawPct}%
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy("withdraw");
                      try {
                        const shares = Math.floor(
                          (position.shares * withdrawPct) / 100,
                        );
                        if (shares < 1) throw new Error("Nothing to withdraw");
                        const r = await slk.withdrawFromVault(shares);
                        toast.success(
                          `${formatTokenAmount(r.tokensOut)} SOLZK returned to your shielded wallet as a sealed note.`,
                        );
                      } catch (e) {
                        toast.error(
                          e instanceof Error ? e.message : "Withdraw failed",
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === "withdraw" ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <ArrowUpFromLine className="mr-1.5 size-3.5" />
                    )}
                    Withdraw
                  </Button>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Withdrawals return value as a sealed note — private in,
                private out. There is no exit to ordinary SOL.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Stat
          label="Fee pool"
          value={`${lamportsToSol(pool?.feePoolLamports ?? 0)} SOL`}
          accent
          sub="awaiting depositors"
        />
        <Stat
          label="Paid to depositors"
          value={`${lamportsToSol(pool?.feesDistributedLamports ?? 0)} SOL`}
          sub="lifetime payouts"
        />
        <Stat
          label="Protocol liquidity"
          value={`${lamportsToSol(pool?.liquidityLamports ?? 0)} SOL`}
          sub="95% of every mint backstops the pool"
        />
        <Stat
          label="Deposited"
          value={`${formatTokenAmount(pool?.depositedTokens ?? 0)} SOLZK`}
          sub={`${formatTokenAmount(pool?.totalShares ?? 0)} shares outstanding`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Launchpad (deploy + buy shielded tokens)
// ---------------------------------------------------------------------------

function DeployCard() {
  const deploy = useMutation(api.vault.deployToken);
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [maxSupply, setMaxSupply] = useState("1000000");
  const [pricePerKilo, setPricePerKilo] = useState("35000000");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button
        className="bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-1.5 size-4" /> Deploy a token
      </Button>
    );
  }

  return (
    <Card className="w-full max-w-lg border-sol-gradient">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 text-primary">
          <Rocket className="size-5" />
          <h2 className="text-base font-semibold">Deploy a shielded token</h2>
        </div>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          A ticker, a maximum supply and a per-mint price, published as an
          envelope like any other.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Input
            placeholder="TICKER"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            maxLength={8}
          />
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
          />
          <Input
            type="number"
            placeholder="Max supply"
            value={maxSupply}
            onChange={(e) => setMaxSupply(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Lamports per 1,000"
            value={pricePerKilo}
            onChange={(e) => setPricePerKilo(e.target.value)}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1 bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { proof } = await buildProof(
                  `deploy:${ticker}:${Number(maxSupply)}:${Number(pricePerKilo)}`,
                );
                await deploy({
                  ticker,
                  name: name || ticker,
                  maxSupply: Number(maxSupply),
                  priceLamportsPerKilo: Number(pricePerKilo),
                  proof,
                });
                toast.success(`${ticker} deployed. Its mint is live.`);
                setOpen(false);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Deploy failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Rocket className="mr-2 size-4" />
            )}
            Publish deploy envelope
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BuyDialog({
  token,
  onDone,
}: {
  token: { _id: string; ticker: string; priceLamportsPerKilo: number };
  onDone: () => void;
}) {
  const slk = useSolzk();
  const buy = useMutation(api.vault.buyToken);
  const [amount, setAmount] = useState("10000");
  const [busy, setBusy] = useState(false);

  const gross = Math.ceil(
    (Number(amount || 0) * token.priceLamportsPerKilo) / 1000,
  );

  return (
    <Card className="border-sol-gradient w-full max-w-md">
      <CardContent className="p-6">
        <h2 className="text-base font-semibold">Buy {token.ticker} privately</h2>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          The mint amount and ticker are public — supply has to be auditable.
          The sealed note that represents your purchase is visible to you
          alone.
        </p>
        <div className="mt-4 space-y-3">
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
          />
          <div className="flex justify-between rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
            <span className="text-muted-foreground">Cost</span>
            <span className="font-mono-tabular">{lamportsToSol(gross)} SOL</span>
          </div>
          <Button
            className="w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
            disabled={busy || !slk.address || Number(amount) <= 0}
            onClick={async () => {
              if (!slk.address) return;
              setBusy(true);
              try {
                const r = crypto.randomUUID();
                const value = Number(amount);
                const sealed = await sealNoteFor(slk.address, {
                  value,
                  memo: `buy ${token.ticker}`,
                  r,
                });
                const commitment = await commitmentFor(value, r, slk.address);
                const { proof } = await buildProof(
                  `vaultbuy:${token._id}:${value}:${JSON.stringify(sealed)}`,
                );
                await buy({
                  tokenId: token._id as never,
                  amountTokens: value,
                  sealedNote: sealed,
                  commitment,
                  proof,
                });
                toast.success(
                  `${formatTokenAmount(value)} ${token.ticker} minted to your shielded wallet.`,
                );
                onDone();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Buy failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            Buy
          </Button>
          <Button variant="ghost" className="w-full" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function VaultInner() {
  const slk = useSolzk();
  const tokens = useQuery(api.vault.listTokens) as VaultToken[] | undefined;
  const myBalances = useQuery(
    api.vault.listMyBalances,
    slk.phase === "unlocked" ? {} : "skip",
  ) as { tokenId: string; amount: number }[] | undefined;
  const [buying, setBuying] = useState<VaultToken | null>(null);

  const balances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of myBalances ?? []) map[String(b.tokenId)] = b.amount;
    return map;
  }, [myBalances]);

  return (
    <div className="space-y-8">
      <LiquidityPanel />

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Shielded tokens</h2>
            <p className="text-sm text-muted-foreground">
              Every token here is private by default. Holders and transfers
              are sealed notes, not account balances.
            </p>
          </div>
          <DeployCard />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {(tokens ?? []).map((t) => (
            <Card
              key={String(t._id)}
              className={t.isProtocolToken ? "border-primary/30" : undefined}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-[#9945FF]/15 text-[#c9b4ff]">
                      <Coins className="size-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{t.ticker}</p>
                      <p className="text-xs text-muted-foreground">{t.name}</p>
                    </div>
                  </div>
                  {t.isProtocolToken && <GradientBadge>protocol</GradientBadge>}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Price / 1k</p>
                    <p className="mt-0.5 font-mono-tabular text-sm">
                      {lamportsToSol(t.priceLamportsPerKilo)} SOL
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Minted</p>
                    <p className="mt-0.5 font-mono-tabular text-sm">
                      {formatTokenAmount(t.mintedTokens)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Cap</p>
                    <p className="mt-0.5 font-mono-tabular text-sm">
                      {formatTokenAmount(t.maxSupply)}
                    </p>
                  </div>
                </div>

                {balances[String(t._id)] > 0 && (
                  <p className="mt-3 font-mono-tabular text-sm text-primary">
                    You hold {formatTokenAmount(balances[String(t._id)])}{" "}
                    {t.ticker}
                  </p>
                )}

                {!t.isProtocolToken && t.mintOpen && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setBuying(t)}
                  >
                    <Sparkles className="mr-1.5 size-3.5" /> Buy
                  </Button>
                )}
                {t.isProtocolToken && (
                  <Button asChild variant="outline" size="sm" className="mt-4">
                    <a href="/mint">Mint</a>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {buying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <BuyDialog token={buying} onDone={() => setBuying(null)} />
        </div>
      )}
    </div>
  );
}

export default function Vault() {
  return (
    <RequireAuth>
      <SiteLayout>
        <PageShell wide>
          <div className="mb-8">
            <GradientBadge className="mb-2">
              liquidity pool · fee sharing
            </GradientBadge>
            <h1 className="text-3xl font-semibold tracking-tight">Vault</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Deposit SOLZK like adding liquidity to a pool. The vault's half
              of the {MINT_FEE_BPS / 100}% mint fee, the 2% transfer fee and
              the {MARKET_FEE_BPS / 100}% market fee flows to depositors,
              pro rata — claimable any time.
            </p>
          </div>
          <VaultInner />
        </PageShell>
      </SiteLayout>
    </RequireAuth>
  );
}
