import { motion } from "framer-motion";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { SITE_NAME, TICKER } from "@/lib/protocol";
import { Compass, Lock } from "lucide-react";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="flex min-h-screen flex-col bg-sol-glow"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-border/70 bg-card p-8 text-center shadow-[0_0_60px_-20px_rgba(20,241,149,0.3)]">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-sol-gradient">
            <Lock className="size-5 text-[#04101a]" strokeWidth={2.5} />
          </span>
          <h1 className="mt-6 font-mono-tabular text-4xl font-black tracking-tight text-sol-gradient">
            OFF-LEDGER
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This address doesn't resolve to anything on {SITE_NAME} — and the
            ledger doesn't remember addresses that were never used.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              asChild
              className="bg-sol-gradient font-semibold text-[#04101a] hover:opacity-90"
            >
              <Link to="/">Back to the ledger</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/whitelist">Join the whitelist</Link>
            </Button>
          </div>
          <p className="mt-6 font-mono-tabular text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
            {TICKER} · not found. by design.
          </p>
        </div>
      </div>
      <p className="pb-8 text-center text-xs text-muted-foreground">
        <Link to="/explorer" className="inline-flex items-center gap-1.5 hover:text-foreground">
          <Compass className="size-3.5" /> Inspect the envelope feed instead
        </Link>
      </p>
    </motion.div>
  );
}
