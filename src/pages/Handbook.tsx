import handbook from "../../docs/THREAT_MODEL.md?raw";
import { SiteLayout, PageShell } from "@/components/site/Layout";
import { ShieldAlert, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

export default function Handbook() {
  const sections = handbook.split("\n\n");
  return <SiteLayout><PageShell>
    <div className="mb-10 border-b border-border pb-8">
      <p className="text-xs uppercase tracking-[0.25em] text-primary">Protocol research / transparent by design</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Handbook</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">The implementation, its limits, and the evidence needed before real funds can enter.</p>
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-5 text-sm leading-6 text-amber-200"><ShieldAlert className="mt-1 size-5 shrink-0"/>Research simulation. No audited privacy or on-chain settlement. No real funds.</div>
      <Link className="mt-5 inline-flex items-center gap-2 text-sm text-primary" to="/dashboard">Open research workspace <ArrowUpRight className="size-4"/></Link>
    </div>
    <article className="max-w-3xl space-y-6">{sections.map((section, i) => {
      if (section.startsWith("# ")) return null;
      if (section.startsWith("## ")) return <h2 key={i} className="pt-6 text-2xl text-foreground">{section.slice(3)}</h2>;
      if (section.startsWith("- ")) return <ul key={i} className="list-disc space-y-3 pl-5 text-sm leading-7 text-muted-foreground">{section.split("\n").map((line, j) => <li key={j}>{line.replace(/^- /, "")}</li>)}</ul>;
      if (/^\d+\./.test(section)) return <ol key={i} className="list-decimal space-y-3 pl-5 text-sm leading-7 text-muted-foreground">{section.split("\n").map((line, j) => <li key={j}>{line.replace(/^\d+\. /, "")}</li>)}</ol>;
      return <p key={i} className="text-sm leading-7 text-muted-foreground">{section}</p>;
    })}</article>
  </PageShell></SiteLayout>;
}
