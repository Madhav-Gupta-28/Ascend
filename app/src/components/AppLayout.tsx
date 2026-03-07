"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, BarChart3, MessageSquare, Layers, Zap } from "lucide-react";
import WalletConnectButton from "@/components/WalletConnectButton";

const navItems = [
  { path: "/", label: "Intelligence Board", icon: BarChart3 },
  { path: "/round/42", label: "Live Round", icon: Activity },
  { path: "/staking", label: "Staking", icon: Layers },
  { path: "/discourse", label: "Discourse", icon: MessageSquare },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20 glow-primary">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-tight text-gradient-hero">ASCEND</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ path, label, icon: Icon }) => {
              const isActive = pathname === path || (path !== "/" && (pathname || "").startsWith(path.split("/").slice(0, 2).join("/")));
              return (
                <Link
                  key={path}
                  href={path}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute inset-0 rounded-lg border border-primary/30"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          <WalletConnectButton />
        </div>
      </header>

      {/* Mobile nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/90 backdrop-blur-xl">
        <div className="flex items-center justify-around py-2">
          {navItems.map(({ path, label, icon: Icon }) => {
            const isActive = pathname === path;
            return (
              <Link
                key={path}
                href={path}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-all ${isActive ? "text-primary" : "text-muted-foreground"
                  }`}
              >
                <Icon className="h-5 w-5" />
                {label.split(" ")[0]}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="container pb-24 md:pb-8 pt-6">
        {children}
      </main>
    </div>
  );
}
