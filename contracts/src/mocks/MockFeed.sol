// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @notice AggregatorV3 yang bisa di-set: harga (8 desimal), updatedAt, dan roundId naik setiap `set`.
contract MockFeed is IAggregatorV3 {
    uint8 public immutable dec;
    uint80 public roundId;
    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;

    constructor(uint8 decimals_) {
        dec = decimals_;
    }

    function decimals() external view returns (uint8) {
        return dec;
    }

    /// @notice Round baru dengan harga & waktu tertentu.
    function set(int256 answer_, uint256 updatedAt_) external {
        roundId += 1;
        answer = answer_;
        updatedAt = updatedAt_;
        startedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, roundId);
    }
}
