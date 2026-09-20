// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { OracleLib } from "../src/oracle/OracleLib.sol";
import { IAggregatorV3 } from "../src/interfaces/IAggregatorV3.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";
import { MockSequencerFeed } from "../src/mocks/MockSequencerFeed.sol";

contract RevertingFeed {
    function decimals() external pure returns (uint8) { return 8; }
    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) { revert("feed down"); }
}

contract OracleHarness {
    function read(address feed, address seqf, uint256 scale, uint256 hb, uint256 mult, uint256 grace) external view returns (OracleLib.Spot memory) {
        return OracleLib.read(IAggregatorV3(feed), IAggregatorV3(seqf), scale, hb, mult, grace);
    }
}

/// @notice FR-15/FR-26: kesegaran spot, sequencer up + grace, feed revert → tidak segar (bukan revert).
contract OracleLibTest is Test {
    OracleHarness h;
    MockFeed feed;
    MockSequencerFeed seqf;
    uint256 constant T0 = 1_789_718_400;

    function setUp() public {
        vm.warp(T0);
        h = new OracleHarness();
        feed = new MockFeed(8);
        seqf = new MockSequencerFeed();
        feed.set(4000e8, T0);
        seqf.set(0, T0 - 2 hours);
    }

    function test_fresh_and_scaled() public view {
        OracleLib.Spot memory s = h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600);
        assertTrue(s.fresh);
        assertEq(s.priceWad, 4000e18);
        assertEq(s.roundId, 1);
    }

    function test_stale_after_heartbeat_times_mult() public {
        vm.warp(T0 + 3 hours);
        assertTrue(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        vm.warp(T0 + 3 hours + 1);
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
    }

    function test_sequencer_rules() public {
        seqf.set(1, T0);
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        seqf.set(0, T0);                                   // baru naik: dalam grace
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        vm.warp(T0 + 3600);
        assertTrue(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        assertTrue(h.read(address(feed), address(0), 1e10, 3600, 3, 3600).fresh); // tanpa sequencer feed
    }

    function test_bad_or_reverting_feed_is_not_fresh() public {
        feed.set(0, T0);
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        RevertingFeed bad = new RevertingFeed();
        OracleLib.Spot memory s = h.read(address(bad), address(seqf), 1e10, 3600, 3, 3600); // feed revert → tidak segar, bukan revert
        assertFalse(s.fresh);
        assertEq(s.priceWad, 0);
        assertFalse(h.read(address(feed), address(bad), 1e10, 3600, 3, 3600).fresh); // sequencer feed revert → tidak segar
    }

    function test_future_sequencer_startedAt_is_not_fresh_and_does_not_revert() public {
        seqf.set(0, T0 + 1000); // "up" tetapi startedAt di masa depan
        OracleLib.Spot memory s = h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600);
        assertFalse(s.fresh);
        assertEq(s.priceWad, 0);
    }

    /// M-3 (final review): an uninitialised L2-uptime round (startedAt == 0) must not count as "up since epoch".
    function test_sequencer_startedAt_zero_is_not_up() public {
        seqf.set(0, 0); // answer 0 = "up", but the round was never initialised
        OracleLib.Spot memory s = h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600);
        assertFalse(s.fresh);
        assertEq(s.priceWad, 0);
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 0).fresh); // even with grace 0
    }

    function test_future_updatedAt_is_not_fresh() public {
        feed.set(4000e8, T0 + 100);
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
    }

    function test_grace_zero_accepts_immediately() public {
        seqf.set(0, T0); // baru naik, grace 0 → langsung segar
        assertTrue(h.read(address(feed), address(seqf), 1e10, 3600, 3, 0).fresh);
    }
}
