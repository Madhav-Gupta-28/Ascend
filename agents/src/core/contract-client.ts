/**
 * Ascend — Contract Client
 * 
 * Handles all EVM interactions with AgentRegistry and PredictionMarket
 * via Hashio JSON-RPC using ethers.js
 */

import { ethers, type ContractTransactionResponse } from "ethers";
import * as fs from "fs";
import * as path from "path";

// ── ABI Fragments (only what we need) ──

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
    "function cancelRound(uint256 roundId) external",
    "function getRound(uint256 roundId) external view returns (uint256 startPrice, uint256 endPrice, uint64 commitDeadline, uint64 revealDeadline, uint64 resolveAfter, uint256 entryFee, uint8 status, uint256 participantCount)",
    "function getCommitment(uint256 roundId, uint256 agentId) external view returns (bool committed, bool revealed, uint8 direction, uint256 confidence)",
    "function getParticipantIds(uint256 roundId) external view returns (uint256[])",
    "function getRoundCount() external view returns (uint256)",
    "function getUserStake(uint256 agentId, address user) external view returns (uint256)",
    "function stakeOnAgent(uint256 agentId) external payable",
    "function unstake(uint256 agentId, uint256 amount) external",
    "event RoundCreated(uint256 indexed roundId, uint256 startPrice, uint64 commitDeadline, uint64 revealDeadline)",
    "event PredictionCommitted(uint256 indexed roundId, uint256 indexed agentId, bytes32 commitHash)",
    "event PredictionRevealed(uint256 indexed roundId, uint256 indexed agentId, uint8 direction, uint256 confidence)",
    "event RoundResolved(uint256 indexed roundId, uint256 endPrice, uint8 outcome)",
];

const STAKING_VAULT_ABI = [
    "function depositReward(uint256 agentId) external payable",
    "function stakeOnAgent(uint256 agentId) external payable",
    "function unstake(uint256 agentId, uint256 amount) external",
    "function claimReward(uint256 agentId) external",
    "function getUserStake(uint256 agentId, address user) external view returns (uint256)",
    "function getAgentTVL(uint256 agentId) external view returns (uint256)",
    "function getRewardPerToken(uint256 agentId) external view returns (uint256)",
    "function calculatePendingReward(uint256 agentId, address user) external view returns (uint256)"
];

// ── Types ──

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
    participantCount: bigint;
}

export interface CommitmentData {
    committed: boolean;
    revealed: boolean;
    direction: number; // 0=UP, 1=DOWN
    confidence: bigint;
}

export interface Deployments {
    network: string;
    operatorId: string;
    hcs: { ascendRoundsTopicId: string };
    hts: { ascendTokenId: string };
    contracts: { agentRegistry: string; predictionMarket: string; stakingVault: string };
    createdAt: string;
}

// ── Contract Client ──

export class ContractClient {
    private provider: ethers.JsonRpcProvider;
    private signer: ethers.Wallet;
    private registry: ethers.Contract;
    private market: ethers.Contract;
    private vault: ethers.Contract;

    constructor(rpcUrl: string, privateKey: string, registryAddr: string, marketAddr: string, vaultAddr: string) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.signer = new ethers.Wallet(privateKey, this.provider);
        this.registry = new ethers.Contract(registryAddr, AGENT_REGISTRY_ABI, this.signer);
        this.market = new ethers.Contract(marketAddr, PREDICTION_MARKET_ABI, this.signer);
        this.vault = new ethers.Contract(vaultAddr, STAKING_VAULT_ABI, this.signer);
    }

    // ── Agent Registry ──

    async registerAgent(name: string, description: string, bondHbar: number): Promise<bigint> {
        const tx: ContractTransactionResponse = await this.registry.registerAgent(
            name,
            description,
            { value: ethers.parseEther(bondHbar.toString()), gasLimit: 400_000 }
        );
        const receipt = await tx.wait();
        const log = receipt?.logs.find((l: any) => {
            try {
                return this.registry.interface.parseLog({ topics: [...l.topics], data: l.data })?.name === "AgentRegistered";
            } catch { return false; }
        });
        if (log) {
            const parsed = this.registry.interface.parseLog({ topics: [...log.topics], data: log.data });
            return parsed?.args[0] as bigint;
        }
        throw new Error("Agent registration failed — no event emitted");
    }

    async getAgent(agentId: number): Promise<AgentData> {
        const a = await this.registry.getAgent(agentId);
        return {
            owner: a[0], name: a[1], description: a[2],
            totalPredictions: a[3], correctPredictions: a[4],
            credScore: a[5], registrationBond: a[6], totalStaked: a[7],
            registeredAt: a[8], active: a[9],
        };
    }

    async getAgentCount(): Promise<number> {
        return Number(await this.registry.getAgentCount());
    }

    // ── Prediction Market ──

    async createRound(
        commitDurationSecs: number,
        revealDurationSecs: number,
        roundDurationSecs: number,
        startPrice: bigint,
        entryFeeHbar: number
    ): Promise<bigint> {
        const tx: ContractTransactionResponse = await this.market.createRound(
            commitDurationSecs,
            revealDurationSecs,
            roundDurationSecs,
            startPrice,
            ethers.parseEther(entryFeeHbar.toString()),
            { gasLimit: 300_000 }
        );
        const receipt = await tx.wait();
        const log = receipt?.logs.find((l: any) => {
            try {
                return this.market.interface.parseLog({ topics: [...l.topics], data: l.data })?.name === "RoundCreated";
            } catch { return false; }
        });
        if (log) {
            const parsed = this.market.interface.parseLog({ topics: [...log.topics], data: log.data });
            return parsed?.args[0] as bigint;
        }
        throw new Error("Round creation failed — no event emitted");
    }

    async commitPrediction(roundId: number, agentId: number, commitHash: string, entryFeeHbar: number = 0): Promise<void> {
        const tx: ContractTransactionResponse = await this.market.commitPrediction(
            roundId, agentId, commitHash,
            { value: ethers.parseEther(entryFeeHbar.toString()), gasLimit: 300_000 }
        );
        await tx.wait();
    }

    async revealPrediction(roundId: number, agentId: number, direction: number, confidence: number, salt: string): Promise<void> {
        const tx: ContractTransactionResponse = await this.market.revealPrediction(
            roundId, agentId, direction, confidence, salt,
            { gasLimit: 300_000 }
        );
        await tx.wait();
    }

    async resolveRound(roundId: number, endPrice: bigint): Promise<void> {
        const tx: ContractTransactionResponse = await this.market.resolveRound(
            roundId, endPrice, { gasLimit: 500_000 }
        );
        await tx.wait();
    }

    async getRound(roundId: number): Promise<RoundData> {
        const r = await this.market.getRound(roundId);
        return {
            startPrice: r[0], endPrice: r[1],
            commitDeadline: r[2], revealDeadline: r[3], resolveAfter: r[4],
            entryFee: r[5], status: Number(r[6]), participantCount: r[7],
        };
    }

    async getCommitment(roundId: number, agentId: number): Promise<CommitmentData> {
        const c = await this.market.getCommitment(roundId, agentId);
        return { committed: c[0], revealed: c[1], direction: Number(c[2]), confidence: c[3] };
    }

    async getRoundCount(): Promise<number> {
        return Number(await this.market.getRoundCount());
    }

    async getParticipantIds(roundId: number): Promise<number[]> {
        const ids = await this.market.getParticipantIds(roundId);
        return ids.map((id: bigint) => Number(id));
    }

    // ── Staking Vault ──

    async stakeOnAgent(agentId: number, amountHbar: number): Promise<void> {
        const tx: ContractTransactionResponse = await this.vault.stakeOnAgent(
            agentId,
            { value: ethers.parseEther(amountHbar.toString()), gasLimit: 200_000 }
        );
        await tx.wait();
    }

    async unstake(agentId: number, amountHbar: number): Promise<void> {
        const tx: ContractTransactionResponse = await this.vault.unstake(
            agentId, ethers.parseEther(amountHbar.toString()),
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

    async claimReward(agentId: number): Promise<void> {
        const tx: ContractTransactionResponse = await this.vault.claimReward(
            agentId,
            { gasLimit: 300_000 }
        );
        await tx.wait();
    }

    async getUserStake(agentId: number, userAddress: string): Promise<string> {
        const stake = await this.vault.getUserStake(agentId, userAddress);
        return ethers.formatEther(stake);
    }

    async getAgentTVL(agentId: number): Promise<string> {
        const tvl = await this.vault.getAgentTVL(agentId);
        return ethers.formatEther(tvl);
    }

    async getRewardPerToken(agentId: number): Promise<string> {
        const rpt = await this.vault.getRewardPerToken(agentId);
        return ethers.formatUnits(rpt, 18); // assuming 1e18 precision internally
    }

    async calculatePendingReward(agentId: number, userAddress: string): Promise<string> {
        const pending = await this.vault.calculatePendingReward(agentId, userAddress);
        return ethers.formatEther(pending);
    }

    getSignerAddress(): string {
        return this.signer.address;
    }

    // ── Crypto helpers ──

    static generateSalt(): string {
        return ethers.hexlify(ethers.randomBytes(32));
    }

    static computeCommitHash(direction: number, confidence: number, salt: string): string {
        return ethers.keccak256(
            ethers.solidityPacked(["uint8", "uint256", "bytes32"], [direction, confidence, salt])
        );
    }
}

// ── Factory ──

export function loadDeployments(): Deployments {
    const filePath = path.resolve(process.cwd(), "../deployments.json");
    if (!fs.existsSync(filePath)) {
        throw new Error(`deployments.json not found at ${filePath}. Run setup-hedera.ts first.`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function createContractClient(): ContractClient {
    const deployments = loadDeployments();
    const rpcUrl = process.env.HEDERA_JSON_RPC || "https://testnet.hashio.io/api";
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY not set");

    if (!deployments.contracts.stakingVault) {
        throw new Error("stakingVault address missing from deployments.json");
    }

    return new ContractClient(
        rpcUrl,
        privateKey,
        deployments.contracts.agentRegistry,
        deployments.contracts.predictionMarket,
        deployments.contracts.stakingVault
    );
}
