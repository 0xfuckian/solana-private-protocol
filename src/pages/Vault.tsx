import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GradientBadge, Stat } from "@/components/site/Stat";
import { PageShell, SiteLayout } from "@/components/site/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/convex/_generated/api";
import {
  LAMPORTS_PER_SOL,
  formatTokenAmount,
  lamportsToSol,
  shortAddress,
} from "@/lib/protocol";
import { useS404 } from "@/lib/s404-context";
import { buildProof, commitmentFor, sealNoteFor } from "@/lib/wallet";
import {
  Boxes,
  Coins,
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

function DeployCard() {
  const s404 = useS404();
  const deploy = useMutation(api.vault.deployToken);
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [maxSupply, setMaxSupply] = useState("1000000");
  const [pricePerKilo, setPricePerKilo] = useState("10000");
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
          <h2 className="text-base font-semibold">
            Deploy a shielded token
          </h2>
        </div>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          A ticker, a maximum supply and a per-mint price, published as an
          envelope like any other. Consensus rules need no change — this is
          tooling on a capability the pool already has.
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
                const proof = await buildProof(
                  `deploy:${ticker}:${Number(maxSupply)}:${Number(pricePerKilo)}`,
                ).then((p) => p.proof);
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
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Rocket className="mr-2 size-4" />}
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
  const s404 = useS404();
  const buy = useMutation(api.vault.buyToken);
  const [amount, setAmount] = useState("10000");
  const [busy, setBusy] = useState(false);

  const gross = Math.ceil(
    (Number(amount || 0) * token.priceLamportsPerKilo) / 1000,
  );

  return (
    <Card className="border-sol-gradient w-full max-w-md">
      <CardContent className="p-6">
        <h2 className="text-base font-semibold">
          Buy {token.ticker} privately
        </h2>
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
            disabled={busy || !s404.address || Number(amount) <= 0}
            onClick={async () => {
              if (!s404.address) return;
              setBusy(true);
              try {
                const r = crypto.randomUUID();
                const value = Number(amount);
                const sealed = await sealNoteFor(s404.address, {
                  value,
                  memo: `buy ${token.ticker}`,
                  r,
                });
                const commitment = await commitmentFor(value, r, s404.address);
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
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
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
  const s404 = useS404();
  const tokens = useQuery(api.vault.listTokens);
  const myBalances = useQuery(
    api.vault.listMyBalances,
    s404.phase === "unlocked" ? {} : "skip",
  ) as { tokenId: string; amount: number }[] | undefined;
  const [buying, setBuying] = useState<VaultToken | null>(null);

  const balances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of myBalances ?? []) map[String(b.tokenId)] = b.amount;
    return map;
  }, [myBalances]);

  if (s404.phase !== "unlocked") {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <ShieldCheck className="mx-auto size-8 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">
            Unlock to see the vault
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The vault lists shielded tokens; balances are sealed notes only
            your key can open.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          Every token here is private by default: holders and transfers are
          sealed notes, not account balances.
        </p>
        <DeployCard />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(tokens ?? []).map((t: VaultToken) => (
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

              {balances[t._id] !== undefined && balances[t._id] > 0 && (
                <p className="mt-3 font-mono-tabular text-sm text-primary">
                  You hold {formatTokenAmount(balances[t._id])} {t.ticker}
                </p>
              )}

              {!t.isProtocolToken && t.mintOpen && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setBuying(t)}
                >
                  <Boxes className="mr-1.5 size-3.5" /> Buy
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
        <PageShell>
          <div className="mb-8">
            <GradientBadge className="mb-2">launchpad</GradientBadge>
            <h1 className="text-3xl font-semibold tracking-tight">Vault</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Shielded tokens for anyone. S404 was issued through exactly
              this path.
            </p>
          </div>
          <VaultInner />
        </PageShell>
      </SiteLayout>
    </RequireAuth>
  );
}
