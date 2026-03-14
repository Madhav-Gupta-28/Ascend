import * as dotenv from "dotenv";
import * as path from "path";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

async function main() {
    const rpc = process.env.HEDERA_JSON_RPC!;
    const provider = new ethers.JsonRpcProvider(rpc);
    const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
    const vaultAddr = process.env.STAKING_VAULT_ADDRESS!;
    const vault = new ethers.Contract(vaultAddr, [
        "function stake(uint256 agentId) external payable",
        "function totalStakedOnAgent(uint256) view returns (uint256)",
        "function totalValueLocked() view returns (uint256)",
    ], signer);

    const stakes = [
        { agentId: 3, amount: 10 },  // Meridian
        { agentId: 4, amount: 10 },  // Oracle
    ];

    for (const s of stakes) {
        try {
            const tx = await vault.stake(s.agentId, {
                value: ethers.parseEther(s.amount.toString()),
                gasLimit: 300_000,
            });
            await tx.wait();
            console.log(`Staked ${s.amount} HBAR on Agent #${s.agentId}`);
        } catch (err: any) {
            console.error(`Failed Agent #${s.agentId}: ${err.message.slice(0, 150)}`);
        }
    }

    // Show final state
    const tvl = await vault.totalValueLocked();
    console.log(`\nTVL: ${ethers.formatUnits(tvl, 8)} HBAR`);
    for (let i = 1; i <= 4; i++) {
        const s = await vault.totalStakedOnAgent(i);
        console.log(`  Agent #${i}: ${ethers.formatUnits(s, 8)} HBAR`);
    }
    const bal = await provider.getBalance(signer.address);
    console.log(`\nRemaining balance: ${ethers.formatEther(bal)} HBAR`);
}

main().catch(console.error);
