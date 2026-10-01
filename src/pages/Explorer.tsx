import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GradientBadge, Stat } from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
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
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
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
  const envelopes = useQuery(api.protocol.listEnvelopes, { limit: 50 }) as
    | EnvelopeListItem[]
    | undefined;
  const burns = useQuery(api.protocol.listBurns, { limit: 10 }) as
    | BurnRow[]
    | undefined;
  const detail = useQuery(
    api.protocol.getEnvelope,
    selected ? { signature: selected } : "skip",
  );

  const filtered = useMemo(() => {
    if (!envelopes) return undefined;
    const q = query.trim().toLowerCase();
    if (!q) return envelopes;
    return envelopes.filter(
      (e) =>
        e.signature.toLowerCase().includes(q) ||
        e.kind.toLowerCase().includes(q) ||
        String(e.slot).includes(q),
    );
  }, [envelopes, query]);

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
            Everything the chain reveals — and nothing else. Check every
            figure yourself; that is the point of settling on-chain.
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

      {detail?.envelope ? (
        <Card className="border-sol-gradient mb-8">
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`flex size-10 items-center justify-center rounded-xl ${
                    detail.envelope.kind === "mint"
                      ? "bg-primary/10 text-primary"
                      : "bg-[#9945FF]/15 text-[#c9b4ff]"
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
                label="Relayer fee"
                value={`${lamportsToSol(detail.envelope.feeLamports)} SOL`}
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
              ordered by Solana, sealed by cryptography
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
                              : "bg-[#9945FF]/15 text-[#c9b4ff]"
                          }`}
                        >
                          {e.kind}
                          {e.feeInNote ? " · in-note" : ""}
                        </span>
                      </td>
                      <td className="px-6 py-3">{e.slot.toLocaleString()}</td>
                      <td className="px-6 py-3">{e.payloadSize} B</td>
                      <td className="px-6 py-3">
                        {lamportsToSol(e.feeLamports)} SOL
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
                                ? "bg-[#9945FF]/15 text-[#c9b4ff]"
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
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-[#c9b4ff]">
              <ShieldCheck className="size-4" />
              <p className="text-sm font-semibold">Never revealed</p>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>Who owns a note, or your balance at any time</li>
              <li>Sender and receiver of a transfer</li>
              <li>The amount transferred, or which token moved</li>
              <li>Which earlier note was spent</li>
            </ul>
          </CardContent>
        </Card>
        </div>
      </PageShell>
    </SiteLayout>
  );
}
