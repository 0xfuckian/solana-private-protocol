import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSolzk } from "@/lib/solzk-context";
import { buildProof, commitmentFor, sealNoteFor } from "@/lib/wallet";
import { spendStatement } from "@/lib/spend";
import { payrollBatchDomain, payrollDispatchSummary } from "@/lib/payroll";
import { useState } from "react";
import { Link } from "react-router";
import { FileUp, ArrowUpRight, Download } from "lucide-react";
import { SiteLayout, PageShell } from "@/components/site/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parsePayrollCsv, payrollSummary, type PayrollRow } from "@/lib/payroll";
import { shortAddress, formatTokenAmount, TICKER } from "@/lib/protocol";

export default function Payroll() {
  const slk = useSolzk();
  const dispatch = useMutation(api.payroll.dispatch);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ recipients: number; totalTokens: number; feeTokens: number; slot: number } | null>(null);
  const [csv, setCsv] = useState("payee,amount,memo\n");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [error, setError] = useState("");
  const summary = rows.length ? payrollSummary(rows) : null;
  function preview() {
    try { const parsed = parsePayrollCsv(csv); payrollSummary(parsed); setRows(parsed); setError(""); }
    catch (e) { setRows([]); setError(e instanceof Error ? e.message : "Invalid CSV"); }
  }
  async function sendBatch() {
    if (!slk.address || !summary) return;
    setBusy(true); setError("");
    try {
      const { debit } = payrollDispatchSummary(rows);
      const spend = await slk.buildSpend(debit);
      const outputs = await Promise.all(rows.map(async row => {
        const r = crypto.randomUUID();
        return { payee: row.payee, amount: row.amount, commitment: await commitmentFor(row.amount, r, row.payee),
          sealed: await sealNoteFor(row.payee, { value: row.amount, memo: row.memo || "payroll", r }) };
      }));
      const { proof } = await buildProof(spendStatement(payrollBatchDomain(slk.address, outputs), spend));
      const result = await dispatch({ outputs, nullifiers: spend.nullifiers, inputTotal: spend.inputTotal, change: spend.change, proof });
      setReceipt(result); slk.refreshNotes(); setRows([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Payroll dispatch failed"); }
    finally { setBusy(false); }
  }
  function download() {
    if (!summary) return;
    const body = JSON.stringify({ version: 1, status: "unfunded-requests", requests: summary.requests.map(row => ({ ...row, url: `${window.location.origin}/pay#${row.fragment}` })) }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "solzk-payroll-requests.json"; a.click(); URL.revokeObjectURL(url);
  }
  return <SiteLayout><PageShell>
    <p className="text-xs uppercase tracking-[0.24em] text-primary">Business workspace / request preparation</p>
    <h1 className="mt-4 text-4xl">Payroll</h1>
    <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">Prepare up to 100 request links locally, or dispatch up to 20 payments atomically. Requests are not funded claims. Dispatch publishes payees, amounts and encrypted notes to the ledger, with each note sealed to its recipient.</p>
    {receipt && <div role="status" className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">Batch dispatched: {receipt.recipients} notes · {formatTokenAmount(receipt.totalTokens)} {TICKER} · {receipt.feeTokens} fee tokens · slot {receipt.slot}. <button className="ml-2 text-primary underline" onClick={() => setReceipt(null)}>Prepare another batch</button></div>}
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-xl">01 / Import roster</h2>
        <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-primary/40 p-4 text-sm"><FileUp className="size-5 text-primary"/>Choose CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async e => { const file = e.target.files?.[0]; if (file) { if (file.size > 100_000) { setError("100 KB maximum."); return; } setCsv(await file.text()); setRows([]); } }}/></label>
        <Textarea aria-label="Payroll CSV" className="mt-4 min-h-64 font-mono text-xs" value={csv} onChange={e => { setCsv(e.target.value); setRows([]); }}/>
        <p className="mt-3 text-xs text-muted-foreground">Columns: payee,amount,memo. Whole {TICKER} tokens; one address per employee.</p>
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        <Button className="mt-5" onClick={preview}>Validate & prepare</Button>
      </section>
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-xl">02 / Review requests</h2>
        {summary ? <><p className="mt-5 text-3xl font-mono">{formatTokenAmount(summary.total)} <span className="text-sm text-muted-foreground">{TICKER} requested</span></p><p className="mt-2 text-xs text-muted-foreground">Dispatch fee: {formatTokenAmount(summary.proposedFeeTokens)} {TICKER} (1%), added to the batch total. Link creation is free; individual links retain normal transfer fees.</p><div className="mt-5 max-h-80 space-y-2 overflow-auto">{summary.requests.map(row => <Link key={row.payee} className="flex items-center justify-between rounded-lg bg-secondary p-3 text-sm hover:bg-primary/10" to={`/pay#${row.fragment}`}><span className="font-mono">{shortAddress(row.payee)}</span><span>{formatTokenAmount(row.amount)} <ArrowUpRight className="ml-2 inline size-4"/></span></Link>)}</div><Button variant="outline" className="mt-5" onClick={download}><Download className="mr-2 size-4"/>Export request links</Button><Button className="ml-2 mt-5" disabled={busy || slk.phase !== "unlocked" || rows.length > 20 || !!receipt || slk.balance < summary.total + summary.proposedFeeTokens} onClick={() => void sendBatch()}>{busy ? "Dispatching…" : "Dispatch batch"}</Button><p className="mt-3 text-xs text-muted-foreground">Unlock your wallet to dispatch. Maximum 20 payees per transaction; all outputs and change commit together or none do.</p></> : <p className="mt-6 text-sm text-muted-foreground">Your validated batch will appear here.</p>}
        <div className="mt-6 rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-200">Dispatch credits notes directly to payees; it does not create bearer claim links. Legacy hash proofs are not secure authorization. Funded payroll and employee unshielding require reviewed encryption, ownership proofs and Solana custody.</div>
      </section>
    </div>
  </PageShell></SiteLayout>;
}
