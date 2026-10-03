import { spendStatement, sealedStatement } from "@/lib/spend";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GradientBadge, Stat } from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/convex/_generated/api";
import {
  MARKET_FEE_BPS,
  REDEEM_LAMPORTS_PER_TOKEN,
  TICKER,
  TOTAL_SUPPLY,
  formatTokenAmount,
  lamportsToSol,
} from "@/lib/protocol";
import { useMemo } from "react";
import { useSolzk } from "@/lib/solzk-context";
import { buildProof, commitmentFor, sealNoteFor } from "@/lib/wallet";
import {
  ArrowDownUp,
  CircleCheck,
  Clock,
  ExternalLink,
  Flame,
  Loader2,
  Lock,
  ShieldCheck,
  Shuffle,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

interface BookRow {
  orderId: string;
  price: number;
  remaining: number;
  created: number;
}

interface Book {
  marketOpen: boolean;
  bids: BookRow[];
  asks: BookRow[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  lastPrice: number | null;
}

interface MyOrder {
  _id: string;
  side: string;
  priceLamportsPerKilo: number;
  amountTokens: number;
  filledTokens: number;
  status: string;
  createdAt: number;
}

interface MyTrade {
  _id: string;
  tokens: number;
  lamports: number;
  feeLamports: number;
  status: string;
  createdAt: number;
  buyerAddress: string;
  sellerAddress: string;
  iAmBuyer: boolean;
}

const PRICE_MIN = 1_000; // 0.001 SOL per 1k SOLZK
const PRICE_MAX = 100_000_000;

/**
 * Price discovery header — after sellout this book IS the price of SOLZK.
 * Last trade, best bid, best ask, spread, at a glance.
 */
function PriceHeader({ book }: { book: Book }) {
  const fmt = (p: number | null) =>
    p === null ? "—" : `${lamportsToSol(p)} SOL`;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Last trade"
        value={fmt(book.lastPrice)}
        accent
        sub={`per 1,000 ${TICKER} — the reference price`}
      />
      <Stat
        label="Best bid"
        value={fmt(book.bestBid)}
        sub={book.bids.length ? `${book.bids.length} buy offer${book.bids.length === 1 ? "" : "s"} on the book` : "no buy offers yet"}
      />
      <Stat
        label="Best ask"
        value={fmt(book.bestAsk)}
        sub={book.asks.length ? `${book.asks.length} sell offer${book.asks.length === 1 ? "" : "s"} on the book` : "no sell offers yet"}
      />
      <Stat
        label="Spread"
        value={
          book.spread === null
            ? "—"
            : book.spread === 0
              ? "crossed"
              : `${lamportsToSol(book.spread)} SOL`
        }
        sub={
          book.bids.length === 0 && book.asks.length === 0
            ? "the book is empty — list the first offer"
            : book.spread !== null && book.spread < 0
              ? "crossed — a fill will execute now"
              : "ask minus bid"
        }
      />
    </div>
  );
}

function OrderTicket() {
  const slk = useSolzk();
  const place = useMutation(api.market.placeOrder);
  const book = useQuery(api.market.getBook) as Book | undefined;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState<string>("");
  const [amount, setAmount] = useState("10000");
  const [busy, setBusy] = useState(false);

  // Default the price from the book the moment it loads, so new offers
  // land at the market instead of a hardcoded number: buying joins the
  // best ask, selling joins the best bid.
  const bookPrice = book
    ? side === "buy"
      ? book.bestAsk
      : book.bestBid
    : null;
  useEffect(() => {
    if (bookPrice && price === "") setPrice(String(bookPrice));
  }, [bookPrice, price]);
  // Re-price when switching sides with an untouched field.
  useEffect(() => {
    if (book && price === String(side === "buy" ? book.bestBid : book.bestAsk)) {
      setPrice(String(bookPrice ?? ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  const priceNum = Number(price || 0);
  const amountNum = Number(amount || 0);
  const gross = Math.ceil((amountNum * priceNum) / 1000);
  const fee = Math.ceil((gross * MARKET_FEE_BPS) / 10_000);

  // Crossed-order preview: a buy at or above the best ask (or a sell at or
  // below the best bid) can fill immediately against the resting offer.
  const crosses =
    book && priceNum > 0
      ? side === "buy"
        ? book.bestAsk !== null && priceNum >= book.bestAsk
        : book.bestBid !== null && priceNum <= book.bestBid
      : false;

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-base font-semibold">Signed limit order</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Orders are intents, not deposits — your coins and your notes stay
          yours until a trade settles.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`rounded-md py-2 text-sm font-semibold capitalize transition-colors ${
                side === s
                  ? s === "buy"
                    ? "bg-primary/15 text-primary"
                    : "bg-tier-obsidian/20 text-tier-obsidian"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">
              Price (SOL per 1,000 {TICKER})
            </label>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 font-mono-tabular"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Amount ({TICKER})
            </label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 font-mono-tabular"
            />
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {side === "buy" ? "You pay" : "You receive"}
              </span>
              <span className="font-mono-tabular">
                {lamportsToSol(gross)} SOL
              </span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>includes {MARKET_FEE_BPS / 100}% market fee</span>
              <span className="font-mono-tabular">
                {lamportsToSol(fee)} SOL
              </span>
            </div>
          </div>

          {crosses && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
              This price crosses the book — it can fill immediately against
              the resting {side === "buy" ? "ask" : "bid"} when someone takes
              it.
            </p>
          )}
          <Button
            className="w-full bg-sol-gradient py-5 font-semibold text-[#04101a] hover:opacity-90"
            disabled={
              busy ||
              !slk.address ||
              priceNum < PRICE_MIN ||
              priceNum > PRICE_MAX ||
              amountNum < 1000
            }
            onClick={async () => {
              setBusy(true);
              try {
                await place({
                  side,
                  priceLamportsPerKilo: priceNum,
                  amountTokens: amountNum,
                });
                toast.success(
                  `${side === "buy" ? "Bid" : "Ask"} placed on the book.`,
                );
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Order failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ArrowDownUp className="mr-2 size-4" />
            )}
            List {side === "buy" ? "buy" : "sell"} offer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SwapCard() {
  const slk = useSolzk();
  const [direction, setDirection] = useState<"sol_to_tokens" | "tokens_to_sol">(
    "sol_to_tokens",
  );
  const [solAmt, setSolAmt] = useState("0.5");
  const [tokAmt, setTokAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const pool = slk.swapPool;
  const solNum = Number(solAmt) || 0;
  const tokNum = Number(tokAmt) || 0;

  const quote = useMemo(() => {
    if (!pool?.open) return null;
    return direction === "sol_to_tokens"
      ? slk.quoteSwapSol(Math.round(solNum * 100_000_000))
      : slk.quoteSwapTokens(tokNum);
  }, [direction, solNum, tokNum, pool, slk]);

  if (!pool) return null;

  if (!pool.open) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Private swap</h2>
            <Shuffle className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            A constant-product pool owned by the protocol — swap {TICKER} for
            SOL and back without an order book, without unshielding. The
            pool reserves need seeding once.
          </p>
          <p className="mt-4 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
            The pool is not funded yet. Reserves come from real protocol
            liquidity only — they fill as the mint routes its 95% liquidity in.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Private swap</h2>
          <GradientBadge>0.3% · to the vault + treasury</GradientBadge>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Route through the protocol pool without an order book. SOL→{TICKER}
          {" "}seals the output as a note; {TICKER}→SOL spends notes by
          nullifier. The node never sees the shielded leg.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
          {([
            ["sol_to_tokens", `SOL → ${TICKER}`],
            ["tokens_to_sol", `${TICKER} → SOL`],
          ] as const).map(([d, label]) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`rounded-md py-2 text-xs font-semibold transition-colors ${
                direction === d
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <Input
            type="number"
            placeholder={direction === "sol_to_tokens" ? "Amount (SOL)" : `Amount (${TICKER})`}
            value={direction === "sol_to_tokens" ? solAmt : tokAmt}
            onChange={(e) =>
              direction === "sol_to_tokens"
                ? setSolAmt(e.target.value)
                : setTokAmt(e.target.value)
            }
            className="font-mono-tabular"
          />
          <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mid price</span>
              <span className="font-mono-tabular">
                {pool.midPriceLamportsPerToken > 0
                  ? `${lamportsToSol(Math.round(pool.midPriceLamportsPerToken))} SOL / ${TICKER}`
                  : "—"}
              </span>
            </div>
            {quote && (
              <>
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">You receive</span>
                  <span className="font-mono-tabular text-primary">
                    {direction === "sol_to_tokens"
                      ? `${formatTokenAmount(quote.outAmount)} ${TICKER}`
                      : `${lamportsToSol(quote.outAmount)} SOL`}
                  </span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">
                    Fee + impact
                  </span>
                  <span className="font-mono-tabular">
                    {lamportsToSol(quote.feeLamports)} SOL · {quote.priceImpactPct < 0.01 ? "<0.01" : quote.priceImpactPct.toFixed(2)}%
                  </span>
                </div>
              </>
            )}
          </div>
          <Button
            className="w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
            disabled={
              busy ||
              !quote ||
              (direction === "sol_to_tokens"
                ? solNum <= 0 ||
                  solNum * 100_000_000 > (slk.serverWallet?.fundingLamports ?? 0)
                : tokNum <= 0 || tokNum > slk.balance)
            }
            onClick={async () => {
              setBusy(true);
              try {
                if (direction === "sol_to_tokens") {
                  const lamportsIn = Math.round(solNum * 100_000_000);
                  const q = slk.quoteSwapSol(lamportsIn);
                  if (!q) throw new Error("No quote — try again.");
                  const r = (await slk.swap("sol_to_tokens", lamportsIn, q.outAmount)) as {
                    tokensOut: number;
                  };
                  toast.success(
                    `Swapped — ${formatTokenAmount(r.tokensOut)} ${TICKER} sealed to your wallet.`,
                  );
                  setSolAmt("");
                } else {
                  const q = slk.quoteSwapTokens(tokNum);
                  if (!q) throw new Error("No quote — try again.");
                  const r = (await slk.swap("tokens_to_sol", tokNum, q.outAmount)) as {
                    lamportsOut: number;
                  };
                  toast.success(
                    `Swapped — ${lamportsToSol(r.lamportsOut)} SOL paid to your wallet.`,
                  );
                  setTokAmt("");
                }
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Swap failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Shuffle className="mr-2 size-4" />
            )}
            Swap privately
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RedeemCard() {
  const slk = useSolzk();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ netLamports: number; signature: string } | null>(null);

  const amountNum = Number(amount) || 0;
  const gross = Math.floor(amountNum * REDEEM_LAMPORTS_PER_TOKEN);
  const fee = Math.ceil((gross * MARKET_FEE_BPS) / 10_000);
  const net = gross - fee;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Redeem to SOL</h2>
          <Flame className="size-4 text-primary" />
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          The private exit: burn notes, receive SOL from the protocol
          liquidity reserve at the exit rate. The ledger sees a burn and a
          payout — never your balance, never a link.
        </p>
        <div className="mt-4 space-y-3">
          <Input
            type="number"
            placeholder={`Amount (${TICKER})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-mono-tabular"
          />
          <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Exit rate</span>
              <span className="font-mono-tabular">
                {lamportsToSol(REDEEM_LAMPORTS_PER_TOKEN)} SOL per {TICKER}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">
                Exit fee ({MARKET_FEE_BPS / 100}%) — half to the vault
              </span>
              <span className="font-mono-tabular">{lamportsToSol(fee)} SOL</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border/50 pt-1">
              <span className="text-muted-foreground">You receive</span>
              <span className="font-mono-tabular text-primary">
                {lamportsToSol(net)} SOL
              </span>
            </div>
          </div>
          <Button
            className="w-full bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
            disabled={busy || amountNum <= 0 || amountNum > slk.balance}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await slk.redeemTokens(amountNum);
                setLast({ netLamports: r.netLamports, signature: r.signature });
                toast.success(
                  `Redeemed — ${lamportsToSol(r.netLamports)} SOL sent to your wallet. Tokens burned.`,
                );
                setAmount("");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Redeem failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Flame className="mr-2 size-4" />
            )}
            Burn {amountNum > 0 ? formatTokenAmount(amountNum) : ""} {TICKER} → SOL
          </Button>
          {last && (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ExternalLink className="size-3" /> Last redemption in the burn
              feed —
              <Link to={`/explorer?tx=${last.signature}`} className="text-primary hover:underline">
                view the receipt
              </Link>
            </p>
          )}
          <p className="text-[11px] leading-4 text-muted-foreground">
            Exits are deflationary: every redeemed {TICKER} leaves the supply
            forever, and the SOL comes out of the 95% mint liquidity reserve.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function FillRow({
  row,
  side,
  maxDepth,
}: {
  row: BookRow;
  side: "buy" | "sell";
  maxDepth: number;
}) {
  const takeOrder = useMutation(api.market.takeOrder);
  const [filling, setFilling] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border/60 px-3 py-2">
      <div
        className={`absolute inset-y-0 left-0 ${
          side === "buy" ? "bg-primary/10" : "bg-tier-obsidian/15"
        }`}
        style={{ width: `${(row.price / maxDepth) * 100}%` }}
      />
      <div className="relative flex items-center justify-between gap-2 font-mono-tabular text-sm">
        <span className={side === "buy" ? "text-primary" : "text-tier-obsidian"}>
          {lamportsToSol(row.price)}
        </span>
        <span>{formatTokenAmount(row.remaining)}</span>
        <button
          className="rounded-md border border-border/70 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          disabled={filling}
          onClick={async () => {
            setFilling(true);
            try {
              const res = await takeOrder({
                orderId: row.orderId as never,
                amountTokens: row.remaining,
              });
              toast.success(
                `Filled ${formatTokenAmount(res.tokens)} ${TICKER} for ${lamportsToSol(res.lamports)} SOL.`,
              );
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Fill failed");
            } finally {
              setFilling(false);
            }
          }}
        >
          {filling ? "…" : side === "buy" ? "Sell" : "Buy"}
        </button>
      </div>
    </div>
  );
}

function SettleButton({ trade }: { trade: MyTrade }) {
  const slk = useSolzk();
  const settle = useMutation(api.market.settleTrade);
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      className="bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = crypto.randomUUID();
          const buyer = trade.buyerAddress;
          const sealed = await sealNoteFor(buyer, {
            value: trade.tokens,
            memo: "trade",
            r,
          });
          const commitment = await commitmentFor(trade.tokens, r, buyer);
          const spend = await slk.buildSpend(trade.tokens);
          const { proof } = await buildProof(spendStatement(`trade:${trade._id}:${commitment}:${sealedStatement(sealed)}`, spend));
          await settle({
            tradeId: trade._id as never,
            nullifiers: spend.nullifiers,
            inputTotal: spend.inputTotal,
            change: spend.change,
            sealedNote: sealed,
            commitment,
            proof,
          });
          toast.success("Trade settled — the SOL leg is released to you.");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Settlement failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
      ) : (
        <ShieldCheck className="mr-1.5 size-3.5" />
      )}
      Settle
    </Button>
  );
}

function MarketInner() {
  const slk = useSolzk();
  const book = useQuery(api.market.getBook) as Book | undefined;
  const myOrders = useQuery(api.market.listMyOrders) as MyOrder[] | undefined;
  const myTrades = useQuery(api.market.listMyTrades) as MyTrade[] | undefined;
  const cancel = useMutation(api.market.cancelOrder);
  const openMarket = useMutation(api.market.maybeOpenMarket);

  // Flipping the market open at sellout — there is no button.
  useEffect(() => {
    void openMarket({}).catch(() => undefined);
  }, [openMarket]);

  if (!book?.marketOpen) {
    return (
      <div className="space-y-6">
        <Card className="border-sol-gradient">
          <CardContent className="p-10 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <Lock className="size-6 text-primary" />
            </div>
            <h2 className="mt-4 text-xl font-semibold">
              The book is readable but closed
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              Orders are refused by the node, not merely hidden by the page.
              Trading opens when the mint sells out —{" "}
              {formatTokenAmount(
                Math.max(0, TOTAL_SUPPLY - (slk.protocol?.mintedTokens ?? 0)),
              )}{" "}
              {TICKER} still unminted.
            </p>
          </CardContent>
        </Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Market fee"
            value={`${MARKET_FEE_BPS / 100}%`}
            sub="on every trade"
          />
          <Stat
            label="Settlement"
            value="SOL + notes"
            sub="no custody at any point"
          />
          <Stat
            label="Orders"
            value="intents"
            sub="your coins and notes stay yours until a trade settles"
          />
        </div>
      </div>
    );
  }

  const maxBid = Math.max(...book.bids.map((b) => b.price), 1);
  const maxAsk = Math.max(...book.asks.map((a) => a.price), 1);
  const maxDepth = Math.max(maxBid, maxAsk);

  return (
    <div className="space-y-6">
      <PriceHeader book={book} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-6">
        <OrderTicket />
        <SwapCard />
        <RedeemCard />
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {TICKER} / SOL — order book
              </h2>
              <GradientBadge>
                <span className="size-1.5 rounded-full bg-primary sol-pulse" />
                live
              </GradientBadge>
            </div>
            <p className="mt-2 font-mono-tabular text-[11px] text-muted-foreground">
              After sellout this book is the price of {TICKER}: list a buy or
              sell offer, someone takes it, the trade prints the price.
              Run the sellout control below to open the book and backfill mint
              fees to the vault.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-6">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  Bids
                </p>
                {book.bids.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bids yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {book.bids.map((b) => (
                      <FillRow
                        key={String(b.orderId)}
                        row={b}
                        side="buy"
                        maxDepth={maxDepth}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-tier-obsidian">
                  Asks
                </p>
                {book.asks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No asks yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {book.asks.map((a) => (
                      <FillRow
                        key={String(a.orderId)}
                        row={a}
                        side="sell"
                        maxDepth={maxDepth}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              A trade is two legs between two people: the SOL leg, verified
              against the ledger, and the shielded leg, which the node cannot
              see and only the receiver can attest to. That asymmetry is the
              protocol working, not a gap in it.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="p-6">
              <h2 className="text-base font-semibold">My orders</h2>
              <div className="mt-3 space-y-2">
                {(myOrders ?? []).slice(0, 8).map((o) => (
                  <div
                    key={o._id}
                    className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5 text-sm"
                  >
                    <div>
                      <span
                        className={
                          o.side === "buy" ? "text-primary" : "text-tier-obsidian"
                        }
                      >
                        {o.side.toUpperCase()}
                      </span>{" "}
                      <span className="font-mono-tabular">
                        {formatTokenAmount(o.amountTokens - o.filledTokens)}
                      </span>{" "}
                      @ {lamportsToSol(o.priceLamportsPerKilo)}
                    </div>
                    {o.status === "open" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            await cancel({ orderId: o._id as never });
                            toast.success("Order cancelled.");
                          } catch (e) {
                            toast.error(
                              e instanceof Error ? e.message : "Cancel failed",
                            );
                          }
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : (
                      <span className="text-xs capitalize text-muted-foreground">
                        {o.status}
                      </span>
                    )}
                  </div>
                ))}
                {(myOrders ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No orders yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h2 className="text-base font-semibold">My trades</h2>
              <div className="mt-3 space-y-2">
                {(myTrades ?? []).slice(0, 8).map((t) => (
                  <div
                    key={t._id}
                    className="rounded-lg border border-border/60 px-3 py-2.5 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tabular">
                        {t.iAmBuyer ? "Bought" : "Sold"}{" "}
                        {formatTokenAmount(t.tokens)} {TICKER}
                      </span>
                      <span className="font-mono-tabular text-muted-foreground">
                        {lamportsToSol(t.lamports)} SOL
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {t.status === "settled" ? (
                          <>
                            <CircleCheck className="size-3 text-primary" />{" "}
                            settled
                          </>
                        ) : (
                          <>
                            <Clock className="size-3" /> pending settlement
                          </>
                        )}
                      </span>
                      {t.status === "pending_settlement" && !t.iAmBuyer && (
                        <SettleButton trade={t} />
                      )}
                      {t.status === "pending_settlement" && t.iAmBuyer && (
                        <span className="text-xs text-muted-foreground">
                          waiting for the seller
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {(myTrades ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No trades yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
}

export default function Market() {
  return (
    <RequireAuth>
      <SiteLayout>
        <PageShell wide>
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight">Market</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A signed limit order book settled in SOL, with no custody at any
              point.
            </p>
          </div>
          <MarketInner />
        </PageShell>
      </SiteLayout>
    </RequireAuth>
  );
}
