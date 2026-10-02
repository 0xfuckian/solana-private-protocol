import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SITE_NAME } from "@/lib/protocol";

/**
 * Pre-launch gate. While `whitelistOpen` is false, the whitelist application
 * page is the only page the site serves — every other route bounces there.
 * /auth stays reachable so applicants can sign in, and the founder (admin
 * role) bypasses the gate to run the review console and open the whitelist.
 */
export function WhitelistGate({ children }: { children: ReactNode }) {
  const gate = useQuery(api.whitelist.getGate);
  const user = useQuery(api.users.currentUser);
  const location = useLocation();

  const allowedPath =
    location.pathname === "/whitelist" || location.pathname === "/auth";

  if (gate === undefined || user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-2 rounded-full bg-primary sol-pulse" />
          {SITE_NAME} — checking the whitelist phase…
        </div>
      </div>
    );
  }

  if (gate.open || user?.role === "admin" || allowedPath) {
    return <>{children}</>;
  }

  return <Navigate to="/whitelist" replace />;
}
