// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { PoolE2EDeployer } from "../src/mocks/PoolE2EDeployer.sol";
import { BlackScholesSol } from "../src/math/BlackScholesSol.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";

/// @notice Deployer demo: feed mock vs eksternal, engine bersama vs terpisah. (Foundry tidak bisa menjalankan Stylus,
///         jadi mathA == mathB == BlackScholesSol di sini; di chain sungguhan mathB = program Stylus.)
contract PoolE2EDeployerTest is Test {
    uint256 internal constant T0 = 1_789_718_400;
    address internal owner = makeAddr("owner");
    BlackScholesSol internal math;

    function setUp() public {
        vm.warp(T0);
        math = new BlackScholesSol();
    }

    function test_mock_feed_path_matches_devnode_behaviour() public {
        PoolE2EDeployer d = new PoolE2EDeployer(owner, address(math), address(math), address(0), false);
        assertTrue(address(d.mockFeed()) != address(0));
        assertEq(address(d.feed()), address(d.mockFeed()));
        (, int256 answer, , uint256 updatedAt, ) = d.feed().latestRoundData();
        assertEq(answer, 4000e8);
        assertEq(updatedAt, T0);
        assertTrue(address(d.poolA().vol()) != address(d.poolB().vol()), "dua engine (devnode, apples-to-apples)");
        assertEq(d.usdg().balanceOf(owner), 4_000_000e6);
        assertEq(d.poolA().asset(), address(d.usdg()));
        assertEq(d.poolB().asset(), address(d.usdg()));
        assertEq(d.poolA().owner(), owner);
        assertEq(d.poolB().treasury(), owner);
        d.tick(4100e8);
        (, answer, , , ) = d.feed().latestRoundData();
        assertEq(answer, 4100e8);
    }

    function test_external_feed_path_shares_engine_and_forbids_tick() public {
        MockFeed external_ = new MockFeed(8);
        external_.set(2627e8, T0);
        PoolE2EDeployer d = new PoolE2EDeployer(owner, address(math), address(math), address(external_), true);
        assertEq(address(d.mockFeed()), address(0));
        assertEq(address(d.feed()), address(external_));
        assertTrue(d.sharedVol());
        assertEq(address(d.poolA().vol()), address(d.poolB().vol()), "engine bersama (K4)");
        assertEq(address(d.poolB().vol().feed()), address(external_));
        assertEq(d.factory().poolCount(), 2);
        assertEq(d.factory().pools(0), address(d.poolB()), "B dibuat dulu (pemilik engine)");
        vm.expectRevert(PoolE2EDeployer.NotMockFeed.selector);
        d.tick(2700e8);
    }

    function test_nextExpiry_is_on_friday_grid() public {
        PoolE2EDeployer d = new PoolE2EDeployer(owner, address(math), address(math), address(0), false);
        uint64 e = d.nextExpiry(604_800);
        assertEq((uint256(e) - 115_200) % 604_800, 0);
        assertGe(uint256(e), block.timestamp + 604_800);
    }
}
