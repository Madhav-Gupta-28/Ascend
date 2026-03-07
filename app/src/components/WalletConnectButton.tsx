"use client";

import { useMemo, useState } from "react";
import { Loader2, PlugZap, Unplug } from "lucide-react";
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
    return "Connect HashPack";
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
      className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-all hover:bg-primary/20 glow-primary disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {isWorking || isInitializing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isConnected ? (
        <Unplug className="h-4 w-4" />
      ) : (
        <PlugZap className="h-4 w-4" />
      )}
      <span>{label}</span>
    </button>
  );
}
