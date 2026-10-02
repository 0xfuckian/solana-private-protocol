import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GradientBadge, Stat } from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { SimulationControls } from "@/components/site/SimulationControls";
import { api } from "@/convex/_generated/api";
import {
  ENVELOPE_MINT_BYTES,
  ENVELOPE_TRANSFER_BYTES,
  TICKER,
  TOTAL_SUPPLY,
  formatTokenAmount,
  lamportsToSol,
  shortHash,
} from "@/lib/protocol";
import { currentSlot, slotToTimestamp } from "@/lib/useSolzk";
import {
  ArrowRight,
  Boxes,
  FileText,
  Fingerprint,
  Flame,
  Layers,
  Search,
  ShieldCheck,
  Shuffle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router";

interface EnvelopeListItem {
  _id: string;
  kind: string;
  signature: string;
  slot: number;
  payloadSize: number;
  feeLamports: number;
  feeInNote?: boolean;
  createdAt: number;
}

interface BurnRow {
  _id: string;
  kind: string;
  tokensBurned: number;
  lamportsSpent: number;
  signature: string;
  slot: number;
  createdAt: number;
}

interface SwapRow {
  _id: string;
  direction: string;
  solLamportsIn: number;
  solLamportsOut: number;
  tokensIn: number;
  tokensOut: number;
  feeLamports: number;
  slot: number;
  createdAt: number;
}

interface AssetEventRow {
  _id: string;
  kind: string;
  symbol: string;
  units: number;
  slot: number;
  createdAt: number;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Explorer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get("tx");
  const [query, setQuery] = useState("");

  const state = useQuery(api.protocol.getState);
  const { results: envelopes, status: feedStatus, loadMore } = usePaginatedQuery(api.explorer.listEnvelopes, {}, { initialNumItems: 100 });
  const [kindFilter, setKindFilter] = useState("all");
  const [since, setSince] = useState("");
  const burns = useQuery(api.protocol.listBurns, { limit: 10 }) as
    | BurnRow[]
    | undefined;
  const swaps = useQuery(api.swap.listSwaps, { limit: 10 }) as
    | SwapRow[]
    | undefined;
  const assetEvents = useQuery(api.protocol.listAssetEvents, { limit: 10 }) as
    | AssetEventRow[]
    | undefined;
  const detail = useQuery(
    api.protocol.getEnvelope,
    selected ? { signature: selected } : "skip",
  );

  const filtered = useMemo(() => {
    if (!envelopes) return undefined;
    const q = query.trim().toLowerCase();
    return envelopes.filter(e =>
      (kindFilter === "all" || e.kind === kindFilter) &&
      (!since || e.createdAt >= new Date(`${since}T00:00:00`).getTime()) &&
      (!q || e.signature.toLowerCase().includes(q) || e.kind.toLowerCase().includes(q) || String(e.slot).includes(q))
    );
  }, [envelopes, query, kindFilter, since]);

  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <SiteLayout>
      <PageShell wide>
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Explorer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Receipts indexed from the ledger. Filters apply to loaded pages.
            Public mint prices and fee splits are decoded below.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search signature or slot…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 font-mono-tabular"
          />
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3"><select aria-label="Envelope kind" value={kindFilter} onChange={e => setKindFilter(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm"><option value="all">All envelopes</option><option value="mint">Mint</option><option value="transfer">Transfer</option></select><Input aria-label="From date" type="date" value={since} onChange={e => setSince(e.target.value)} className="w-auto"/><span className="text-xs text-muted-foreground">{envelopes.length} receipts loaded</span></div>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Slot"
          value={currentSlot().toLocaleString()}
          sub="~2.5 slots/sec, Solana pace"
          accent
        />
        <Stat
          label="Envelopes"
          value={envelopes ? String(envelopes.length) : "—"}
          sub="mints and transfers"
        />
        <Stat
          label="Sealed notes"
          value={
            state ? formatTokenAmount(state.notesCount) : "—"
          }
          sub="commitments in the pool"
        />
        <Stat
          label="Nullifiers"
          value={
            state ? formatTokenAmount(state.nullifiersCount) : "—"
          }
          sub="spends — unlinkable to notes"
        />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Effective supply"
          value={
            state
              ? formatTokenAmount(
                  TOTAL_SUPPLY - (state.burnedTokens ?? 0),
                )
              : "—"
          }
          accent
          sub={`${TICKER} still in existence`}
        />
        <Stat
          label="Burned"
          value={state ? formatTokenAmount(state.burnedTokens ?? 0) : "—"}
          sub="buybacks + tier burns + exits"
        />
        <Stat
          label="Treasury fee vault"
          value={
            state ? `${lamportsToSol(state.treasuryLamports)} SOL` : "—"
          }
          sub="half of every fee, awaiting the buyback"
        />
        <Stat
          label="Relayer fee vault"
          value={
            state ? `${formatTokenAmount(state.relayerFeesTokens ?? 0)} ${TICKER}` : "—"
          }
          sub="in-note fees, public on chain"
        />
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4 text-sm"><p className="font-medium">Separate {TICKER} fee reserves</p><p className="mt-2 font-mono text-primary">Treasury {formatTokenAmount(state?.treasuryTokens ?? 0)} · vault rewards {formatTokenAmount(state?.vaultFeeTokens ?? 0)} {TICKER}</p><p className="mt-2 text-xs text-muted-foreground">Retained token reserves; not SOL balances or currently claimable rewards. Historical misclassified fees have not been migrated.</p></div>
      {detail?.envelope ? (
        <Card className="border-sol-gradient mb-8">
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`flex size-10 items-center justify-center rounded-xl ${
                    detail.envelope.kind === "mint"
                      ? "bg-primary/10 text-primary"
                      : "bg-tier-obsidian/15 text-tier-obsidian"
                  }`}
                >
                  {detail.envelope.kind === "mint" ? (
                    <Boxes className="size-5" />
                  ) : (
                    <Fingerprint className="size-5" />
                  )}
                </div>
                <div>
                  <p className="font-semibold capitalize">
                    {detail.envelope.kind} envelope
                  </p>
                  <p className="font-mono-tabular text-xs text-muted-foreground">
                    {detail.envelope.signature}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchParams({})}
              >
                Back to all envelopes
              </Button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Slot"
                value={detail.envelope.slot.toLocaleString()}
                sub={fmtTime(slotToTimestamp(detail.envelope.slot))}
              />
              <Stat
                label="Payload"
                value={`${detail.envelope.payloadSize} bytes`}
                sub={
                  detail.envelope.kind === "mint"
                    ? "uniform mint size"
                    : "uniform transfer size"
                }
              />
              <Stat
                label="Protocol fee"
                value={detail.envelope.feeDenomination === "SOLZK" ? `${formatTokenAmount(detail.envelope.feeTokens ?? 0)} ${TICKER}` : `${lamportsToSol(detail.envelope.feeLamports)} SOL`}
                sub={
                  detail.envelope.feeInNote
                    ? "relayer paid from the note itself — sender spent no SOL"
                    : "paid from the relayer's own coins"
                }
              />
              <Stat
                label="Proof"
                value={shortHash(detail.envelope.proof)}
                sub="commits to every byte"
              />
            </div>

            <div className="mt-5 rounded-xl border border-border/70 bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Envelope payload (opaque)
              </p>
              <p className="mt-2 break-all font-mono-tabular text-[11px] leading-5 text-muted-foreground">
                {detail.envelope.payload}
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-border/70 bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Proof
              </p>
              <p className="mt-2 break-all font-mono-tabular text-[11px] leading-5 text-muted-foreground">
                {detail.envelope.proof}
              </p>
            </div>

            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              This page shows you every byte the ledger holds: when the
              envelope landed, how big it is, what the relayer paid, and an
              opaque proof. Who owns the note, how much moved, and who sent
              it are not here — they are inside the ciphertext, readable only
              with the owner's key.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="text-base font-semibold">Envelope feed</h2>
            <GradientBadge>
              <span className="size-1.5 rounded-full bg-primary sol-pulse" />
              indexed receipts
            </GradientBadge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Signature</th>
                  <th className="px-6 py-3 font-medium">Kind</th>
                  <th className="px-6 py-3 font-medium">Slot</th>
                  <th className="px-6 py-3 font-medium">Size</th>
                  <th className="px-6 py-3 font-medium">Fee</th>
                  <th className="px-6 py-3 font-medium">Time</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="font-mono-tabular">
                {filtered === undefined ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                      Loading the pool…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                      No envelopes yet — the pool is empty. Mint to publish the
                      first one.
                    </td>
                  </tr>
                ) : (
                  filtered.map((e) => (
                    <tr
                      key={e._id}
                      className="border-b border-border/40 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-6 py-3">
                        <Link
                          to={`/explorer?tx=${e.signature}`}
                          className="text-primary hover:underline"
                        >
                          {shortHash(e.signature)}
                        </Link>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            e.kind === "mint"
                              ? "bg-primary/10 text-primary"
                              : "bg-tier-obsidian/15 text-tier-obsidian"
                          }`}
                        >
                          {e.kind}
                          {e.decodedMint ? ` · ${e.decodedMint.lots} lots · ${e.decodedMint.tier}` : ""}
                          {e.feeInNote ? " · in-note" : ""}
                        </span>
                      </td>
                      <td className="px-6 py-3">{e.slot.toLocaleString()}</td>
                      <td className="px-6 py-3">{e.payloadSize} B</td>
                      <td className="px-6 py-3">
                        {e.feeDenomination === "SOLZK" ? `${formatTokenAmount(e.feeTokens ?? e.feeLamports)} ${TICKER}` : `${lamportsToSol(e.feeLamports)} SOL`}
                        <p className="mt-1 text-[10px] text-muted-foreground">Vault {e.feeSplit.vault} / treasury {e.feeSplit.treasury} {e.feeDenomination}</p>
                        {e.decodedMint && <p className="mt-1 text-[10px] text-muted-foreground">Price {lamportsToSol(e.decodedMint.priceUnits)} SOL</p>}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {fmtTime(e.createdAt)}
                      </td>
                      <td className="px-6 py-3">
                        <ArrowRight className="size-3.5 text-muted-foreground" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="my-5 flex justify-center"><Button variant="outline" disabled={feedStatus !== "CanLoadMore"} onClick={() => loadMore(100)}>{feedStatus === "LoadingMore" ? "Loading…" : feedStatus === "Exhausted" ? "All receipts loaded" : "Load 100 more"}</Button></div>
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Flame className="size-4 text-primary" /> Burn feed
            </h2>
            <GradientBadge>supply only shrinks</GradientBadge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Kind</th>
                  <th className="px-6 py-3 font-medium">Burned</th>
                  <th className="px-6 py-3 font-medium">SOL leg</th>
                  <th className="px-6 py-3 font-medium">Slot</th>
                  <th className="px-6 py-3 font-medium">Signature</th>
                  <th className="px-6 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="font-mono-tabular">
                {burns === undefined ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : burns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-muted-foreground">
                      No burns yet. The keeper sweeps the treasury fee vault
                      from the Vault page; exits burn from the Market.
                    </td>
                  </tr>
                ) : (
                  burns.map((b) => (
                    <tr
                      key={b._id}
                      className="border-b border-border/40 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-6 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            b.kind === "buyback"
                              ? "bg-primary/10 text-primary"
                              : b.kind === "redeem"
                                ? "bg-tier-obsidian/15 text-tier-obsidian"
                                : "bg-secondary text-foreground"
                          }`}
                        >
                          {b.kind}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {formatTokenAmount(b.tokensBurned)} {TICKER}
                      </td>
                      <td className="px-6 py-3">
                        {b.lamportsSpent > 0
                          ? `${lamportsToSol(b.lamportsSpent)} SOL`
                          : "—"}
                      </td>
                      <td className="px-6 py-3">{b.slot.toLocaleString()}</td>
                      <td className="px-6 py-3 text-xs text-muted-foreground">
                        {shortHash(b.signature, 10, 6)}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {fmtTime(b.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-8">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Shuffle className="size-4 text-primary" /> Private swap feed
            </h2>
            <GradientBadge>reserves move, identities don't</GradientBadge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Direction</th>
                  <th className="px-6 py-3 font-medium">Amount in</th>
                  <th className="px-6 py-3 font-medium">Amount out</th>
                  <th className="px-6 py-3 font-medium">Fee</th>
                  <th className="px-6 py-3 font-medium">Slot</th>
                  <th className="px-6 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="font-mono-tabular">
                {swaps === undefined ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : swaps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-muted-foreground">
                      No swaps yet — the pool lives on the Market page.
                    </td>
                  </tr>
                ) : (
                  swaps.map((s) => (
                    <tr
                      key={s._id}
                      className="border-b border-border/40 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-6 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            s.direction === "sol_to_tokens"
                              ? "bg-primary/10 text-primary"
                              : "bg-tier-obsidian/15 text-tier-obsidian"
                          }`}
                        >
                          {s.direction === "sol_to_tokens" ? `SOL → ${TICKER}` : `${TICKER} → SOL`}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {s.solLamportsIn > 0
                          ? `${lamportsToSol(s.solLamportsIn)} SOL`
                          : `${formatTokenAmount(s.tokensIn)} ${TICKER}`}
                      </td>
                      <td className="px-6 py-3">
                        {s.tokensOut > 0
                          ? `${formatTokenAmount(s.tokensOut)} ${TICKER}`
                          : `${lamportsToSol(s.solLamportsOut)} SOL`}
                      </td>
                      <td className="px-6 py-3">{lamportsToSol(s.feeLamports)} SOL</td>
                      <td className="px-6 py-3">{s.slot.toLocaleString()}</td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {fmtTime(s.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4 text-primary" /> Asset shield flows
            </h2>
            <GradientBadge>SPL assets in sealed notes</GradientBadge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Kind</th>
                  <th className="px-6 py-3 font-medium">Asset</th>
                  <th className="px-6 py-3 font-medium">Units</th>
                  <th className="px-6 py-3 font-medium">Slot</th>
                  <th className="px-6 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="font-mono-tabular">
                {assetEvents === undefined ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : assetEvents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-6 text-center text-muted-foreground">
                      No asset flows yet — shield USDC, BONK or JUP from the Vault page.
                    </td>
                  </tr>
                ) : (
                  assetEvents.map((a) => (
                    <tr
                      key={a._id}
                      className="border-b border-border/40 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-6 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            a.kind === "shield"
                              ? "bg-primary/10 text-primary"
                              : "bg-tier-obsidian/15 text-tier-obsidian"
                          }`}
                        >
                          {a.kind}
                        </span>
                      </td>
                      <td className="px-6 py-3">{a.symbol}</td>
                      <td className="px-6 py-3">{formatTokenAmount(a.units)}</td>
                      <td className="px-6 py-3">{a.slot.toLocaleString()}</td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {fmtTime(a.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-primary">
              <FileText className="size-4" />
              <p className="text-sm font-semibold">What is public</p>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>That an envelope occurred, and when</li>
              <li>Its size in bytes — uniform, so length leaks nothing</li>
              <li>Opaque nullifiers and commitments</li>
              <li>Mint amounts and ticker (supply must be auditable)</li>
              <li>Burns: buybacks, tier burns and exits, in full</li>
              <li>Swap directions and reserve sizes; asset shields (in)</li>
              <li>Fee-share claims: anchor and claim size, never the holder</li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-tier-obsidian">
              <ShieldCheck className="size-4" />
              <p className="text-sm font-semibold">Not protected</p>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>Public-address-derived encryption can expose note balances</li>
              <li>Authenticated transfers retain sender and receiver metadata</li>
              <li>Transfer and asset amounts can be recovered from public data</li>
              <li>Which earlier note was spent</li>
              <li>Who swapped, or which stealth address was paid</li>
              <li>Unshield destinations' note history</li>
            </ul>
          </CardContent>
        </Card>
        </div>

        <SimulationControls />
      </PageShell>
    </SiteLayout>
  );
}
