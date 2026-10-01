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
  TICKER,
  TOTAL_SUPPLY,
  formatTokenAmount,
  lamportsToSol,
} from "@/lib/protocol";
import { useSolzk } from "@/lib/solzk-context";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock3,
  Droplets,
  Flame,
  HandCoins,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

interface PoolInfo {
  depositedTokens: number;
  totalShares: number;
  feePoolLamports: number;
  feesDistributedLamports: number;
  liquidityLamports: number;
  treasuryLamports: number;
  mintOpen: boolean;
  marketOpen: boolean;
  backfillPending: boolean;
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

  const vaultOpen = Boolean(pool?.mintOpen || pool?.marketOpen);

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

  if (!vaultOpen) {
    return (
      <Card className="border-sol-gradient">
        <CardContent className="p-8 text-center">
          <Clock3 className="mx-auto size-8 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">
            The vault opens when minting starts
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            There is no pool to size and no fee stream to share before the
            first mint. The moment minting goes live you can deposit {TICKER}{" "}
            here and start earning your share of every protocol fee — including
            mint fees collected from the first block onward.
          </p>
          <Button asChild variant="outline" className="mt-5">
            <a href="/whitelist">Get the approved rate first</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="border-sol-gradient lg:col-span-2">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Provide liquidity</h2>
            <GradientBadge>
              <Droplets className="size-3.5" /> earns {MARKET_FEE_BPS / 100}% of
              every trade
            </GradientBadge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Deposit {TICKER} notes into the pool. Your shares earn the vault's
            half of every protocol fee — mint fees, transfer fees, market fees
            — paid out in SOL, claimable whenever you like. Fees collected
            before the first deposit are captured by the first depositors.
          </p>

          <div className="mt-5 flex gap-3">
            <div className="flex-1">
              <Input
                type="number"
                placeholder={`Amount (${TICKER})`}
                value={depositAmt}
                onChange={(e) => setDepositAmt(e.target.value)}
                className="font-mono-tabular"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Shielded balance: {formatTokenAmount(slk.balance)} {TICKER}
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
                    `${formatTokenAmount(Number(depositAmt))} ${TICKER} deposited. Shares are earning fees.`,
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
                  disabled={
                    busy !== null ||
                    (position.claimableLamports <= 0 && !pool?.backfillPending)
                  }
                  onClick={async () => {
                    setBusy("claim");
                    try {
                      const r = await slk.claimVaultFees();
                      toast.success(
                        r.claimedLamports > 0
                          ? `${lamportsToSol(r.claimedLamports)} SOL claimed to your wallet.`
                          : "Vault fees reconciled — your share is now claimable.",
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
                          `${formatTokenAmount(r.tokensOut)} ${TICKER} returned to your shielded wallet as a sealed note.`,
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
          value={`${formatTokenAmount(pool?.depositedTokens ?? 0)} ${TICKER}`}
          sub={`${formatTokenAmount(pool?.totalShares ?? 0)} shares outstanding`}
        />
        <Stat
          label="Treasury fee vault"
          value={`${lamportsToSol(slk.protocol?.treasuryLamports ?? 0)} SOL`}
          accent
          sub="half of every fee — the keeper burns it"
        />
        <Stat
          label="Burned supply"
          value={`${formatTokenAmount(slk.protocol?.burnedTokens ?? 0)} ${TICKER}`}
          sub={`${(((slk.protocol?.burnedTokens ?? 0) / TOTAL_SUPPLY) * 100).toFixed(2)}% of total, gone forever`}
        />
      </div>
    </div>
  );
}

function KeeperCard() {
  const slk = useSolzk();
  const runBuyback = useMutation(api.protocol.executeBuyback);
  const [busy, setBusy] = useState(false);
  const lastAt = slk.protocol?.lastBuybackAt;

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Flame className="size-4 text-primary" /> Fee buyback-and-burn
            (keeper)
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            The keeper sweeps the treasury fee vault, buys {TICKER} out of
            protocol liquidity and burns it — supply only shrinks. Public and
            permissionless: on mainnet it routes through Jupiter; here the
            vault is the counterparty.{lastAt ? ` Last sweep ${new Date(lastAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}.` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await runBuyback({});
              toast.success(
                `Buyback executed: ${formatTokenAmount(r.tokensBurned)} ${TICKER} burned for ${lamportsToSol(r.lamportsSpent)} SOL.`,
              );
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Buyback failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Flame className="mr-1.5 size-4" />
          )}
          Run the sweep
        </Button>
      </CardContent>
    </Card>
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
              Deposit {TICKER} like adding liquidity to a pool. The vault's
              half of the {MINT_FEE_BPS / 100}% mint fee, the 2% transfer fee
              and the {MARKET_FEE_BPS / 100}% market fee flows to depositors,
              pro rata — claimable any time. The vault opens with the mint.
            </p>
          </div>
          <LiquidityPanel />
          <KeeperCard />
        </PageShell>
      </SiteLayout>
    </RequireAuth>
  );
}
