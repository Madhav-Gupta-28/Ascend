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
import { LedgerId, type Transaction, ContractExecuteTransaction, ContractId, Hbar } from "@hashgraph/sdk";
import { ethers } from "ethers";

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
  isConnected: boolean;
  executeContractFunction: (
    contractAddress: string,
    abi: any,
    functionName: string,
    args: any[],
    payableAmountTinybars?: string
  ) => Promise<unknown>;
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
      const rawProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
      const projectId =
        rawProjectId && !/^wc_project_id_here$|^your_project_id$|^<.*>$/.test(rawProjectId)
          ? rawProjectId
          : undefined;

      const network =
        (process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet").toLowerCase() === "mainnet"
          ? "mainnet"
          : "testnet";

      if (!projectId) {
        if (mounted) {
          setError(
            "WalletConnect Project ID missing or placeholder. Get a free ID at https://cloud.walletconnect.com (or dashboard.reown.com) and set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env"
          );
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
        if (!mounted) return;
        const msg = err?.message ?? String(err);
        if (
          /cannot redefine property:\s*ethereum/i.test(msg) ||
          /defineProperty.*ethereum/i.test(msg)
        ) {
          setError(
            "Wallet conflict: another extension (e.g. MetaMask) has already set up the wallet. Try disabling other wallet extensions for this site or use a separate browser profile, then reload."
          );
        } else {
          setError(msg || "HashPack initialization failed");
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

  const executeContractFunction = useCallback(
    async (
      contractAddress: string,
      abi: any,
      functionName: string,
      args: any[],
      payableAmountTinybars?: string
    ) => {
      const iface = new ethers.Interface(abi);
      const data = iface.encodeFunctionData(functionName, args);
      const functionParameters = Buffer.from(data.replace('0x', ''), 'hex');

      const contractId = ContractId.fromEvmAddress(0, 0, contractAddress);

      let tx = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(500000)
        .setFunctionParameters(functionParameters);

      if (payableAmountTinybars) {
        tx = tx.setPayableAmount(Hbar.fromTinybars(payableAmountTinybars));
      }

      return sendTransaction(tx);
    },
    [sendTransaction]
  );

  const isConnected = !!selectedAccountId;

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
      isConnected,
      executeContractFunction,
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
      isConnected,
      executeContractFunction,
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
