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

    const vaultAddr = process.env.STAKING_VAULT_ADDRESS!;
    const registryAddr = process.env.AGENT_REGISTRY_ADDRESS!;

    console.log("Signer:", signer.address);
    console.log("Vault:", vaultAddr);
    console.log("Registry:", registryAddr);

    // Check the vault's registry pointer
    const vault = new ethers.Contract(vaultAddr, [
        "function registry() view returns (address)",
        "function totalValueLocked() view returns (uint256)",
        "function stake(uint256 agentId) external payable",
    ], signer);

    const vaultRegistry = await vault.registry();
    console.log("Vault's registry:", vaultRegistry);
    console.log("Expected registry:", registryAddr);
    console.log("Registry match:", vaultRegistry.toLowerCase() === registryAddr.toLowerCase());

    const tvl = await vault.totalValueLocked();
    console.log("TVL:", tvl.toString());

    // Check agent exists on the registry the vault points to
    const registry = new ethers.Contract(vaultRegistry, [
        "function isAgentActive(uint256 agentId) view returns (bool)",
        "function getAgent(uint256 agentId) view returns (tuple(address owner, string name, string description, uint256 totalPredictions, uint256 correctPredictions, int256 credScore, uint256 registrationBond, uint256 totalStaked, uint256 registeredAt, bool active))",
        "function getAgentCount() view returns (uint256)",
    ], provider);

    const count = await registry.getAgentCount();
    console.log("\nAgent count from vault's registry:", Number(count));

    for (let i = 1; i <= Math.min(Number(count), 4); i++) {
        try {
            const active = await registry.isAgentActive(i);
            const agent = await registry.getAgent(i);
            console.log(`  Agent #${i}: name="${agent.name}" active=${active} owner=${agent.owner}`);
        } catch (err: any) {
            console.log(`  Agent #${i}: ERROR - ${err.message.slice(0, 100)}`);
        }
    }

    // Try a direct low-level stake call
    console.log("\nAttempting static call to stake(1) with 10 HBAR...");
    try {
        const value = ethers.parseUnits("10", 8); // 10 HBAR in tinybars
        console.log("  Value (tinybars):", value.toString());
        await vault.stake.staticCall(1, { value });
        console.log("  Static call succeeded!");
    } catch (err: any) {
        console.log("  Static call failed:", err.message.slice(0, 200));
    }

    // Try with weibars
    console.log("\nAttempting static call to stake(1) with 10 HBAR (weibars)...");
    try {
        const value = ethers.parseEther("10"); // 10 HBAR in weibars
        console.log("  Value (weibars):", value.toString());
        await vault.stake.staticCall(1, { value });
        console.log("  Static call succeeded!");
    } catch (err: any) {
        console.log("  Static call failed:", err.message.slice(0, 200));
    }
}

main().catch(console.error);
