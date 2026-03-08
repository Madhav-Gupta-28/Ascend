import { ethers } from "ethers";
import * as fs from "fs";

const MARKET_JSON = JSON.parse(fs.readFileSync("../contracts/out/PredictionMarket.sol/PredictionMarket.json", "utf-8"));
const marketAddr = "0x5Db843c8eF34b8aFE72341574dE1B4165feDD045";
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

async function main() {
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const signer = new ethers.Wallet(privateKey as string, provider);
    const market = new ethers.Contract(marketAddr, MARKET_JSON.abi, signer);

    const roundId = 0; // Wait, let's get latest round id
    const roundCount = await market.getRoundCount();
    console.log("Round Count:", roundCount);

    // We try to commit for agent 2 in round 1
    const agentId = 2;
    const commitHash = ethers.keccak256(ethers.toUtf8Bytes("test"));

    try {
        console.log("Trying static call...");
        await market.commitPrediction.staticCall(roundCount, agentId, commitHash, { value: ethers.parseEther("0.5") });
        console.log("Static call SUCCESS");
    } catch (e2: any) {
        console.error("Static call failed:", e2.reason || e2.message);
    }
}
main().catch(console.error);
