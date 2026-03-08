import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

const MARKET_JSON = JSON.parse(fs.readFileSync("../contracts/out/PredictionMarket.sol/PredictionMarket.json", "utf-8"));
const marketAddr = "0x5Db843c8eF34b8aFE72341574dE1B4165feDD045";
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

async function main() {
    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const signer = new ethers.Wallet(privateKey as string, provider);
    const market = new ethers.Contract(marketAddr, MARKET_JSON.abi, signer);

    const commitDurationSecs = 300;
    const revealDurationSecs = 120;
    const roundDurationSecs = 600;
    const startPrice = 9442700n;
    const entryFeeHbarStr = "0.5";
    const entryFeeHbarDec = ethers.parseUnits("0.5", 8);

    console.log("Testing static createRound...");
    try {
        await market.createRound.staticCall(
            commitDurationSecs, revealDurationSecs, roundDurationSecs, startPrice, entryFeeHbarDec
        );
        console.log("Static call OK");
    } catch (e: any) {
        console.error("Static call failed:", e.reason || e.message);
    }
}
main().catch(console.error);
