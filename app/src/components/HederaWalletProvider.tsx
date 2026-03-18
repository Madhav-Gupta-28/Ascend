"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccountId,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  LedgerId,
  type Transaction,
} from "@hashgraph/sdk";
import { ethers } from "ethers";

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
    payableAmountTinybars?: string,
  ) => Promise<unknown>;
}

const HederaWalletContext = createContext<HederaWalletContextValue | null>(null);

type HashConnectInstance = {
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

const CONNECTION_STATE = {
  Disconnected: "Disconnected",
  Connected: "Connected",
} as const;

function normalizeAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(":");
  return parts[parts.length - 1] || trimmed;
}

function shortAccountId(accountId: string | null): string {
  if (!accountId) return "";
  return accountId.length <= 10 ? accountId : `${accountId.slice(0, 6)}…${accountId.slice(-3)}`;
}

function normalizeWalletError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown wallet error");
  if (/proposal expired/i.test(message)) {
    return new Error("Wallet request expired. Reopen HashPack and try again.");
  }
  if (/no internet connection detected/i.test(message)) {
    return new Error("HashPack relay unavailable. Retry in a few seconds.");
  }
  if (/uri missing/i.test(message)) {
    return new Error("Wallet pairing URI missing. Retry connect.");
  }
  if (/cannot redefine property:\s*ethereum/i.test(message) || /defineProperty.*ethereum/i.test(message)) {
    return new Error("Wallet extension conflict detected. Disable other wallet extensions and retry.");
  }
  if (/user rejected|rejected by user|cancelled by user/i.test(message)) {
    return new Error("Request rejected in wallet.");
  }
  return new Error(message);
}

export function HederaWalletProvider({ children }: { children: ReactNode }) {
  const hashConnectRef = useRef<HashConnectInstance | null>(null);
  const initPromiseRef = useRef<Promise<HashConnectInstance> | null>(null);

  const [isInitializing, setIsInitializing] = useState(false);
  const [connectionState, setConnectionState] = useState<string>(CONNECTION_STATE.Disconnected);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [pairingString, setPairingString] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyConnectedAccounts = useCallback((rawAccountIds: string[]) => {
    const normalized = rawAccountIds.map(normalizeAccountId).filter(Boolean);
    setAccountIds(normalized);
    setSelectedAccountId((current) => current || normalized[0] || null);
  }, []);

  const resetConnectionState = useCallback(() => {
    setConnectionState(CONNECTION_STATE.Disconnected);
    setAccountIds([]);
    setSelectedAccountId(null);
  }, []);

  const initHashConnect = useCallback(async (): Promise<HashConnectInstance> => {
    if (hashConnectRef.current) return hashConnectRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    const initTask = (async () => {
      setIsInitializing(true);
      setError(null);

      const rawProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
      const projectId =
        rawProjectId && !/^wc_project_id_here$|^your_project_id$|^<.*>$/.test(rawProjectId)
          ? rawProjectId
          : undefined;
      if (!projectId) {
        throw new Error(
          "WalletConnect Project ID missing. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in app/.env",
        );
      }

      const network =
        (process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet").toLowerCase() === "mainnet"
          ? LedgerId.MAINNET
          : LedgerId.TESTNET;

      const { HashConnect, HashConnectConnectionState } = await import("hashconnect");
      const hashconnect = new HashConnect(
        network,
        projectId,
        {
          name: "Ascend",
          description: "Ascend AI Agent Intelligence Market",
          icons: ["https://hashpack.app/img/logo.svg"],
          url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
        },
        false,
      );

      hashconnect.connectionStatusChangeEvent.on((status) => {
        setConnectionState(String(status || HashConnectConnectionState.Disconnected || CONNECTION_STATE.Disconnected));
      });

      hashconnect.pairingEvent.on((pairing) => {
        applyConnectedAccounts(pairing.accountIds);
        setConnectionState(HashConnectConnectionState.Connected || CONNECTION_STATE.Connected);
        setError(null);
      });

      hashconnect.disconnectionEvent.on(() => {
        resetConnectionState();
      });

      await hashconnect.init();
      hashConnectRef.current = hashconnect;
      setPairingString(hashconnect.pairingString || null);

      const existing = hashconnect.connectedAccountIds.map((accountId) => accountId.toString());
      if (existing.length > 0) {
        applyConnectedAccounts(existing);
        setConnectionState(HashConnectConnectionState.Connected || CONNECTION_STATE.Connected);
      }

      return hashconnect;
    })();

    initPromiseRef.current = initTask;
    try {
      return await initTask;
    } catch (err) {
      const normalized = normalizeWalletError(err);
      setError(normalized.message);
      throw normalized;
    } finally {
      initPromiseRef.current = null;
      setIsInitializing(false);
    }
  }, [applyConnectedAccounts, resetConnectionState]);

  const connect = useCallback(async () => {
    try {
      const hashconnect = await initHashConnect();

      const existing = hashconnect.connectedAccountIds.map((accountId) => accountId.toString());
      if (existing.length > 0) {
        applyConnectedAccounts(existing);
        setConnectionState(CONNECTION_STATE.Connected);
        setError(null);
        return;
      }

      await hashconnect.openPairingModal("dark", "#0B0B0B", "#48DF7B", "#111111", "8px");
      setPairingString(hashconnect.pairingString || null);
      setError(null);
    } catch (err) {
      const normalized = normalizeWalletError(err);
      setError(normalized.message);
      throw normalized;
    }
  }, [applyConnectedAccounts, initHashConnect]);

  const disconnect = useCallback(async () => {
    const hashconnect = hashConnectRef.current;
    if (!hashconnect) {
      resetConnectionState();
      return;
    }

    try {
      await hashconnect.disconnect();
      resetConnectionState();
      setError(null);
    } catch (err) {
      throw normalizeWalletError(err);
    }
  }, [resetConnectionState]);

  const sendTransaction = useCallback(
    async (transaction: Transaction, accountIdOverride?: string): Promise<unknown> => {
      const hashconnect = hashConnectRef.current;
      if (!hashconnect) {
        throw new Error("HashPack wallet is not initialized");
      }

      const accountId = normalizeAccountId(accountIdOverride || selectedAccountId || "");
      if (!accountId) {
        throw new Error("No connected Hedera account");
      }

      try {
        return await hashconnect.sendTransaction(AccountId.fromString(accountId) as any, transaction as any);
      } catch (err) {
        throw normalizeWalletError(err);
      }
    },
    [selectedAccountId],
  );

  const signMessage = useCallback(
    async (message: string, accountIdOverride?: string): Promise<string> => {
      const hashconnect = hashConnectRef.current;
      if (!hashconnect) {
        throw new Error("HashPack wallet is not initialized");
      }

      const accountId = normalizeAccountId(accountIdOverride || selectedAccountId || "");
      if (!accountId) {
        throw new Error("No connected Hedera account");
      }

      try {
        const signatures = await hashconnect.signMessages(AccountId.fromString(accountId) as any, message);
        return JSON.stringify(signatures);
      } catch (err) {
        throw normalizeWalletError(err);
      }
    },
    [selectedAccountId],
  );

  const executeContractFunction = useCallback(
    async (
      contractAddress: string,
      abi: any,
      functionName: string,
      args: any[],
      payableAmountTinybars?: string,
    ) => {
      const iface = new ethers.Interface(abi);
      const encodedData = iface.encodeFunctionData(functionName, args);
      const functionParameters = Buffer.from(encodedData.replace("0x", ""), "hex");

      const contractId = ContractId.fromEvmAddress(0, 0, contractAddress);

      let tx = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(500_000)
        .setFunctionParameters(functionParameters);

      if (payableAmountTinybars) {
        tx = tx.setPayableAmount(Hbar.fromTinybars(payableAmountTinybars));
      }

      return sendTransaction(tx);
    },
    [sendTransaction],
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
      isInitializing,
      connectionState,
      accountIds,
      selectedAccountId,
      pairingString,
      error,
      connect,
      disconnect,
      sendTransaction,
      signMessage,
      isConnected,
      executeContractFunction,
    ],
  );

  return <HederaWalletContext.Provider value={value}>{children}</HederaWalletContext.Provider>;
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
