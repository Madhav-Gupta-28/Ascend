// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AgentRegistry.sol";
import "../src/PredictionMarket.sol";

/// @notice Deploys AgentRegistry + PredictionMarket and configures cross-contract permissions
contract DeployAscend is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        // 1. Deploy AgentRegistry
        AgentRegistry registry = new AgentRegistry();
        console.log("AgentRegistry deployed at:", address(registry));

        // 2. Deploy PredictionMarket (pass registry address)
        PredictionMarket market = new PredictionMarket(address(registry));
        console.log("PredictionMarket deployed at:", address(market));

        // 3. Authorize PredictionMarket to call updateScore + updateTotalStaked on AgentRegistry
        registry.setAuthorizedCaller(address(market), true);
        console.log("PredictionMarket authorized on AgentRegistry");

        vm.stopBroadcast();

        // 4. Write deployments to JSON
        string memory json = vm.serializeAddress(
            "deployment",
            "agentRegistry",
            address(registry)
        );
        json = vm.serializeAddress(
            "deployment",
            "predictionMarket",
            address(market)
        );
        vm.writeJson(json, "./deployments.json");
        console.log("Deployments written to deployments.json");
    }
}
