import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "./SiteHeader";

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
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
