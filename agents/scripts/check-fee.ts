import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const rpc = 'https://testnet.hashio.io/api';
    const p = new ethers.JsonRpcProvider(rpc);
    const marketAddr = '0x5Db843c8eF34b8aFE72341574dE1B4165feDD045';
    const MARKET_JSON = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../contracts/out/PredictionMarket.sol/PredictionMarket.json"), "utf-8"));
    const mkt = new ethers.Contract(marketAddr, MARKET_JSON.abi, p);

    const roundCount = Number(await mkt.getRoundCount());
    console.log('Round count:', roundCount);

    // Check last 3 rounds
    for (let i = Math.max(1, roundCount - 2); i <= roundCount; i++) {
        const r = await mkt.getRound(i);
        console.log(`\nRound ${i}:`);
        console.log(`  startPrice: ${r[0]}`);
        console.log(`  endPrice: ${r[1]}`);
        console.log(`  entryFee (raw): ${r[5]}`);
        console.log(`  entryFee as ether: ${ethers.formatEther(r[5])}`);
        console.log(`  entryFee as 8dec: ${ethers.formatUnits(r[5], 8)}`);
        console.log(`  status: ${r[6]}`);
        console.log(`  participants: ${r[8]}`);
    }

    // Show what parseEther("0.5") gives
    console.log(`\nethers.parseEther("0.5") = ${ethers.parseEther("0.5")}`);
    console.log(`ethers.parseUnits("0.5", 8) = ${ethers.parseUnits("0.5", 8)}`);
}

main().catch(console.error);
