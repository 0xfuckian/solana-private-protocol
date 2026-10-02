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
  assetBySymbol,
  formatAssetUnits,
  formatTokenAmount,
  lamportsToSol,
} from "@/lib/protocol";
import { useSolzk } from "@/lib/solzk-context";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Clock3,
  Droplets,
  Flame,
  HandCoins,
  Layers,
  Loader2,
  Scale,
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

function ClaimsCard() {
  const slk = useSolzk();
  const seed = useMutation(api.protocol.seedClaimsPool);
  const [busy, setBusy] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ slot: number; root: string } | null>(
    null,
  );
  const [last, setLast] = useState<{ paidLamports: number } | null>(null);

  const claimsPoolTokens = slk.protocol?.claimsPoolTokens ?? 0;
  const lastAnchorAt = slk.protocol?.lastAnchorAt;

  const claimSize = 1_000; // demo claim: 1,000 SOLZK held at the anchor
  const canClaim =
    anchor !== null &&
    slk.notes.some((n) => n.value >= claimSize) &&
    claimsPoolTokens > 0;

  return (
    <Card className="border-dashed">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="size-4 text-primary" /> ZK fee-share claims
          </p>
          <GradientBadge>pro-rata · private</GradientBadge>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Prove you held value at a past anchor without revealing who you are
          or how much you hold now — the circuit's answer to fee sharing.
          Checkpoint the anchor, then claim your slice of the claims pool.
        </p>

        {claimsPoolTokens === 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("seed");
              try {
                const r = await seed({});
                toast.success(
                  r.seeded
                    ? `Claims pool funded with ${formatTokenAmount(r.tokens ?? 0)} ${TICKER}.`
                    : "Claims pool already funded.",
                );
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Seed failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "seed" ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Scale className="mr-1.5 size-3.5" />
            )}
            Fund the claims pool (devnet)
          </Button>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
              <span className="text-muted-foreground">Claims pool</span>
              <span className="font-mono-tabular">
                {formatTokenAmount(claimsPoolTokens)} {TICKER}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Anchor{lastAnchorAt ? ` · ${new Date(lastAnchorAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
              <span className="font-mono-tabular">
                {anchor
                  ? `slot ${anchor.slot.toLocaleString()} · ${anchor.root.slice(0, 12)}…`
                  : "not checkpointed"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("anchor");
                  try {
                    const a = await slk.checkpointAnchor();
                    setAnchor(a);
                    toast.success(`Anchor checkpointed at slot ${a.slot.toLocaleString()}.`);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Checkpoint failed");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === "anchor" ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 size-3.5" />
                )}
                Checkpoint anchor
              </Button>
              <Button
                size="sm"
                className="bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
                disabled={!canClaim || busy !== null}
                onClick={async () => {
                  if (!anchor) return;
                  setBusy("claim");
                  try {
                    const r = await slk.claimFeeShare(
                      claimSize,
                      anchor.slot,
                      anchor.root,
                    );
                    setLast({ paidLamports: r.paidLamports });
                    toast.success(
                      `Fee share claimed — ${lamportsToSol(r.paidLamports)} SOL paid to your wallet. The proof revealed only the claim size.`,
                    );
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Claim failed");
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
                Claim {formatTokenAmount(claimSize)}-holder share
              </Button>
            </div>
            {last && (
              <p className="text-[11px] text-muted-foreground">
                Last claim paid {lamportsToSol(last.paidLamports)} SOL. Each
                (wallet, anchor, size) claim is one-time — nullifier-bound.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssetShieldCard() {
  const slk = useSolzk();
  const myAssets = useQuery(
    api.protocol.getMyAssets,
    slk.phase === "unlocked" ? {} : "skip",
  ) as { symbol: string; units: number }[] | undefined;
  const [symbol, setSymbol] = useState("USDC");
  const [units, setUnits] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const asset = assetBySymbol(symbol);
  const unitsNum = Number(units) || 0;
  const transparent = myAssets?.find((a) => a.symbol === symbol)?.units ?? 0;
  const sealedBalance = slk.notes
    .filter((n) => n.memo === `asset:${symbol}`)
    .reduce((acc, n) => acc + n.value, 0);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Multi-asset shield</h2>
          <Layers className="size-4 text-primary" />
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Wrap any SPL asset into the sealed-note format. The asset id is a
          public input to the join-split; amounts and owners stay hidden.
          Devnet ships three mock assets with a faucet.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {["USDC", "BONK", "JUP"].map((s) => (
            <button
              key={s}
              onClick={() => {
                setSymbol(s);
                setUnits("");
              }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                symbol === s
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/70 text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Transparent balance</span>
            <span className="font-mono-tabular">
              {asset ? formatAssetUnits(symbol, transparent) : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sealed (shielded)</span>
            <span className="font-mono-tabular text-primary">
              {asset ? formatAssetUnits(symbol, sealedBalance) : "—"}
            </span>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            type="number"
            placeholder="Raw units"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="font-mono-tabular"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || unitsNum <= 0 || unitsNum > transparent}
            onClick={async () => {
              setBusy("shield");
              try {
                await slk.shieldAsset(symbol, unitsNum);
                toast.success(`${symbol} shielded — the note hides amount and owner.`);
                setUnits("");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Shield failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "shield" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowDownToLine className="size-3.5" />
            )}
            Shield
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              busy !== null ||
              unitsNum <= 0 ||
              sealedBalance < unitsNum
            }
            onClick={async () => {
              setBusy("unshield");
              try {
                await slk.unshieldAsset(symbol, unitsNum);
                toast.success(`${symbol} unshielded to your transparent balance.`);
                setUnits("");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Unshield failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "unshield" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowUpFromLine className="size-3.5" />
            )}
            Unshield
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("faucet");
            try {
              await slk.assetFaucet(symbol);
              toast.success(`Devnet ${symbol} granted.`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Faucet failed");
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "faucet" ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <Droplets className="mr-1.5 size-3.5 text-primary" />
          )}
          Asset faucet
        </Button>
      </CardContent>
    </Card>
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
          <div className="grid gap-6 lg:grid-cols-2">
            <ClaimsCard />
            <AssetShieldCard />
          </div>
        </PageShell>
      </SiteLayout>
    </RequireAuth>
  );
}
