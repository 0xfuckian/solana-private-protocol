import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GradientBadge, Stat } from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/convex/_generated/api";
import {
  MARKET_FEE_BPS,
  TICKER,
  TOTAL_SUPPLY,
  formatTokenAmount,
  lamportsToSol,
} from "@/lib/protocol";
import { useS404 } from "@/lib/s404-context";
import { buildProof, commitmentFor, sealNoteFor } from "@/lib/wallet";
import {
  ArrowDownUp,
  CircleCheck,
  Clock,
  FlaskConical,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
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

const PRICE_MIN = 1_000; // 0.001 SOL per 1k S404
const PRICE_MAX = 100_000_000;

function OrderTicket() {
  const s404 = useS404();
  const place = useMutation(api.market.placeOrder);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("10000");
  const [amount, setAmount] = useState("10000");
  const [busy, setBusy] = useState(false);

  const priceNum = Number(price || 0);
  const amountNum = Number(amount || 0);
  const gross = Math.ceil((amountNum * priceNum) / 1000);
  const fee = Math.ceil((gross * MARKET_FEE_BPS) / 10_000);

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
                    : "bg-[#9945FF]/20 text-[#c9b4ff]"
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

          <Button
            className="w-full bg-sol-gradient py-5 font-semibold text-[#04101a] hover:opacity-90"
            disabled={
              busy ||
              !s404.address ||
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
            Place {side} order
          </Button>
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
          side === "buy" ? "bg-primary/10" : "bg-[#9945FF]/15"
        }`}
        style={{ width: `${(row.price / maxDepth) * 100}%` }}
      />
      <div className="relative flex items-center justify-between gap-2 font-mono-tabular text-sm">
        <span className={side === "buy" ? "text-primary" : "text-[#c9b4ff]"}>
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
          const { proof } = await buildProof(
            `${trade._id}:${commitment}:${JSON.stringify(sealed)}`,
          );
          await settle({
            tradeId: trade._id as never,
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
  const s404 = useS404();
  const book = useQuery(api.market.getBook) as Book | undefined;
  const myOrders = useQuery(api.market.listMyOrders) as MyOrder[] | undefined;
  const myTrades = useQuery(api.market.listMyTrades) as MyTrade[] | undefined;
  const cancel = useMutation(api.market.cancelOrder);
  const openMarket = useMutation(api.market.maybeOpenMarket);
  const simulateSellout = useMutation(api.protocol.simulateSellout);

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
                Math.max(0, TOTAL_SUPPLY - (s404.protocol?.mintedTokens ?? 0)),
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
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-semibold">Devnet control</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Simulation only: jump the mint to its sold-out state to see
                the book open. On mainnet this happens when the last lot is
                minted — not before.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const r = await simulateSellout({});
                  toast.success(
                    r.opened
                      ? "Mint sold out — the book is open."
                      : "Already open.",
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              <FlaskConical className="mr-1.5 size-4" /> Simulate sellout
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const maxBid = Math.max(...book.bids.map((b) => b.price), 1);
  const maxAsk = Math.max(...book.asks.map((a) => a.price), 1);
  const maxDepth = Math.max(maxBid, maxAsk);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div>
        <OrderTicket />
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
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#c9b4ff]">
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
                          o.side === "buy" ? "text-primary" : "text-[#c9b4ff]"
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
