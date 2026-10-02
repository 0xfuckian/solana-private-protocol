import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Loader2, Lock, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatTokenAmount } from "@/lib/protocol";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Testing console: admin-only reset of the simulation ledger back to zero.
 * Not a production control. Rendered on the Explorer so a tester can wipe
 * mint counts, supply, notes, nullifiers and the Merkle tree without a
 * redeploy. The first account on a fresh deployment can claim the admin role.
 */
export function SimulationControls() {
  const user = useQuery(api.users.currentUser);
  const pool = useQuery(api.termix.poolState);
  const reset = useMutation(api.operations.resetSimulation);
  const claimFounder = useMutation(api.whitelist.claimFounder);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<"keep" | "all" | null>(null);

  if (user === undefined) return null;

  if (user === null) {
    return (
      <Card className="mt-8 border-dashed">
        <CardContent className="p-5 text-xs leading-5 text-muted-foreground">
          Sign in to reach the testing reset console.
        </CardContent>
      </Card>
    );
  }

  const isAdmin = user.role === "admin";

  async function claim() {
    setBusy(true);
    try {
      const r = await claimFounder({});
      if (r.claimed) toast.success("Founder console unlocked.");
      else toast.error("This account isn't the first account on the deployment.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function doReset(includeWallets: boolean) {
    setBusy(true);
    try {
      await reset(includeWallets ? { includeWallets: true } : {});
      toast.success(
        includeWallets
          ? "Ledger reset — accounts and wallets cleared."
          : "Ledger reset — mint counts, notes and the tree are back to zero.",
      );
      setPending(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <Card className="mt-8 border-dashed">
        <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">
            Testing reset is admin-only. The first account created on this
            deployment can claim the founder console.
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={claim}>
            {busy ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Lock className="mr-1.5 size-3.5" />
            )}
            Claim founder console
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-8 border-amber-400/30">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RotateCcw className="size-4 text-amber-400" />
            <p className="text-sm font-semibold">Testing console — reset ledger</p>
          </div>
          <p className="font-mono-tabular text-xs text-muted-foreground">
            minted {pool ? formatTokenAmount(pool.mintedTokens) : "—"} /{" "}
            {pool ? formatTokenAmount(pool.totalSupply) : "—"} · leaves{" "}
            {pool ? pool.leaves.toLocaleString() : "—"}
          </p>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Wipes mint counts, supply, notes, nullifiers, invoices, orders,
          vault/staking positions, the Merkle tree and every other ledger feed
          back to zero. Admin-only.
        </p>

        {pending === null ? (
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setPending("keep")}
            >
              <RotateCcw className="mr-1.5 size-3.5" />
              Reset ledger (keep wallets)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setPending("all")}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Reset + clear wallets
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <p className="text-xs leading-5 text-muted-foreground">
              {pending === "all"
                ? "This also deletes every wallet record and its registration. Testers must register again."
                : "Mint counts, notes, nullifiers and the tree return to zero. Wallet records stay, with faucet balances restored."}
            </p>
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant={pending === "all" ? "destructive" : "default"}
                disabled={busy}
                onClick={() => doReset(pending === "all")}
              >
                {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Confirm reset
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
