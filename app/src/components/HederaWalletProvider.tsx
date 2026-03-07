"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LedgerId, type Transaction } from "@hashgraph/sdk";

type HashConnectLike = {
  connectionStatusChangeEvent: { on: (cb: (status: string) => void) => void };
  pairingEvent: { on: (cb: (pairing: { accountIds: string[] }) => void) => void };
  disconnectionEvent: { on: (cb: () => void) => void };
  connectedAccountIds: Array<{ toString: () => string }>;
  pairingString?: string;
  init: () => Promise<void>;
  openPairingModal: (
    themeMode?: "dark" | "light",
    backgroundColor?: string,
    accentColor?: string,
    accentFillColor?: string,
    borderRadius?: string,
  ) => Promise<void>;
  disconnect: () => Promise<void>;
  sendTransaction: (accountId: any, transaction: any) => Promise<unknown>;
  signMessages: (accountId: any, message: string) => Promise<unknown>;
};

interface HederaWalletContextValue {
  isInitializing: boolean;
  connectionState: string;
  accountIds: string[];
  selectedAccountId: string | null;
  pairingString: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setSelectedAccountId: (accountId: string) => void;
  sendTransaction: (transaction: Transaction, accountIdOverride?: string) => Promise<unknown>;
  signMessage: (message: string, accountIdOverride?: string) => Promise<string>;
}

const HederaWalletContext = createContext<HederaWalletContextValue | null>(null);

function normalizeAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(":");
  return parts[parts.length - 1] || trimmed;
}

function shortAccountId(accountId: string | null): string {
  if (!accountId) return "";
  return accountId.length <= 10
    ? accountId
    : `${accountId.slice(0, 6)}…${accountId.slice(-3)}`;
}

export function HederaWalletProvider({ children }: { children: ReactNode }) {
  const hashConnectRef = useRef<HashConnectLike | null>(null);

  const [isInitializing, setIsInitializing] = useState(true);
  const [connectionState, setConnectionState] = useState<string>("Disconnected");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [pairingString, setPairingString] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
      const network =
        (process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet").toLowerCase() === "mainnet"
          ? "mainnet"
          : "testnet";

      if (!projectId) {
        if (mounted) {
          setError("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set");
          setIsInitializing(false);
        }
        return;
      }

      try {
        const { HashConnect, HashConnectConnectionState } = await import("hashconnect");

        const metadata = {
          name: "Ascend",
          description: "Ascend AI Agent Intelligence Market",
          icons: ["https://hashpack.app/img/logo.svg"],
          url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
        };

        const hashconnect: HashConnectLike = new HashConnect(
          network === "mainnet" ? LedgerId.MAINNET : LedgerId.TESTNET,
          projectId,
          metadata,
          false,
        );

        hashconnect.connectionStatusChangeEvent.on((status: string) => {
          if (!mounted) return;
          setConnectionState(status);
        });

        hashconnect.pairingEvent.on((pairing: { accountIds: string[] }) => {
          if (!mounted) return;
          const ids = pairing.accountIds.map(normalizeAccountId);
          setAccountIds(ids);
          setSelectedAccountId((current) => current || ids[0] || null);
        });

        hashconnect.disconnectionEvent.on(() => {
          if (!mounted) return;
          setAccountIds([]);
          setSelectedAccountId(null);
          setConnectionState(HashConnectConnectionState.Disconnected);
        });

        await hashconnect.init();

        if (!mounted) return;

        hashConnectRef.current = hashconnect;
        setPairingString(hashconnect.pairingString || null);

        const connected = hashconnect.connectedAccountIds.map((accountId) => accountId.toString());
        if (connected.length > 0) {
          setAccountIds(connected);
          setSelectedAccountId((current) => current || connected[0] || null);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || "HashPack initialization failed");
        }
      } finally {
        if (mounted) {
          setIsInitializing(false);
        }
      }
    }

    void init();

    return () => {
      mounted = false;
    };
  }, []);

  const connect = useCallback(async () => {
    const hashconnect = hashConnectRef.current;
    if (!hashconnect) {
      throw new Error("HashPack wallet is not initialized");
    }
    await hashconnect.openPairingModal("dark");
    setPairingString(hashconnect.pairingString || null);
  }, []);

  const disconnect = useCallback(async () => {
    const hashconnect = hashConnectRef.current;
    if (!hashconnect) return;
    await hashconnect.disconnect();
    setAccountIds([]);
    setSelectedAccountId(null);
  }, []);

  const sendTransaction = useCallback(
    async (transaction: Transaction, accountIdOverride?: string): Promise<unknown> => {
      const hashconnect = hashConnectRef.current;
      if (!hashconnect) {
        throw new Error("HashPack wallet is not initialized");
      }

      const accountId = accountIdOverride || selectedAccountId;
      if (!accountId) {
        throw new Error("No connected Hedera account");
      }

      return hashconnect.sendTransaction(accountId as any, transaction as any);
    },
    [selectedAccountId],
  );

  const signMessage = useCallback(
    async (message: string, accountIdOverride?: string): Promise<string> => {
      const hashconnect = hashConnectRef.current;
      if (!hashconnect) {
        throw new Error("HashPack wallet is not initialized");
      }

      const accountId = accountIdOverride || selectedAccountId;
      if (!accountId) {
        throw new Error("No connected Hedera account");
      }

      const signatures = await hashconnect.signMessages(accountId as any, message);
      return JSON.stringify(signatures);
    },
    [selectedAccountId],
  );

  const value = useMemo<HederaWalletContextValue>(
    () => ({
      isInitializing,
      connectionState,
      accountIds,
      selectedAccountId,
      pairingString,
      error,
      connect,
      disconnect,
      setSelectedAccountId,
      sendTransaction,
      signMessage,
    }),
    [
      accountIds,
      connect,
      connectionState,
      disconnect,
      error,
      isInitializing,
      pairingString,
      selectedAccountId,
      sendTransaction,
      signMessage,
    ],
  );

  return (
    <HederaWalletContext.Provider value={value}>{children}</HederaWalletContext.Provider>
  );
}

export function useHederaWallet(): HederaWalletContextValue {
  const value = useContext(HederaWalletContext);
  if (!value) {
    throw new Error("useHederaWallet must be used within HederaWalletProvider");
  }
  return value;
}

export function useHederaWalletLabel(): string {
  const { selectedAccountId } = useHederaWallet();
  return shortAccountId(selectedAccountId);
}
