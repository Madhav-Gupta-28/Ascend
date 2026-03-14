/**
 * Ascend — Contract Client
 *
 * Handles all EVM interactions with AgentRegistry, PredictionMarket,
 * and StakingVault via Hashio JSON-RPC using ethers.js.
 */

import { ethers, type ContractTransactionResponse } from "ethers";
import * as fs from "fs";
import * as path from "path";

const AGENT_REGISTRY_ABI = [
    "function registerAgent(string name, string description) external payable returns (uint256)",
    "function getAgent(uint256 agentId) external view returns (tuple(address owner, string name, string description, uint256 totalPredictions, uint256 correctPredictions, int256 credScore, uint256 registrationBond, uint256 totalStaked, uint64 registeredAt, bool active))",
    "function getAgentCount() external view returns (uint256)",
    "function isAgentActive(uint256 agentId) external view returns (bool)",
    "function ownerToAgent(address) external view returns (uint256)",
    "event AgentRegistered(uint256 indexed agentId, address indexed owner, string name, uint256 bond)",
];

const PREDICTION_MARKET_ABI = [
    "function createRound(uint64 commitDuration, uint64 revealDuration, uint64 roundDuration, uint256 startPrice, uint256 entryFee) external returns (uint256)",
    "function commitPrediction(uint256 roundId, uint256 agentId, bytes32 commitHash) external payable",
    "function revealPrediction(uint256 roundId, uint256 agentId, uint8 direction, uint256 confidence, bytes32 salt) external",
    "function resolveRound(uint256 roundId, uint256 endPrice) external",
    "function claimResult(uint256 roundId, uint256 agentId) external",
    "function withdrawRewardPool(uint256 roundId, uint256 amount, address to) external",
    "function cancelRound(uint256 roundId) external",
    "function getRound(uint256 roundId) external view returns (uint256 startPrice, uint256 endPrice, uint64 commitDeadline, uint64 revealDeadline, uint64 resolveAfter, uint256 entryFee, uint8 status, uint8 outcome, uint8 participantCount, uint8 revealedCount)",
    "function getRoundRewardPool(uint256 roundId) external view returns (uint256)",
    "function getCommitment(uint256 roundId, uint256 agentId) external view returns (bool committed, bool revealed, bool scored, uint8 direction, uint256 confidence)",
    "function getRoundCount() external view returns (uint256)",
    "function isRoundResolved(uint256 roundId) external view returns (bool)",
    "function getRoundOutcome(uint256 roundId) external view returns (uint8)",
    "event RoundCreated(uint256 indexed roundId, uint256 startPrice, uint64 commitDeadline, uint64 revealDeadline, uint64 resolveAfter, uint256 entryFee)",
    "event PredictionCommitted(uint256 indexed roundId, uint256 indexed agentId, bytes32 commitHash)",
    "event PredictionRevealed(uint256 indexed roundId, uint256 indexed agentId, uint8 direction, uint256 confidence)",
    "event RoundResolved(uint256 indexed roundId, uint256 endPrice, uint8 outcome)",
    "event ScoreClaimed(uint256 indexed roundId, uint256 indexed agentId, bool correct, int256 delta)",
];

const STAKING_VAULT_ABI = [
    "function depositReward(uint256 agentId) external payable",
    "function stake(uint256 agentId) external payable",
    "function unstake(uint256 agentId, uint256 amount) external",
    "function claimReward(uint256 agentId) external",
    "function getUserStake(uint256 agentId, address user) external view returns (uint256 amount, uint64 stakedAt)",
    "function getTotalStakedOnAgent(uint256 agentId) external view returns (uint256)",
    "function getTVL() external view returns (uint256)",
    "function getPendingReward(uint256 agentId, address user) external view returns (uint256)",
    "function rewardPerTokenStored(uint256 agentId) external view returns (uint256)",
];

export interface AgentData {
    owner: string;
    name: string;
    description: string;
    totalPredictions: bigint;
    correctPredictions: bigint;
    credScore: bigint;
    registrationBond: bigint;
    totalStaked: bigint;
    registeredAt: bigint;
    active: boolean;
}

export interface RoundData {
    startPrice: bigint;
    endPrice: bigint;
    commitDeadline: bigint;
    revealDeadline: bigint;
    resolveAfter: bigint;
    entryFee: bigint;
    status: number; // 0=Committing, 1=Revealing, 2=Resolved, 3=Cancelled
    outcome: number; // 0=UP, 1=DOWN
    participantCount: number;
    revealedCount: number;
}

export interface CommitmentData {
    committed: boolean;
    revealed: boolean;
    scored: boolean;
    direction: number; // 0=UP, 1=DOWN
    confidence: bigint;
}

export interface Deployments {
    network: string;
    operatorId: string;
    hcs: {
        ascendPredictionsTopicId?: string;
        ascendResultsTopicId?: string;
        discourseTopicIds?: Record<string, string>;
        hcs10RegistryTopicId?: string;
        ascendRoundsTopicId?: string;
    };
    hts: { ascendTokenId: string };
    contracts: { agentRegistry: string; predictionMarket: string; stakingVault: string };
    createdAt: string;
}

function requireDeployedAddress(name: string, value?: string): string {
    const address = (value || "").trim();
    if (!address || address === "NOT_DEPLOYED" || address === "0x0000000000000000000000000000000000000000") {
        throw new Error(`${name} address missing or not deployed`);
    }
    return address;
}

export class ContractClient {
    private provider: ethers.JsonRpcProvider;
    private signer: ethers.NonceManager;
    private signerAddress: string;
    private registry: ethers.Contract;
    private market: ethers.Contract;
    private vault: ethers.Contract;

    get walletAddress(): string {
        return this.signerAddress;
    }

    constructor(rpcUrl: string, privateKey: string, registryAddr: string, marketAddr: string, vaultAddr: string) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, this.provider);
        this.signerAddress = wallet.address;
        this.signer = new ethers.NonceManager(wallet);
        this.registry = new ethers.Contract(registryAddr, AGENT_REGISTRY_ABI, this.signer);
        this.market = new ethers.Contract(marketAddr, PREDICTION_MARKET_ABI, this.signer);
        this.vault = new ethers.Contract(vaultAddr, STAKING_VAULT_ABI, this.signer);
    }

    private isNonceExpiredError(error: any): boolean {
        const code = String(error?.code || "");
        const message = String(
            error?.shortMessage ||
                error?.reason ||
                error?.message ||
                error?.info?.error?.message ||
                "",
        ).toLowerCase();
        return (
            code === "NONCE_EXPIRED" ||
            message.includes("nonce too low") ||
            message.includes("nonce has already been used")
        );
    }

    private async withNonceRetry<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error: any) {
            if (!this.isNonceExpiredError(error)) {
                throw error;
            }
            this.signer.reset();
            await new Promise((resolve) => setTimeout(resolve, 150));
            return operation();
        }
    }

    refreshNonce(): void {
        this.signer.reset();
    }

    async registerAgent(name: string, description: string, bondHbar: number): Promise<bigint> {
        const tx: ContractTransactionResponse = await this.registry.registerAgent(
            name,
            description,
            { value: ethers.parseEther(bondHbar.toString()), gasLimit: 1_500_000 }
        );
        const receipt = await tx.wait();
        const log = receipt?.logs.find((entry: any) => {
            try {
                return this.registry.interface.parseLog({ topics: [...entry.topics], data: entry.data })?.name === "AgentRegistered";
            } catch {
                return false;
            }
        });
        if (!log) {
            console.warn("⚠️ Hashio event log delayed. Polling getAgentCount()...");
            const initialCount = Number(await this.registry.getAgentCount({ blockTag: "latest" }));
            let latestCount = initialCount;
            for (let i = 0; i < 5; i++) {
                await new Promise((r) => setTimeout(r, 2000));
                const newCount = Number(await this.registry.getAgentCount({ blockTag: "latest" }));
                latestCount = newCount;
                if (newCount > initialCount) return BigInt(newCount);
            }
            return BigInt(latestCount);
        }

        const parsed = this.registry.interface.parseLog({ topics: [...log.topics], data: log.data });
        return parsed?.args[0] as bigint;
    }

    async getAgent(agentId: number): Promise<AgentData> {
        const agent = await this.registry.getAgent(agentId);
        return {
            owner: agent[0],
            name: agent[1],
            description: agent[2],
            totalPredictions: agent[3],
            correctPredictions: agent[4],
            credScore: agent[5],
            registrationBond: agent[6],
            totalStaked: agent[7],
            registeredAt: agent[8],
            active: agent[9],
        };
    }

    async getAgentCount(): Promise<number> {
        return Number(await this.registry.getAgentCount());
    }

    async createRound(
        commitDurationSecs: number,
        revealDurationSecs: number,
        roundDurationSecs: number,
        startPrice: bigint,
        entryFeeHbar: number
    ): Promise<bigint> {
        // Hedera contracts store entry fees in tinybar units.
        const entryFeeTinybar = ethers.parseUnits(entryFeeHbar.toString(), 8);
        const tx: ContractTransactionResponse = await this.market.createRound(
            commitDurationSecs,
            revealDurationSecs,
            roundDurationSecs,
            startPrice,
            entryFeeTinybar,
            { gasLimit: 300_000 }
        );

        const receipt = await tx.wait();
        const log = receipt?.logs.find((entry: any) => {
            try {
                return this.market.interface.parseLog({ topics: [...entry.topics], data: entry.data })?.name === "RoundCreated";
            } catch {
                return false;
            }
        });

        if (!log) {
            console.warn("⚠️ Hashio event log delayed. Polling getRoundCount()...");
            // Hedera testnet RPC nodes can be heavily delayed for state reads right after a write.
            const initialCount = Number(await this.market.getRoundCount({ blockTag: "latest" }));
            let latestCount = initialCount;
            for (let i = 0; i < 5; i++) {
                await new Promise((r) => setTimeout(r, 2000));
                const newCount = Number(await this.market.getRoundCount({ blockTag: "latest" }));
                latestCount = newCount;
                if (newCount > initialCount) return BigInt(newCount);
            }
            return BigInt(latestCount);
        }

        const parsed = this.market.interface.parseLog({ topics: [...log.topics], data: log.data });
        return parsed?.args[0] as bigint;
    }

    async commitPredictionTx(
        roundId: number,
        agentId: number,
        commitHash: string,
        entryFeeHbar: number = 0,
    ): Promise<ContractTransactionResponse> {
        const value = entryFeeHbar > 0 ? ethers.parseEther(entryFeeHbar.toString()) : 0n;
        return this.withNonceRetry(() =>
            this.market.commitPrediction(
                roundId,
                agentId,
                commitHash as `0x${string}`,
                { value, gasLimit: 1_500_000 },
            ),
        );
    }

    async commitPrediction(roundId: number, agentId: number, commitHash: string, entryFeeHbar: number = 0): Promise<void> {
        const tx = await this.commitPredictionTx(roundId, agentId, commitHash, entryFeeHbar);
        await tx.wait();
    }

    async revealPredictionTx(
        roundId: number,
        agentId: number,
        direction: number,
        confidence: number,
        salt: string,
    ): Promise<ContractTransactionResponse> {
        return this.withNonceRetry(() =>
            this.market.revealPrediction(
                roundId,
                agentId,
                direction,
                confidence,
                salt as `0x${string}`,
                { gasLimit: 1_500_000 },
            ),
        );
    }

    async revealPrediction(roundId: number, agentId: number, direction: number, confidence: number, salt: string): Promise<void> {
        const tx = await this.revealPredictionTx(roundId, agentId, direction, confidence, salt);
        await tx.wait();
    }

    async resolveRound(roundId: number, endPrice: bigint): Promise<void> {
        const tx: ContractTransactionResponse = await this.withNonceRetry(() =>
            this.market.resolveRound(roundId, endPrice, { gasLimit: 1_500_000 }),
        );
        await tx.wait();
    }

    async claimResult(roundId: number, agentId: number): Promise<void> {
        const tx: ContractTransactionResponse = await this.withNonceRetry(() =>
            this.market.claimResult(roundId, agentId, { gasLimit: 1_500_000 }),
        );
        await tx.wait();
    }

    async withdrawRewardPool(roundId: number, amount: bigint, to?: string): Promise<void> {
        if (amount <= 0n) return;
        const recipient = to || this.signerAddress;
        const tx: ContractTransactionResponse = await this.withNonceRetry(() =>
            this.market.withdrawRewardPool(
                roundId,
                amount,
                recipient,
                { gasLimit: 500_000 },
            ),
        );
        await tx.wait();
    }

    async getRound(roundId: number): Promise<RoundData> {
        const round = await this.market.getRound(roundId);
        return {
            startPrice: round[0],
            endPrice: round[1],
            commitDeadline: round[2],
            revealDeadline: round[3],
            resolveAfter: round[4],
            entryFee: round[5],
            status: Number(round[6]),
            outcome: Number(round[7]),
            participantCount: Number(round[8]),
            revealedCount: Number(round[9]),
        };
    }

    async getCommitment(roundId: number, agentId: number): Promise<CommitmentData> {
        const commitment = await this.market.getCommitment(roundId, agentId);
        return {
            committed: commitment[0],
            revealed: commitment[1],
            scored: commitment[2],
            direction: Number(commitment[3]),
            confidence: commitment[4],
        };
    }

    async getRoundCount(): Promise<number> {
        return Number(await this.market.getRoundCount());
    }

    async isRoundResolved(roundId: number): Promise<boolean> {
        return Boolean(await this.market.isRoundResolved(roundId));
    }

    async getRoundOutcome(roundId: number): Promise<number> {
        return Number(await this.market.getRoundOutcome(roundId));
    }

    async getRoundRewardPool(roundId: number): Promise<bigint> {
        return BigInt(await this.market.getRoundRewardPool(roundId));
    }

    async stake(agentId: number, amountHbar: number): Promise<void> {
        const tx: ContractTransactionResponse = await this.vault.stake(
            agentId,
            { value: ethers.parseEther(amountHbar.toString()), gasLimit: 200_000 }
        );
        await tx.wait();
    }

    // Backward-compatible wrapper used by older callers.
    async stakeOnAgent(agentId: number, amountHbar: number): Promise<void> {
        await this.stake(agentId, amountHbar);
    }

    async unstake(agentId: number, amountHbar: number): Promise<void> {
        const amountTinybar = ethers.parseUnits(amountHbar.toString(), 8);
        const tx: ContractTransactionResponse = await this.vault.unstake(
            agentId,
            amountTinybar,
            { gasLimit: 300_000 }
        );
        await tx.wait();
    }

    async depositReward(agentId: number, rewardHbarStr: string): Promise<void> {
        const tx: ContractTransactionResponse = await this.vault.depositReward(
            agentId,
            { value: ethers.parseEther(rewardHbarStr), gasLimit: 200_000 }
        );
        await tx.wait();
    }

    async depositRewardRaw(agentId: number, amount: bigint): Promise<void> {
        if (amount <= 0n) return;
        // Contract stores values in tinybars but tx.value needs weibars (×10^10)
        const valueWeibars = amount * 10_000_000_000n;
        const tx: ContractTransactionResponse = await this.vault.depositReward(
            agentId,
            { value: valueWeibars, gasLimit: 200_000 },
        );
        await tx.wait();
    }

    async claimReward(agentId: number): Promise<void> {
        const tx: ContractTransactionResponse = await this.vault.claimReward(agentId, { gasLimit: 300_000 });
        await tx.wait();
    }

    async getUserStake(agentId: number, userAddress: string): Promise<string> {
        const stake = await this.vault.getUserStake(agentId, userAddress);
        return ethers.formatUnits(stake[0], 8);
    }

    async getTotalStakedOnAgent(agentId: number): Promise<string> {
        const tvl = await this.vault.getTotalStakedOnAgent(agentId);
        return ethers.formatUnits(tvl, 8);
    }

    async getTotalStakedOnAgentRaw(agentId: number): Promise<bigint> {
        return BigInt(await this.vault.getTotalStakedOnAgent(agentId));
    }

    // Backward-compatible wrapper used by older callers.
    async getAgentTVL(agentId: number): Promise<string> {
        return this.getTotalStakedOnAgent(agentId);
    }

    async getTotalTVL(): Promise<string> {
        const tvl = await this.vault.getTVL();
        return ethers.formatUnits(tvl, 8);
    }

    async getRewardPerToken(agentId: number): Promise<string> {
        const rewardPerToken = await this.vault.rewardPerTokenStored(agentId);
        return ethers.formatUnits(rewardPerToken, 18);
    }

    async getPendingReward(agentId: number, userAddress: string): Promise<string> {
        const pendingReward = await this.vault.getPendingReward(agentId, userAddress);
        return ethers.formatUnits(pendingReward, 8);
    }

    // Backward-compatible wrapper used by older callers.
    async calculatePendingReward(agentId: number, userAddress: string): Promise<string> {
        return this.getPendingReward(agentId, userAddress);
    }

    getSignerAddress(): string {
        return this.signerAddress;
    }

    async transferHbar(to: string, amountHbar: number): Promise<void> {
        if (amountHbar <= 0) return;
        const tx = await this.signer.sendTransaction({
            to,
            value: ethers.parseEther(amountHbar.toString()),
            gasLimit: 30_000,
        });
        await tx.wait();
    }

    async transferRaw(to: string, amount: bigint): Promise<void> {
        if (amount <= 0n) return;
        // Contract stores values in tinybars but tx.value needs weibars (×10^10)
        const valueWeibars = amount * 10_000_000_000n;
        const tx = await this.signer.sendTransaction({
            to,
            value: valueWeibars,
            gasLimit: 30_000,
        });
        await tx.wait();
    }

    static generateSalt(): string {
        return ethers.hexlify(ethers.randomBytes(32));
    }

    static computeCommitHash(direction: number, confidence: number, salt: string): string {
        return ethers.keccak256(
            ethers.solidityPacked(["uint8", "uint256", "bytes32"], [direction, confidence, salt])
        );
    }
}

export function loadDeployments(): Deployments {
    const candidates = [
        path.resolve(process.cwd(), "../deployments.json"),
        path.resolve(process.cwd(), "../contracts/deployments.json"),
        path.resolve(process.cwd(), "deployments.json"),
    ];

    const deploymentsPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!deploymentsPath) {
        throw new Error("deployments.json not found. Run deploy and seed first.");
    }

    const raw = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
    const contracts = raw.contracts ?? raw;
    return {
        network: raw.network ?? "testnet",
        operatorId: raw.operatorId ?? "",
        hcs: raw.hcs ?? {},
        hts: raw.hts ?? { ascendTokenId: "" },
        contracts: {
            agentRegistry: contracts.agentRegistry ?? "",
            predictionMarket: contracts.predictionMarket ?? "",
            stakingVault: contracts.stakingVault ?? "",
        },
        createdAt: raw.createdAt ?? new Date().toISOString(),
    };
}

export function createContractClient(): ContractClient {
    const deployments = loadDeployments();
    const rpcUrl = process.env.HEDERA_JSON_RPC || "https://testnet.hashio.io/api";
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

    if (!privateKey) {
        throw new Error("DEPLOYER_PRIVATE_KEY not set");
    }

    const registryAddress = requireDeployedAddress(
        "AgentRegistry",
        process.env.AGENT_REGISTRY_ADDRESS || deployments.contracts.agentRegistry,
    );
    const marketAddress = requireDeployedAddress(
        "PredictionMarket",
        process.env.PREDICTION_MARKET_ADDRESS || deployments.contracts.predictionMarket,
    );
    const vaultAddress = requireDeployedAddress(
        "StakingVault",
        process.env.STAKING_VAULT_ADDRESS || deployments.contracts.stakingVault,
    );

    return new ContractClient(
        rpcUrl,
        privateKey,
        registryAddress,
        marketAddress,
        vaultAddress,
    );
}
