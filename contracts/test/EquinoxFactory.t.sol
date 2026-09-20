// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PoolFixture } from "./PoolFixture.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { EquinoxFactory } from "../src/pool/EquinoxFactory.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";

/// @notice K4: dua pool berbagi satu EquinoxVolEngine lewat createPoolWithVol — σ identik by construction.
contract EquinoxFactoryTest is PoolFixture {
    EquinoxPool internal pool2;

    function _deploySharedPool() internal returns (EquinoxPool p) {
        EquinoxPool.Deploy memory d = deployParams(address(mathSol));
        d.name = "Equinox LP (shared)";
        d.symbol = "eqS";
        p = EquinoxPool(factory.createPoolWithVol(d, address(vol)));
        usdg.mint(lp, 1_000_000e6);
        vm.startPrank(lp);
        usdg.approve(address(p), type(uint256).max);
        p.deposit(1_000_000e6, lp);
        vm.stopPrank();
        vm.prank(trader);
        usdg.approve(address(p), type(uint256).max);
    }

    function test_createPoolWithVol_shares_engine_and_registers_pool() public {
        pool2 = _deploySharedPool();
        assertEq(address(pool2.vol()), address(vol), "engine bersama");
        assertEq(factory.poolCount(), 2);
        assertEq(factory.pools(1), address(pool2));
        assertEq(address(pool2.token().pool()), address(pool2), "token terikat ke pool baru");
        assertTrue(address(pool2.token()) != address(token), "token ERC-1155 tetap per pool");
    }

    function test_trade_on_shared_pool_pokes_common_engine_and_quotes_match() public {
        pool2 = _deploySharedPool();
        lpDeposit(1_000_000e6);
        // board identik di kedua pool
        (, uint64 expiry, uint256[] memory ids1) = listBoard7d();
        uint128[] memory ks = new uint128[](3);
        ks[0] = 3800e18; ks[1] = 4000e18; ks[2] = 4200e18;
        uint256 b2 = pool2.createBoard(expiry, ks);
        (, , , uint256[] memory ids2) = pool2.board(b2);
        // round feed baru; trade di pool2 saja → engine bersama ter-poke
        vm.warp(T0 + 1 hours);
        tick(4100e8);
        uint80 before = vol.lastRoundId();
        vm.prank(trader);
        pool2.buy(ids2[4], 1e18, type(uint256).max); // C4200 di pool2
        assertGt(vol.lastRoundId(), before, "poke lewat pool2");
        // trade identik di pool pertama → state identik → kuotasi identik (σ dari engine yang sama)
        vm.prank(trader);
        pool.buy(ids1[4], 1e18, type(uint256).max);
        EquinoxPool.QuoteOut memory q1 = pool.quoteBuy(ids1[4], 1e18);
        EquinoxPool.QuoteOut memory q2 = pool2.quoteBuy(ids2[4], 1e18);
        assertEq(q1.premiumAssets, q2.premiumAssets);
        assertEq(q1.sigma, q2.sigma);
        assertEq(pool.sigmaMarkNow(), pool2.sigmaMarkNow());
    }

    function test_createPoolWithVol_rejects_feed_mismatch() public {
        MockFeed other = new MockFeed(8);
        other.set(4000e8, block.timestamp);
        EquinoxPool.Deploy memory d = deployParams(address(mathSol));
        d.feed = address(other);
        vm.expectRevert(EquinoxFactory.VolFeedMismatch.selector);
        factory.createPoolWithVol(d, address(vol));
    }
}
