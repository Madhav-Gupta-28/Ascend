import * as dotenv from "dotenv";
import * as path from "path";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

async function main() {
    const rpc = process.env.HEDERA_JSON_RPC!;
    const provider = new ethers.JsonRpcProvider(rpc);

    const registryAddr = process.env.AGENT_REGISTRY_ADDRESS!;
    const vaultAddr = process.env.STAKING_VAULT_ADDRESS!;
    const marketAddr = process.env.PREDICTION_MARKET_ADDRESS!;

    console.log("Registry:", registryAddr);
    console.log("Vault:", vaultAddr);
    console.log("Market:", marketAddr);

    const registry = new ethers.Contract(registryAddr, [
        "function authorizedCallers(address) view returns (bool)",
        "function setAuthorizedCaller(address caller, bool authorized)",
        "function owner() view returns (address)",
    ], provider);

    const vaultAuthorized = await registry.authorizedCallers(vaultAddr);
    const marketAuthorized = await registry.authorizedCallers(marketAddr);
    const registryOwner = await registry.owner();

    console.log("Vault authorized:", vaultAuthorized);
    console.log("Market authorized:", marketAuthorized);
    console.log("Registry owner:", registryOwner);

    const privKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const signer = new ethers.Wallet(privKey, provider);
    console.log("Deployer:", signer.address);

    if (!vaultAuthorized) {
        console.log("\nAuthorizing StakingVault on AgentRegistry...");
        const regSigner = new ethers.Contract(registryAddr, [
            "function setAuthorizedCaller(address caller, bool authorized)",
        ], signer);
        const tx = await regSigner.setAuthorizedCaller(vaultAddr, true);
        await tx.wait();
        console.log("StakingVault authorized!");
    }

    if (!marketAuthorized) {
        console.log("\nAuthorizing PredictionMarket on AgentRegistry...");
        const regSigner = new ethers.Contract(registryAddr, [
            "function setAuthorizedCaller(address caller, bool authorized)",
        ], signer);
        const tx = await regSigner.setAuthorizedCaller(marketAddr, true);
        await tx.wait();
        console.log("PredictionMarket authorized!");
    }
}

main().catch(console.error);
