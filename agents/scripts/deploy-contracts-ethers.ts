import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const REGISTRY_JSON = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../contracts/out/AgentRegistry.sol/AgentRegistry.json"), "utf-8"));
const MARKET_JSON = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../contracts/out/PredictionMarket.sol/PredictionMarket.json"), "utf-8"));
const VAULT_JSON = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../contracts/out/StakingVault.sol/StakingVault.json"), "utf-8"));

async function main() {
    const rpcUrl = process.env.HEDERA_JSON_RPC || "https://testnet.hashio.io/api";
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) throw new Error("Missing DEPLOYER_PRIVATE_KEY");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);

    console.log("═══════════════════════════════════════════");
    console.log("  Deploying Hedera Smart Contracts (Ethers)");
    console.log("═══════════════════════════════════════════");

    // 1. Agent Registry
    console.log("Deploying AgentRegistry...");
    const RegistryFactory = new ethers.ContractFactory(REGISTRY_JSON.abi, REGISTRY_JSON.bytecode, signer);
    const registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();
    const registryAddr = await registry.getAddress();
    console.log(`✅ AgentRegistry deployed at: ${registryAddr}`);

    await new Promise(r => setTimeout(r, 3000));

    // 2. Prediction Market
    console.log("Deploying PredictionMarket...");
    const MarketFactory = new ethers.ContractFactory(MARKET_JSON.abi, MARKET_JSON.bytecode, signer);
    const market = await MarketFactory.deploy(registryAddr);
    await market.waitForDeployment();
    const marketAddr = await market.getAddress();
    console.log(`✅ PredictionMarket deployed at: ${marketAddr}`);

    await new Promise(r => setTimeout(r, 3000));

    // 3. Staking Vault
    console.log("Deploying StakingVault...");
    const VaultFactory = new ethers.ContractFactory(VAULT_JSON.abi, VAULT_JSON.bytecode, signer);
    const vault = await VaultFactory.deploy(registryAddr);
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log(`✅ StakingVault deployed at: ${vaultAddr}`);

    await new Promise(r => setTimeout(r, 3000));

    // 4. Authorizations
    console.log("Authorizing caller 1 (PredictionMarket)...");
    const regContract = new ethers.Contract(registryAddr, REGISTRY_JSON.abi, signer);
    let tx = await regContract.setAuthorizedCaller(marketAddr, true);
    await tx.wait();
    console.log(`✅ PredictionMarket authorized`);

    await new Promise(r => setTimeout(r, 3000));

    console.log("Authorizing caller 2 (StakingVault)...");
    tx = await regContract.setAuthorizedCaller(vaultAddr, true);
    await tx.wait();
    console.log(`✅ StakingVault authorized`);

    const config = {
        agentRegistry: registryAddr,
        predictionMarket: marketAddr,
        stakingVault: vaultAddr
    };

    fs.writeFileSync(
        path.resolve(process.cwd(), "../contracts/deployments.json"),
        JSON.stringify(config, null, 2)
    );
    console.log("\n📄 Saved to contracts/deployments.json");
}

main().catch(console.error);
