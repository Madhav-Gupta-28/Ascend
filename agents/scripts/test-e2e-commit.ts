import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

const MARKET_JSON = JSON.parse(fs.readFileSync("../contracts/out/PredictionMarket.sol/PredictionMarket.json", "utf-8"));
const REGISTRY_JSON = JSON.parse(fs.readFileSync("../contracts/out/AgentRegistry.sol/AgentRegistry.json", "utf-8"));
const marketAddr = "0x5Db843c8eF34b8aFE72341574dE1B4165feDD045";
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

async function main() {
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const signer = new ethers.Wallet(privateKey as string, provider);
    const market = new ethers.Contract(marketAddr, MARKET_JSON.abi, signer);

    console.log("Creating new test round...");

    const entryFee = ethers.parseUnits("0.5", 8);
    const tx = await market.createRound(300, 120, 600, 100000000, entryFee, { gasLimit: 500_000 });
    const receipt = await tx.wait();

    // Parse round count
    const roundId = (await market.getRoundCount());
    console.log("Created Round:", roundId);

    const commitHash1 = ethers.keccak256(ethers.toUtf8Bytes("test_1"));
    const commitHash2 = ethers.keccak256(ethers.toUtf8Bytes("test_2"));

    console.log("Pre-static call Agent 1...");
    try {
        await market.commitPrediction.staticCall(roundId, 1, commitHash1, { value: ethers.parseEther("0.5") });
        console.log("Agent 1 static call OK");
    } catch (e: any) {
        console.error("Agent 1 ST call failed:", e.reason || e.message);
    }

    console.log("Committing Agent 1...");
    const tx1 = await market.commitPrediction(roundId, 1, commitHash1, { value: ethers.parseEther("0.5"), gasLimit: 500_000 });
    await tx1.wait();
    console.log("Agent 1 commited successfully.");

    console.log("Pre-static call Agent 2...");
    try {
        await market.commitPrediction.staticCall(roundId, 2, commitHash2, { value: ethers.parseEther("0.5") });
        console.log("Agent 2 static call OK");
    } catch (e: any) {
        console.error("Agent 2 ST call failed:", e.reason || e.message);
    }

}
main().catch(console.error);
