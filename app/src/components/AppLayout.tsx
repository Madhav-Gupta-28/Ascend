"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletConnectButton from "@/components/WalletConnectButton";

function useNavItems() {
  return [
    { path: "/round/latest", label: "Live Round" },
    { path: "/rounds", label: "Rounds" },
    { path: "/agents", label: "Agents" },
    { path: "/staking", label: "Staking" },
    { path: "/discourse", label: "Discourse" },
    { path: "/register", label: "Register Agent" },
    { path: "/admin", label: "Admin" },
  ];
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navItems = useNavItems();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
            <span className="font-display text-sm font-semibold uppercase tracking-[0.07em] text-foreground">Ascend</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1.5">
            {navItems.map(({ path, label }) => {
              const current = pathname || "";
              const isActive =
                path === "/round/latest"
                    ? current === "/round/latest" || (/^\/round\/\d+$/.test(current))
                    : current === path || current.startsWith(`${path}/`);
              return (
                <Link
                  key={path}
                  href={path}
                  className={`relative rounded-sm px-2.5 py-2 text-[11px] font-medium uppercase tracking-[0.11em] transition-colors ${isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                    }`}
                >
                  {label}
                  {isActive && (
                    <span className="absolute inset-x-2 bottom-0 h-px bg-secondary" />
                  )}
                </Link>
              );
            })}
          </nav>

          <WalletConnectButton />
        </div>
      </header>

      {/* Mobile nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background">
        <div className="flex items-center justify-around py-2.5">
          {navItems.map(({ path, label }) => {
            const current = pathname || "";
            const isActive =
              path === "/round/latest"
                  ? current === "/round/latest" || (/^\/round\/\d+$/.test(current))
                  : current === path || current.startsWith(`${path}/`);
            return (
              <Link
                key={path}
                href={path}
                className={`flex flex-col items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors ${isActive ? "text-secondary" : "text-muted-foreground"
                  }`}
              >
                {label.split(" ")[0]}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="container pb-24 pt-8 md:pb-8 md:pt-10">
        {children}
      </main>
    </div>
  );
}
