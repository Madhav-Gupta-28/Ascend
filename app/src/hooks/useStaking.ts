import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { getProvider } from '@/lib/hedera';
import { CONTRACT_ADDRESSES, STAKING_VAULT_ABI } from '@/lib/contracts';
import { UserStake } from '@/lib/types';
import { useHederaWallet } from '@/hooks/use-hedera-wallet';

export function useStakingPortfolio() {
    const { selectedAccountId } = useHederaWallet();

    return useQuery({
        queryKey: ['stakingPortfolio', selectedAccountId],
        queryFn: async () => {
            // Return empty if no wallet is connected
            if (!selectedAccountId) return { totalStaked: 0n, positions: {} };

            const provider = getProvider();
            if (!CONTRACT_ADDRESSES.stakingVault) {
                throw new Error("StakingVault address not configured");
            }

            // Convert HashPack accountId (e.g. 0.0.12345) to EVM address (e.g. 0x...)
            // Hedera SDK / HashConnect exposes this via Mirror Node or local conversion
            // For read-only mapping, we need the EVM address 
            // If we don't have a direct EVM translation yet, we fetch it from mirror node
            const evmAddress = await fetchEvmAddressFromAccountId(selectedAccountId);
            if (!evmAddress) return { totalStaked: 0n, positions: {} };

            const vault = new ethers.Contract(
                CONTRACT_ADDRESSES.stakingVault,
                STAKING_VAULT_ABI,
                provider
            );

            // We'll scan agents 1 through 4 (assuming 4 static agents for demo)
            // Real app might query the registry to get all active agent IDs first
            const positions: Record<number, { stake: UserStake, pendingReward: bigint }> = {};
            let totalStaked = 0n;

            try {
                const promises = [1, 2, 3, 4].map(async (agentId) => {
                    const stakeData = await vault.getUserStake(agentId, evmAddress);
                    const pendingReward = await vault.getPendingReward(agentId, evmAddress);

                    if (stakeData.amount > 0n) {
                        positions[agentId] = {
                            stake: { amount: stakeData.amount, stakedAt: Number(stakeData.stakedAt) },
                            pendingReward
                        };
                        totalStaked += stakeData.amount;
                    }
                });

                await Promise.all(promises);
                return { totalStaked, positions };
            } catch (err) {
                console.error("Failed to fetch staking portfolio:", err);
                throw err;
            }
        },
        enabled: !!selectedAccountId, // Only run the query if a wallet is connected
        refetchInterval: 15000,
    });
}

export function useTotalValueLocked() {
    return useQuery({
        queryKey: ['stakingTVL'],
        queryFn: async (): Promise<bigint> => {
            const provider = getProvider();
            if (!CONTRACT_ADDRESSES.stakingVault) {
                return 0n;
            }

            const vault = new ethers.Contract(
                CONTRACT_ADDRESSES.stakingVault,
                STAKING_VAULT_ABI,
                provider
            );

            try {
                return await vault.getTVL();
            } catch (err) {
                console.error("Failed to fetch TVL:", err);
                return 0n;
            }
        },
        refetchInterval: 30000,
    });
}

// Helper to get EVM address from HashPack account ID using Mirror Node
async function fetchEvmAddressFromAccountId(accountId: string): Promise<string | null> {
    const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet";
    const url = `https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}`;

    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return data.evm_address || null;
    } catch (err) {
        console.error("Mirror node fetch failed", err);
        return null;
    }
}
