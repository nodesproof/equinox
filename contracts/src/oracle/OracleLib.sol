// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @title OracleLib — pembacaan spot Chainlink + L2 sequencer uptime dengan aturan kesegaran (FR-26).
/// @dev Semua pembacaan dibungkus try/catch: feed yang revert diperlakukan sebagai tidak segar, bukan sebagai bug.
library OracleLib {
    struct Spot {
        uint256 priceWad;   // harga dalam WAD (1e18)
        uint256 updatedAt;  // detik
        uint80 roundId;
        bool fresh;         // segar: sequencer naik (+grace), answer > 0, umur ≤ heartbeat × staleMult
    }

    /// @param scale 10^(18 − decimals feed), dihitung sekali saat deploy.
    function read(
        IAggregatorV3 feed,
        IAggregatorV3 sequencerFeed,
        uint256 scale,
        uint256 heartbeat,
        uint256 staleMult,
        uint256 sequencerGrace
    ) internal view returns (Spot memory s) {
        if (!sequencerUp(sequencerFeed, sequencerGrace)) return s; // fresh = false, price 0
        try feed.latestRoundData() returns (uint80 roundId, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) return s;
            s.priceWad = uint256(answer) * scale;
            s.updatedAt = updatedAt;
            s.roundId = roundId;
            s.fresh = block.timestamp - updatedAt <= heartbeat * staleMult;
        } catch {
            return s;
        }
    }

    /// @notice true bila tidak ada sequencer feed (address(0)), atau feed melaporkan naik dan grace period sudah lewat.
    function sequencerUp(IAggregatorV3 sequencerFeed, uint256 grace) internal view returns (bool) {
        if (address(sequencerFeed) == address(0)) return true;
        try sequencerFeed.latestRoundData() returns (uint80, int256 answer, uint256 startedAt, uint256, uint80) {
            // Konvensi Chainlink: answer 0 = up, 1 = down; startedAt = saat status terakhir berubah.
            if (answer != 0) return false;
            return block.timestamp - startedAt >= grace;
        } catch {
            return false;
        }
    }
}
