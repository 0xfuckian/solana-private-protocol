import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { LockKeyhole, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useSolzk } from "@/lib/solzk-context";
import { buildProof, commitmentFor, sealNoteFor } from "@/lib/wallet";
import { sealedStatement, spendStatement } from "@/lib/spend";
import { formatTokenAmount } from "@/lib/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export function StakingCard() {
  const slk = useSolzk();
  const stake = useMutation(api.staking.stake);
  const unstake = useMutation(api.staking.unstake);
  const claim = useMutation(api.staking.claimRewards);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const status = slk.staking;
  const units = Number(amount);
  const valid = Number.isSafeInteger(units) && units > 0;
  async function transact(kind: "stake" | "unstake" | "claim") {
    if (!slk.address || !status) return;
    setBusy(true);
    try {
      if (kind === "stake") {
        const spend = await slk.buildSpend(units);
        const { proof } = await buildProof(spendStatement(`stake:${slk.address}:${units}`, spend));
        await stake({ amountTokens: units, nullifiers: spend.nullifiers, inputTotal: spend.inputTotal, change: spend.change, proof });
      } else {
        const value = kind === "claim" ? status.claimableTokens : units;
        const r = crypto.randomUUID();
        const sealedNote = await sealNoteFor(slk.address, { value, r, memo: kind === "claim" ? "staking rewards" : "unstake" });
        const commitment = await commitmentFor(value, r, slk.address);
        const domain = kind === "claim" ? "staking-reward" : "unstake";
        const { proof } = await buildProof(`${domain}:${slk.address}:${value}:${commitment}:${sealedStatement(sealedNote)}`);
        if (kind === "claim") await claim({ expectedTokens: value, commitment, sealedNote, proof });
        else await unstake({ amountTokens: value, commitment, sealedNote, proof });
      }
      slk.refreshNotes();
      setAmount("");
      toast.success(kind === "stake" ? "Demo tokens staked with a seven-day lock." : kind === "claim" ? "Funded token rewards claimed." : "Demo tokens returned to a note.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Staking failed"); }
    finally { setBusy(false); }
  }
  return <Card><CardContent className="p-6">
    <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Stake for utility</h2><LockKeyhole className="size-4 text-primary"/></div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Simulation only. Seven-day lock; 1% base transfer fee before burn discounts and a 100 demo-SOL daily limit. No guaranteed APY or live governance votes.</p>
    <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-background p-4 text-xs">
      <div><p className="text-muted-foreground">Your stake / vote-weight preview</p><p className="mt-1 font-mono text-primary">{formatTokenAmount(status?.amount ?? 0)} SOLZK</p></div>
      <div><p className="text-muted-foreground">Claimable funded rewards</p><p className="mt-1 font-mono text-primary">{formatTokenAmount(status?.claimableTokens ?? 0)} SOLZK</p></div>
      <div className="col-span-2 text-muted-foreground">{status?.amount ? `Locked until ${new Date(status.lockedUntil).toLocaleString()}. Adding tokens relocks the whole position.` : "No active lock."}</div>
    </div>
    <Input aria-label="Staking amount" type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Whole SOLZK tokens" className="mt-4 font-mono"/>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button disabled={busy || !valid || units > slk.balance || !status} onClick={() => void transact("stake")}>{busy && <Loader2 className="mr-2 size-4 animate-spin"/>}Stake</Button>
      <Button variant="outline" disabled={busy || !valid || units > (status?.amount ?? 0) || Date.now() < (status?.lockedUntil ?? 0)} onClick={() => void transact("unstake")}>Unstake</Button>
      <Button variant="outline" disabled={busy || !status?.claimableTokens} onClick={() => void transact("claim")}>Claim rewards</Button>
    </div>
    <p className="mt-4 text-[11px] leading-5 text-muted-foreground">When stakes exist, the vault half of new SOLZK transfer fees funds pro-rata staking rewards. SOL fees remain in the separate vault. Limits use the demo exit rate, not a market oracle. Legacy hash proofs still do not establish actual note ownership.</p>
  </CardContent></Card>;
}
