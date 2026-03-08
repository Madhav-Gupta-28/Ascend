import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

function loadArtifact(relPath: string): { abi: any; bytecode: string } {
    const fullPath = path.resolve(process.cwd(), relPath);
    const art = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    const bytecode = art.bytecode?.object ?? art.bytecode;
    if (!bytecode) throw new Error(`No bytecode in ${relPath}`);
    return { abi: art.abi, bytecode };
}
const REGISTRY_ART = loadArtifact("../contracts/out/AgentRegistry.sol/AgentRegistry.json");
const MARKET_ART = loadArtifact("../contracts/out/PredictionMarket.sol/PredictionMarket.json");
const VAULT_ART = loadArtifact("../contracts/out/StakingVault.sol/StakingVault.json");

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
    const RegistryFactory = new ethers.ContractFactory(REGISTRY_ART.abi, REGISTRY_ART.bytecode, signer);
    const registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();
    const registryAddr = await registry.getAddress();
    console.log(`✅ AgentRegistry deployed at: ${registryAddr}`);

    await new Promise(r => setTimeout(r, 3000));

    // 2. Prediction Market
    console.log("Deploying PredictionMarket...");
    const MarketFactory = new ethers.ContractFactory(MARKET_ART.abi, MARKET_ART.bytecode, signer);
    const market = await MarketFactory.deploy(registryAddr);
    await market.waitForDeployment();
    const marketAddr = await market.getAddress();
    console.log(`✅ PredictionMarket deployed at: ${marketAddr}`);

    await new Promise(r => setTimeout(r, 3000));

    // 3. Staking Vault
    console.log("Deploying StakingVault...");
    const VaultFactory = new ethers.ContractFactory(VAULT_ART.abi, VAULT_ART.bytecode, signer);
    const vault = await VaultFactory.deploy(registryAddr);
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log(`✅ StakingVault deployed at: ${vaultAddr}`);

    await new Promise(r => setTimeout(r, 3000));

    // 4. Authorizations
    console.log("Authorizing caller 1 (PredictionMarket)...");
    const regContract = new ethers.Contract(registryAddr, REGISTRY_ART.abi, signer);
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

    const contractsDir = path.resolve(process.cwd(), "../contracts");
    fs.writeFileSync(
        path.join(contractsDir, "deployments.json"),
        JSON.stringify(config, null, 2)
    );
    console.log("\n📄 Saved to contracts/deployments.json");

    // Update contract addresses in app/.env and root .env
    const updates: [string, string][] = [
        ["NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS", registryAddr],
        ["NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS", marketAddr],
        ["NEXT_PUBLIC_STAKING_VAULT_ADDRESS", vaultAddr],
        ["AGENT_REGISTRY_ADDRESS", registryAddr],
        ["PREDICTION_MARKET_ADDRESS", marketAddr],
        ["STAKING_VAULT_ADDRESS", vaultAddr],
    ];
    const appEnvPath = path.resolve(process.cwd(), "../app/.env");
    const rootEnvPath = path.resolve(process.cwd(), "../.env");
    for (const envPath of [appEnvPath, rootEnvPath]) {
        if (fs.existsSync(envPath)) {
            let content = fs.readFileSync(envPath, "utf-8");
            for (const [key, value] of updates) {
                const re = new RegExp(`^(${key}=).*`, "m");
                if (re.test(content)) content = content.replace(re, `$1${value}`);
                else content = content.trimEnd() + `\n${key}=${value}\n`;
            }
            fs.writeFileSync(envPath, content);
            console.log(`   Updated ${path.relative(process.cwd(), envPath)}`);
        }
    }
}

main().catch(console.error);
