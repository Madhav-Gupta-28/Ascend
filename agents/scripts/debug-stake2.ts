import * as dotenv from "dotenv";
import * as path from "path";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

async function main() {
    const rpc = process.env.HEDERA_JSON_RPC!;
    const provider = new ethers.JsonRpcProvider(rpc);
    const privKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const signer = new ethers.Wallet(privKey, provider);

    const balance = await provider.getBalance(signer.address);
    console.log("Balance:", ethers.formatEther(balance), "HBAR (formatEther)");
    console.log("Balance:", ethers.formatUnits(balance, 8), "HBAR (formatUnits 8)");
    console.log("Balance raw:", balance.toString());

    const vaultAddr = process.env.STAKING_VAULT_ADDRESS!;
    const vault = new ethers.Contract(vaultAddr, [
        "function stake(uint256 agentId) external payable",
        "function totalValueLocked() view returns (uint256)",
        "function totalStakedOnAgent(uint256) view returns (uint256)",
    ], signer);

    const tvl = await vault.totalValueLocked();
    console.log("\nTVL raw:", tvl.toString());
    console.log("TVL (8 decimals):", ethers.formatUnits(tvl, 8));

    for (let i = 1; i <= 4; i++) {
        const staked = await vault.totalStakedOnAgent(i);
        console.log(`Agent #${i} staked raw: ${staked.toString()}`);
    }

    // Try staking 10 HBAR on agent #2
    console.log("\nTrying static call: stake(2) with 10 HBAR...");
    const value = ethers.parseEther("10");
    console.log("Value:", value.toString());
    try {
        await vault.stake.staticCall(2, { value });
        console.log("Static call OK! Now sending real tx...");
        const tx = await vault.stake(2, { value, gasLimit: 300_000 });
        await tx.wait();
        console.log("Staked 10 HBAR on Agent #2!");
    } catch (err: any) {
        console.log("Failed:", err.message.slice(0, 300));
    }
}

main().catch(console.error);
