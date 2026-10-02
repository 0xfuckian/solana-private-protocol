import { Link } from "react-router";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "./SiteHeader";

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <div role="note" className="border-b border-amber-400/20 bg-amber-400/5 px-4 py-3 text-center text-xs leading-5 text-amber-200">Research simulation · No real Solana settlement or audited privacy. Do not use real funds or sensitive data. <Link to="/docs" className="ml-2 underline underline-offset-4">Read the threat model</Link></div>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function PageShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto w-full px-4 pb-20 pt-10 sm:px-6 ${
        wide ? "max-w-7xl" : "max-w-6xl"
      }`}
    >
      {children}
    </div>
  );
}
