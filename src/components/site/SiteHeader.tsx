import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useS404 } from "@/lib/s404-context";
import { TICKER, shortAddress } from "@/lib/protocol";
import {
  ChevronDown,
  Compass,
  Globe,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Unlock,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";

const NAV = [
  { to: "/mint", label: "Mint" },
  { to: "/market", label: "Market" },
  { to: "/vault", label: "Vault" },
  { to: "/explorer", label: "Explorer" },
  { to: "/protocol", label: "Protocol" },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="relative flex size-8 items-center justify-center rounded-lg bg-sol-gradient shadow-[0_0_18px_rgba(20,241,149,0.35)]">
        <Lock className="size-4 text-[#04101a]" strokeWidth={2.5} />
      </span>
      <span className="text-[17px] font-semibold tracking-tight text-foreground">
        S404
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const s404 = useS404();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = async () => {
    s404.lock();
    await signOut();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {s404.phase === "unlocked" && s404.address ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 border-primary/40 font-mono-tabular text-xs"
                >
                  <span className="size-2 rounded-full bg-primary sol-pulse" />
                  {shortAddress(s404.address)}
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="font-mono-tabular text-xs text-muted-foreground">
                  {s404.address}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => s404.lock()}
                  className="cursor-pointer"
                >
                  <Lock className="mr-2 size-4" /> Lock wallet
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/dashboard" className="cursor-pointer">
                    <LayoutDashboard className="mr-2 size-4" /> Dashboard
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : user ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => navigate("/mint")}
            >
              <Unlock className="size-4 text-primary" />
              <span className="hidden sm:inline">Unlock {TICKER} wallet</span>
              <span className="sm:hidden">Unlock</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => navigate("/auth?returnTo=%2Fmint")}
            >
              <LogIn className="size-4 text-primary" />
              Sign in
            </Button>
          )}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                    {(user.name ?? user.email ?? "U").slice(0, 1).toUpperCase()}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/dashboard" className="cursor-pointer">
                    <LayoutDashboard className="mr-2 size-4" /> Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Menu className="size-5" />
          </Button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-border/70 bg-background/95 px-4 py-3 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-sol-gradient">
            <Lock className="size-3.5 text-[#04101a]" strokeWidth={2.5} />
          </span>
          <div>
            <p className="text-sm font-semibold">{TICKER}</p>
            <p className="text-xs text-muted-foreground">
              A private ledger that settles on Solana
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link to="/mint" className="hover:text-foreground">Mint</Link>
          <Link to="/market" className="hover:text-foreground">Market</Link>
          <Link to="/vault" className="hover:text-foreground">Vault</Link>
          <Link to="/explorer" className="hover:text-foreground">Explorer</Link>
          <Link to="/protocol" className="hover:text-foreground">Protocol</Link>
        </nav>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Compass className="size-3.5" /> Devnet simulation
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Globe className="size-3.5" /> © 2026 {TICKER}
          </span>
        </div>
      </div>
      <p className="mx-auto mt-6 w-full max-w-6xl px-4 text-xs leading-5 text-muted-foreground/70 sm:px-6">
        S404 is a demonstration protocol. Nothing on this site is financial
        advice or an offer of securities. The devnet simulates Solana
        finality locally; the real protocol settles on Solana with
        zero-knowledge proofs.
      </p>
    </footer>
  );
}
