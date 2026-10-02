import handbook from "../../docs/THREAT_MODEL.md?raw";
import { SiteLayout, PageShell } from "@/components/site/Layout";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

export default function Handbook() {
  const sections = handbook.split("\n\n");
  return <SiteLayout><PageShell>
    <div className="mb-10 border-b border-border pb-8">
      <p className="text-xs uppercase tracking-[0.25em] text-primary">Protocol / transparent by design</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Handbook</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">The implementation, its limits, and the evidence needed before real funds can enter.</p>
      <Link className="mt-5 inline-flex items-center gap-2 text-sm text-primary" to="/dashboard">Open the dashboard <ArrowUpRight className="size-4"/></Link>
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
