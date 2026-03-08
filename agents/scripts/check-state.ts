import { ethers } from 'ethers';

async function main() {
    const rpc = 'https://testnet.hashio.io/api';
    const p = new ethers.JsonRpcProvider(rpc);
    const registryAddr = '0x6444300d3b8b1647a349b2Be46dA6b48420773B9';
    const marketAddr = '0x5Db843c8eF34b8aFE72341574dE1B4165feDD045';
    const regAbi = ['function getAgentCount() view returns (uint256)', 'function getAgent(uint256) view returns (tuple(address,string,string,uint256,uint256,int256,uint256,uint256,uint64,bool))'];
    const mktAbi = ['function getRoundCount() view returns (uint256)', 'function getRound(uint256) view returns (uint256,uint256,uint64,uint64,uint64,uint256,uint8,uint8,uint8,uint8)'];
    const reg = new ethers.Contract(registryAddr, regAbi, p);
    const mkt = new ethers.Contract(marketAddr, mktAbi, p);

    const agentCount = await reg.getAgentCount();
    console.log('Agent count:', agentCount.toString());
    for (let i = 1; i <= Number(agentCount); i++) {
        const a = await reg.getAgent(i);
        console.log(`Agent ${i}: name=${a[1]} preds=${a[3]} correct=${a[4]} credScore=${a[5]} staked=${a[7]} active=${a[9]}`);
    }

    const roundCount = await mkt.getRoundCount();
    console.log('\nRound count:', roundCount.toString());
    if (Number(roundCount) > 0) {
        const latest = Number(roundCount);
        for (let i = Math.max(1, latest - 2); i <= latest; i++) {
            const r = await mkt.getRound(i);
            console.log(`Round ${i}: startPrice=${r[0]} endPrice=${r[1]} status=${r[6]} outcome=${r[7]} participants=${r[8]} revealed=${r[9]}`);
        }
    }
}

main().catch(console.error);
