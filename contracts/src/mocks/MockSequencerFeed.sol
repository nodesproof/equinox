// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @notice L2 Sequencer Uptime Feed tiruan: answer 0 = up, 1 = down; startedAt = saat status berubah.
contract MockSequencerFeed is IAggregatorV3 {
    int256 public answer;
    uint256 public startedAt;

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function set(int256 answer_, uint256 startedAt_) external {
        answer = answer_;
        startedAt = startedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, startedAt, 1);
    }
}
