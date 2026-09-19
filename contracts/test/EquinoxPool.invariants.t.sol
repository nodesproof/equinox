// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PoolFixture } from "./PoolFixture.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";
import { MockUSDG } from "../src/mocks/MockUSDG.sol";
import { Test } from "forge-std/Test.sol";

/// @notice Handler: aksi acak LP/trader/keeper + pergerakan harga & waktu. Revert yang sah (cap, stale, slippage) diabaikan.
contract PoolHandler is Test {
    EquinoxPool public pool;
    MockFeed public feed;
    MockUSDG public usdg;
    address public lp;
    address public trader;
    uint256[] public ids;
    uint256 public boards;
    int256 public price8 = 4000e8;

    /// @dev Ghost (INV-15): true bila sebuah buy/close yang sukses menurunkan totalAssets > 1 unit aset (1e-6 USDG).
    bool public navDecreased;
    /// @dev Ghost: jumlah buy + close yang sukses (memastikan INV-15 tidak lolos secara vakum).
    uint256 public trades;

    constructor(EquinoxPool p, MockFeed f, MockUSDG u, address lp_, address trader_, uint256[] memory ids_, uint256 boards_) {
        pool = p;
        feed = f;
        usdg = u;
        lp = lp_;
        trader = trader_;
        ids = ids_;
        boards = boards_;
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1e6, 500_000e6);
        vm.prank(lp);
        try pool.deposit(amount, lp) {} catch {}
    }

    function withdraw(uint256 amount) external {
        uint256 maxW = pool.maxWithdraw(lp);
        if (maxW == 0) return;
        amount = bound(amount, 1, maxW);
        vm.prank(lp);
        try pool.withdraw(amount, lp, lp) {} catch {}
    }

    function buy(uint256 idx, uint256 size) external {
        uint256 id = ids[idx % ids.length];
        size = bound(size, 1e16, 20e18);
        uint256 before = pool.totalAssets();
        vm.prank(trader);
        try pool.buy(id, size, type(uint256).max) {
            uint256 after_ = pool.totalAssets();
            if (after_ + 1 < before) navDecreased = true; // 1 unit aset (1e-6 USDG) kelonggaran untuk truncation WAD->aset
            trades++;
        } catch {}
    }

    function close(uint256 idx, uint256 size) external {
        uint256 id = ids[idx % ids.length];
        uint256 bal = pool.token().balanceOf(trader, id);
        if (bal == 0) return;
        size = bound(size, 1, bal);
        uint256 before = pool.totalAssets();
        vm.prank(trader);
        try pool.close(id, size, 0) {
            uint256 after_ = pool.totalAssets();
            if (after_ + 1 < before) navDecreased = true; // kelonggaran yang sama seperti di buy()
            trades++;
        } catch {}
    }

    /// Majukan waktu <= 1 hari dan gerakkan harga +-<= 5%, lalu round baru + poke.
    function tickTime(uint256 dt, uint256 move) external {
        dt = bound(dt, 60, 1 days);
        move = bound(move, 0, 1000); // 0..1000 -> -5%..+5%
        vm.warp(block.timestamp + dt);
        int256 delta = int256(move) - 500;
        price8 = price8 + price8 * delta / 10_000;
        if (price8 < 100e8) price8 = 100e8;
        feed.set(price8, block.timestamp);
        pool.vol().poke();
    }

    function settle(uint256 b) external {
        b = b % boards;
        try pool.settle(b) {} catch {}
    }

    function claim(uint256 idx) external {
        uint256 id = ids[idx % ids.length];
        uint256 bal = pool.token().balanceOf(trader, id);
        if (bal == 0) return;
        vm.prank(trader);
        try pool.claim(id, bal) {} catch {}
    }
}

/// @notice INV-1, INV-2, INV-4, INV-10, INV-11 (PRD §12) + INV-15, INV-16 (R3-a) di bawah urutan aksi acak.
contract EquinoxPoolInvariants is PoolFixture {
    PoolHandler internal handler;
    uint256[] internal allIds;

    function setUp() public override {
        super.setUp();
        lpDeposit(500_000e6);
        // dua board: 7 hari (3800/4000/4200) dan 14 hari (3600/4400)
        (, , uint256[] memory a) = listBoard7d();
        uint128[] memory ks = new uint128[](2);
        ks[0] = 3600e18;
        ks[1] = 4400e18;
        uint256 b1 = pool.createBoard(uint64(T0 + 2 * WEEK), ks);
        (, , , uint256[] memory b) = pool.board(b1);
        for (uint256 i = 0; i < a.length; i++) allIds.push(a[i]);
        for (uint256 i = 0; i < b.length; i++) allIds.push(b[i]);
        handler = new PoolHandler(pool, feed, usdg, lp, trader, allIds, 2);
        targetContract(address(handler));
    }

    function _cashWad() internal view returns (uint256) {
        return usdg.balanceOf(address(pool)) * 1e12;
    }

    /// INV-1: reserved <= cash - escrow.
    function invariant_solvency() public view {
        assertLe(pool.reserved() + pool.escrowedPayouts(), _cashWad());
    }

    /// INV-2: reserved == sum OI x K seri terbuka.
    function invariant_reserved_equals_sum_oi_k() public view {
        uint256[] memory open = pool.openSeriesIds();
        uint256 sum;
        for (uint256 i = 0; i < open.length; i++) {
            (, , uint128 k, , , uint256 oi, , ) = pool.series(open[i]);
            sum += oi * uint256(k) / 1e18;
        }
        assertEq(pool.reserved(), sum);
    }

    /// INV-4: totalSupply(id) == oi untuk setiap seri (terbuka maupun settle).
    function invariant_supply_equals_oi() public view {
        for (uint256 i = 0; i < allIds.length; i++) {
            (, , , , , uint256 oi, , ) = pool.series(allIds[i]);
            assertEq(token.totalSupply(allIds[i]), oi);
        }
    }

    /// INV-11: escrow == sum oi x payout seri settle, dan <= cash.
    function invariant_escrow_matches_settled() public view {
        uint256 sum;
        for (uint256 i = 0; i < allIds.length; i++) {
            (, , , , bool settled, uint256 oi, , uint256 payout) = pool.series(allIds[i]);
            if (settled) sum += oi * payout / 1e18;
        }
        assertEq(pool.escrowedPayouts(), sum);
        assertLe(sum, _cashWad());
    }

    /// INV-10: sigma_mark dalam [sigma_min, sigma_max].
    function invariant_sigma_bounds() public view {
        uint256 s = pool.sigmaMarkNow();
        assertGe(s, 0.2e18);
        assertLe(s, 3e18);
    }

    /// INV-15 (R3-a): sebuah buy/close tidak pernah menurunkan NAV pada mark.
    function invariant_trades_never_decrease_nav() public view {
        assertFalse(handler.navDecreased());
    }

    /// INV-16 (R3-a): kuotasi beli >= kuotasi tutup untuk setiap seri terbuka dengan OI > 0 (ukuran = OI penuh).
    function invariant_quote_buy_geq_close() public view {
        uint256[] memory open = pool.openSeriesIds();
        for (uint256 i = 0; i < open.length; i++) {
            (, , , , , uint256 oi, , ) = pool.series(open[i]);
            if (oi == 0) continue;
            try pool.quoteBuy(open[i], oi) returns (EquinoxPool.QuoteOut memory q) {
                (uint256 closeAssets, , ) = pool.quoteClose(open[i], oi);
                assertGe(q.premiumAssets, closeAssets);
            } catch {} // OracleStale / SeriesExpired di antara tick -- tidak relevan untuk properti ini
        }
    }
}
