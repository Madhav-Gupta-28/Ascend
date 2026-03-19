"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useHederaWallet, useHederaWalletLabel } from "@/components/HederaWalletProvider";
import { toast } from "sonner";

function isBenignWalletLog(message: string): boolean {
  return /hashpack wallet is not initialized yet|wallet network temporarily unavailable|wallet pairing uri unavailable|proposal expired|request expired|relay unavailable|extension conflict/i.test(
    message,
  );
}

function isFatalWalletConfigError(message: string | null): boolean {
  if (!message) return false;
  return /project id missing|walletconnect project id/i.test(message);
}

export default function WalletConnectButton() {
  const {
    isInitializing,
    selectedAccountId,
    error,
    connect,
    disconnect,
    connectionState,
  } = useHederaWallet();
  const shortAccountId = useHederaWalletLabel();
  const [isWorking, setIsWorking] = useState(false);

  const isConnected = Boolean(selectedAccountId);
  const isConfigError = isFatalWalletConfigError(error);

  const label = useMemo(() => {
    if (isConnected) return `Connected ${shortAccountId}`;
    if (isConfigError) return "Wallet Config";
    return "Connect Wallet";
  }, [isConfigError, isConnected, shortAccountId]);

  const handleClick = async () => {
    if (isConfigError || isInitializing || isWorking) return;
    setIsWorking(true);
    try {
      if (isConnected) {
        await disconnect();
      } else {
        await connect();
      }
    } catch (err: any) {
      const message = err?.message || "Wallet request failed";
      toast.error(message);
      if (!isBenignWalletLog(message)) {
        // Keep details in console for unexpected cases only.
        console.warn("Wallet connect/disconnect error:", err);
      }
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <button
      onClick={() => void handleClick()}
      disabled={isConfigError || isWorking}
      title={
        error ||
        (isConnected
          ? `${selectedAccountId} (${connectionState})`
          : "Connect with HashPack on Hedera Testnet")
      }
      className={`flex items-center justify-center rounded-sm border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        isConnected
          ? "border-secondary/50 bg-secondary/10 text-secondary hover:bg-secondary/15"
          : "border-border bg-card text-foreground hover:bg-accent/70"
      }`}
    >
      {isWorking ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}
