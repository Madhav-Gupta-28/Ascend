"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useHederaWallet, useHederaWalletLabel } from "@/components/HederaWalletProvider";

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

  const label = useMemo(() => {
    if (isInitializing) return "Wallet...";
    if (isConnected) return `Connected ${shortAccountId}`;
    if (error) return "Wallet Config";
    return "Connect Wallet";
  }, [error, isConnected, isInitializing, shortAccountId]);

  const handleClick = async () => {
    if (error || isInitializing || isWorking) return;
    setIsWorking(true);
    try {
      if (isConnected) {
        await disconnect();
      } else {
        await connect();
      }
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <button
      onClick={() => void handleClick()}
      disabled={Boolean(error) || isInitializing || isWorking}
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
      {isWorking || isInitializing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}
