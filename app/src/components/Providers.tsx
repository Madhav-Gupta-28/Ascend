"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { HederaWalletProvider } from "@/components/HederaWalletProvider";
import { useState, ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => new QueryClient());

    return (
        <QueryClientProvider client={queryClient}>
            <HederaWalletProvider>
                <TooltipProvider>
                    {children}
                    <Toaster />
                    <Sonner />
                </TooltipProvider>
            </HederaWalletProvider>
        </QueryClientProvider>
    );
}
