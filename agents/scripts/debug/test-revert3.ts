import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

const MARKET_JSON = JSON.parse(fs.readFileSync("../contracts/out/PredictionMarket.sol/PredictionMarket.json", "utf-8"));
const REGISTRY_JSON = JSON.parse(fs.readFileSync("../contracts/out/AgentRegistry.sol/AgentRegistry.json", "utf-8"));
const marketAddr = "0x5Db843c8eF34b8aFE72341574dE1B4165feDD045";
const registryAddr = "0x6444300d3b8b1647a349b2Be46dA6b48420773B9";
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

async function main() {
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const signer = new ethers.Wallet(privateKey as string, provider);
    const market = new ethers.Contract(marketAddr, MARKET_JSON.abi, signer);
    const registry = new ethers.Contract(registryAddr, REGISTRY_JSON.abi, signer);

    const roundCount = await market.getRoundCount();
    console.log("Round Count:", roundCount);

    const count = await registry.getAgentCount();
    console.log("Registered Agents:", count);

    for (let agentId = 1; agentId <= 4; agentId++) {
        const agent = await registry.getAgent(agentId);
        console.log(`Agent ${agentId}:`, agent.name, "Active:", agent.active, "Owner:", agent.owner);

        const commitHash = ethers.keccak256(ethers.toUtf8Bytes("test_" + agentId));
        try {
            console.log(`Trying static call commit for Agent ${agentId}...`);
            await market.commitPrediction.staticCall(roundCount, agentId, commitHash, { value: ethers.parseEther("0.5") });
            console.log(`Static call SUCCESS for Agent ${agentId}`);
        } catch (e2: any) {
            console.error(`Static call failed for Agent ${agentId}:`, e2.reason || e2.message);
        }
    }
}
main().catch(console.error);
