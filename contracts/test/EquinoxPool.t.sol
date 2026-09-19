// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PoolFixture } from "./PoolFixture.sol";
import { Vm } from "forge-std/Vm.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { EquinoxOptionToken } from "../src/pool/EquinoxOptionToken.sol";
import { EquinoxVolEngine } from "../src/pool/EquinoxVolEngine.sol";
import { IBlackScholes } from "../src/interfaces/IBlackScholes.sol";
import { MockSwitchableMath } from "../src/mocks/MockSwitchableMath.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Skenario wajib PRD §12 (1–13) + properti INV-1..4, INV-9, INV-11, INV-14 pada jalur happy/edge.
contract EquinoxPoolTest is PoolFixture {
    // ------------------------------------------------------------ LP

    function test_deposit_withdraw_no_positions() public {
        uint256 shares = lpDeposit(1_000_000e6);
        assertEq(pool.totalAssets(), 1_000_000e6);
        assertEq(pool.freeLiquidity(), 1_000_000e6);
        vm.prank(lp);
        pool.withdraw(400_000e6, lp, lp);
        assertEq(pool.totalAssets(), 600_000e6);
        assertLt(pool.balanceOf(lp), shares);
    }

    // ------------------------------------------------------------ kuotasi & buy

    /// Premi pool == formula §6.4/§8.4 yang dihitung ulang langsung lewat math + vol engine.
    function test_buy_premium_matches_formula() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        uint256 size = 10e18;
        // hitung ulang
        uint256 t = uint256(WEEK) * WAD / 31_536_000;
        uint256 sigmaNow = vol.sigmaMark(0);
        (, , int256 vegaUnit) = mathSol.cappedCall(4000e18, 4200e18, 8400e18, t, sigmaNow, 0);
        uint256 vegaTotal = uint256(vegaUnit) * size / WAD;
        uint256 vegaCap = 1_000_000e18 * 500 / 10_000;
        uint256 util = vegaTotal * WAD / vegaCap;
        uint256 sigmaBuy = vol.sigmaMark(util) * (WAD + 0.05e18) / WAD;
        (uint256 p, , ) = mathSol.cappedCall(4000e18, 4200e18, 8400e18, t, sigmaBuy, 0);
        uint256 premiumWad = p * size / WAD;
        uint256 expectedPremium = (premiumWad + 1e12 - 1) / 1e12;
        uint256 expectedFee = (premiumWad * 300 / 10_000 + 1e12 - 1) / 1e12;

        EquinoxPool.QuoteOut memory q = pool.quoteBuy(id, size);
        assertEq(q.premiumAssets, expectedPremium, "premium");
        assertEq(q.feeAssets, expectedFee, "fee");
        assertEq(q.sigma, sigmaBuy, "sigma");
        // dampak inventaris: sigma_buy > sigma_mark(0) × (1+s)
        assertGt(sigmaBuy, vol.sigmaMark(0) * (WAD + 0.05e18) / WAD);
        // sanity ekonomi: mid pada 63,25% ≈ 64,87/unit → beli 10 unit dengan spread+dampak antara 700 dan 800 USDG
        assertGt(q.premiumAssets, 700e6);
        assertLt(q.premiumAssets, 800e6);

        uint256 balBefore = usdg.balanceOf(trader);
        uint256 paid = traderBuy(id, size);
        assertEq(paid, expectedPremium);
        assertEq(balBefore - usdg.balanceOf(trader), expectedPremium + expectedFee);
        assertEq(usdg.balanceOf(treasury), expectedFee);
    }

    /// INV-2 dan INV-4 setelah buy.
    function test_buy_updates_reserved_oi_supply_netVega() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 10e18);
        (, , , , , uint256 oi, uint256 vegaAcc, ) = pool.series(id);
        assertEq(oi, 10e18);
        assertEq(token.totalSupply(id), 10e18);
        assertEq(token.balanceOf(trader, id), 10e18);
        assertEq(pool.reserved(), 4200e18 * 10);
        assertEq(pool.netVega(), vegaAcc);
        assertGt(pool.netVega(), 0);
        assertEq(pool.freeLiquidity(), usdg.balanceOf(address(pool)) - 42_000e6, "free = cash - reserved");
    }

    /// Skenario 4 (INV-9): beli lalu tutup di blok yang sama → trader rugi ≥ 2·s·vega + fee; tidak ada round-trip gratis.
    function test_wash_trade_is_not_free() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        uint256 before = usdg.balanceOf(trader);
        traderBuy(id, 50e18);
        vm.prank(trader);
        uint256 proceeds = pool.close(id, 50e18, 0);
        uint256 loss = before - usdg.balanceOf(trader);
        assertGt(loss, 0, "round trip must cost");
        assertGt(loss, proceeds / 20, "loss >= ~5% (2x spread) of notional premium");
        // pool kembali bersih
        assertEq(pool.reserved(), 0);
        assertEq(pool.netVega(), 0);
        assertEq(token.totalSupply(id), 0);
        // INV-9 pada state yang sama: quoteClose < quoteBuy
        EquinoxPool.QuoteOut memory qb = pool.quoteBuy(id, 1e18);
        (uint256 qc, , ) = pool.quoteClose(id, 1e18);
        assertLt(qc, qb.premiumAssets);
    }

    // ------------------------------------------------------------ settlement

    /// Skenario 1: deposit → beli 10 C 4200 → expiry, S_T = 4.500 → settle → claim 3.000 → NAV LP = 1e6 + premi − 3.000.
    function test_scenario1_settle_claim_nav() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        uint256 premium = traderBuy(id, 10e18);
        vm.warp(expiry);
        tick(4500e8);
        address keeper = makeAddr("keeper");
        vm.recordLogs();
        vm.prank(keeper);
        pool.settle(boardId);
        (uint256 sT, uint256 added, uint256 released) = _settledEvent(vm.getRecordedLogs(), boardId);
        assertEq(sT, 4500e18);
        assertEq(added, 3000e18);
        assertEq(released, 42_000e18);
        assertLe(added, released, "INV-13: escrow added <= reserve released");
        assertEq(usdg.balanceOf(keeper), 2e6, "bounty");
        (, , , , bool settled, , , uint256 payoutPerUnit) = pool.series(id);
        assertTrue(settled);
        assertEq(payoutPerUnit, 300e18);
        assertEq(pool.escrowedPayouts(), 3000e18);
        assertEq(pool.reserved(), 0);
        vm.prank(trader);
        uint256 got = pool.claim(id, 10e18);
        assertEq(got, 3000e6);
        assertEq(pool.escrowedPayouts(), 0);
        assertEq(token.totalSupply(id), 0);
        assertEq(pool.totalAssets(), 1_000_000e6 + premium - 3000e6 - 2e6, "NAV LP");
        // LP bisa menarik semuanya sekarang
        uint256 lpShares = pool.balanceOf(lp);
        vm.prank(lp);
        pool.redeem(lpShares, lp, lp);
        assertEq(usdg.balanceOf(address(pool)), 0);
    }

    /// Skenario 2 (INV-1/INV-3): 200 C 4.000 (util 80%) lalu S_T = 40.000 → payout = cadangan; LP tersisa ≥ 200k + premi.
    function test_scenario2_solvency_extreme() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4000e18, true);
        // pecah dalam 4 pembelian agar vega cap tidak mengunci lebih dulu; total 200 unit = 800k cadangan = 80%
        uint256 premiumTotal;
        for (uint256 i = 0; i < 4; i++) premiumTotal += traderBuy(id, 50e18);
        assertEq(pool.reserved(), 800_000e18);
        // kapital = cash - escrow (termasuk premi yang masuk); 80% x kapital < 800k + 80k
        uint256 capital = usdg.balanceOf(address(pool));
        assertLt(capital * 8000 / 10_000, 880_000e6);
        vm.expectRevert(EquinoxPool.UtilizationExceeded.selector);
        vm.prank(trader);
        pool.buy(id, 20e18, type(uint256).max);
        vm.warp(expiry);
        tick(40_000e8);
        vm.recordLogs();
        pool.settle(boardId);
        (, uint256 added, uint256 released) = _settledEvent(vm.getRecordedLogs(), boardId);
        assertEq(added, 800_000e18);
        assertEq(released, 800_000e18);
        assertLe(added, released, "INV-13: escrow added <= reserve released (equal at the cap)");
        assertEq(pool.escrowedPayouts(), 800_000e18, "payout = reserved (cap)");
        vm.prank(trader);
        pool.claim(id, 200e18);
        assertEq(usdg.balanceOf(address(pool)), 200_000e6 + premiumTotal - 2e6);
        assertGe(pool.totalAssets(), 200_000e6);
    }

    /// Skenario 3: P 2.600 → premi = floor 5 bps × K (tidak nol).
    function test_deep_otm_floor() public {
        lpDeposit(1_000_000e6);
        uint64 expiry = uint64(T0 + WEEK);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 2600e18;
        pool.createBoard(expiry, ks);
        uint256 id = sid(expiry, 2600e18, false);
        EquinoxPool.QuoteOut memory q = pool.quoteBuy(id, 1e18);
        assertEq(q.premiumAssets, 2600e6 * 5 / 10_000, "floor 5 bps x K");
        traderBuy(id, 1e18);
    }

    /// Skenario 11: cap — S_T = 9.000 dan 8.400 membayar sama (K).
    function test_cap_payout_same_beyond_cap() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 1e18);
        vm.warp(expiry);
        tick(9000e8);
        pool.settle(boardId);
        (, , , , , , , uint256 payout) = pool.series(id);
        assertEq(payout, 4200e18);
    }

    /// Skenario 7: aturan round settlement.
    function test_settlement_round_rules() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        vm.expectRevert(EquinoxPool.BoardNotExpired.selector);
        pool.settle(boardId);
        vm.warp(expiry);
        // round terakhir masih dari sebelum expiry → belum siap
        vm.expectRevert(EquinoxPool.SettlementNotReady.selector);
        pool.settle(boardId);
        tick(4100e8);
        pool.settle(boardId);
        vm.expectRevert(EquinoxPool.BoardAlreadySettled.selector);
        pool.settle(boardId);
        (, bool settled, uint256 sp, ) = pool.board(boardId);
        assertTrue(settled);
        assertEq(sp, 4100e18);
        assertEq(pool.openSeriesIds().length, 0);
    }

    // ------------------------------------------------------------ oracle & pause

    /// Skenario 5 (FR-36): stale → buy/close/deposit revert; withdraw memakai NAV konservatif; claim seri settle tetap jalan.
    function test_oracle_stale_paths() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 10e18);
        uint256 navFresh = pool.totalAssets();
        vm.warp(block.timestamp + 4 hours); // > heartbeat × staleMult = 3 jam
        (, bool fresh) = pool.spot();
        assertFalse(fresh);
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(trader);
        pool.buy(id, 1e18, type(uint256).max);
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(trader);
        pool.close(id, 1e18, 0);
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(lp);
        pool.deposit(1e6, lp);
        // NAV konservatif = cash − escrow − reserved < NAV segar (MtM)
        uint256 navStale = pool.totalAssets();
        assertLt(navStale, navFresh);
        assertEq(navStale, usdg.balanceOf(address(pool)) - 42_000e6);
        // withdraw tetap jalan (dibatasi likuiditas bebas)
        uint256 maxW = pool.maxWithdraw(lp);
        assertEq(maxW, pool.freeLiquidity());
        vm.prank(lp);
        pool.withdraw(1000e6, lp, lp);
        // settle & claim setelah round segar pasca-expiry
        vm.warp(expiry);
        tick(4300e8);
        pool.settle(boardId);
        vm.warp(block.timestamp + 5 hours); // stale lagi
        vm.prank(trader);
        assertEq(pool.claim(id, 10e18), 1000e6);
    }

    /// Skenario 6: sequencer down → stale; setelah grace → normal.
    function test_sequencer_down_and_grace() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        seq.set(1, block.timestamp);
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(trader);
        pool.buy(id, 1e18, type(uint256).max);
        seq.set(0, block.timestamp);          // baru naik: masih dalam grace
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(trader);
        pool.buy(id, 1e18, type(uint256).max);
        vm.warp(block.timestamp + 3600);
        tick(4000e8);
        traderBuy(id, 1e18);
    }

    /// Skenario 8 (INV-14): pause hanya memblokir buy & createBoard.
    function test_pause_semantics() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 5e18);
        pool.pauseTrading(true);
        vm.expectRevert(EquinoxPool.TradingIsPaused.selector);
        vm.prank(trader);
        pool.buy(id, 1e18, type(uint256).max);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 4100e18;
        vm.expectRevert(EquinoxPool.TradingIsPaused.selector);
        pool.createBoard(uint64(T0 + 2 * WEEK), ks);
        vm.prank(trader);
        pool.close(id, 2e18, 0);
        vm.prank(lp);
        pool.withdraw(1000e6, lp, lp);
        vm.warp(expiry);
        tick(4300e8);
        pool.settle(boardId);
        vm.prank(trader);
        pool.claim(id, 3e18);
    }

    // ------------------------------------------------------------ batas

    function test_vega_cap() public {
        lpDeposit(100_000e6); // vegaCap = 5% x 100k = 5.000 USDG per 1,00 vol; ATM 28h vega ~ 450/unit -> ~11 unit
        uint64 expiry = uint64(T0 + 4 * WEEK);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 4000e18;
        pool.createBoard(expiry, ks);
        uint256 id = sid(expiry, 4000e18, true);
        vm.expectRevert(EquinoxPool.VegaCapExceeded.selector);
        vm.prank(trader);
        pool.buy(id, 12e18, type(uint256).max);   // cadangan 48k < 80k (util ok), vega ~5.4k > 5k
        traderBuy(id, 8e18);
    }

    function test_createBoard_validation() public {
        lpDeposit(1_000_000e6);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 4000e18;
        vm.expectRevert(EquinoxPool.BadExpiry.selector);
        pool.createBoard(uint64(T0 + WEEK + 1), ks);                   // bukan grid Jumat 08:00
        vm.expectRevert(EquinoxPool.BadExpiry.selector);
        pool.createBoard(uint64(T0 + 5 * WEEK), ks);                   // > tenorMax 30 hari
        uint128[] memory bad = new uint128[](1);
        bad[0] = 1000e18;                                              // < S/2
        vm.expectRevert(EquinoxPool.BadStrike.selector);
        pool.createBoard(uint64(T0 + WEEK), bad);
        uint128[] memory unsorted = new uint128[](2);
        unsorted[0] = 4200e18;
        unsorted[1] = 4000e18;
        vm.expectRevert(EquinoxPool.BadStrike.selector);
        pool.createBoard(uint64(T0 + WEEK), unsorted);
        uint128[] memory many = new uint128[](17);                     // 34 seri > 32
        for (uint256 i = 0; i < 17; i++) many[i] = uint128(3000e18 + i * 100e18);
        vm.expectRevert(EquinoxPool.TooManySeries.selector);
        pool.createBoard(uint64(T0 + WEEK), many);
        uint128[] memory ok = new uint128[](15);                       // 30 seri
        for (uint256 i = 0; i < 15; i++) ok[i] = uint128(3000e18 + i * 100e18);
        pool.createBoard(uint64(T0 + WEEK), ok);
        assertEq(pool.openSeriesIds().length, 30);
        uint128[] memory dup = new uint128[](1);
        dup[0] = 3000e18;                                              // seri (expiry, 3000, call) sudah ada
        vm.expectRevert(EquinoxPool.BadStrike.selector);
        pool.createBoard(uint64(T0 + WEEK), dup);
        uint128[] memory two = new uint128[](2);                       // 30 + 4 > 32
        two[0] = 5000e18;
        two[1] = 5100e18;
        vm.expectRevert(EquinoxPool.TooManySeries.selector);
        pool.createBoard(uint64(T0 + WEEK), two);
        uint128[] memory last = new uint128[](1);
        last[0] = 4500e18;                                             // 30 + 2 = 32 tepat
        pool.createBoard(uint64(T0 + WEEK), last);
        assertEq(pool.openSeriesIds().length, 32);
    }

    function test_min_size_and_unknown_series() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        vm.expectRevert(EquinoxPool.SizeTooSmall.selector);
        vm.prank(trader);
        pool.buy(id, 1e15, type(uint256).max);
        vm.expectRevert(EquinoxPool.SeriesUnknown.selector);
        vm.prank(trader);
        pool.buy(12345, 1e18, type(uint256).max);
    }

    /// NAV MtM: setelah buy, NAV ≈ cash − MtM(mid) → LP langsung mencatat spread sebagai laba; theta menaikkan NAV seiring waktu.
    function test_nav_marks_to_market() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        uint256 premium = traderBuy(id, 10e18);
        uint256 nav0 = pool.totalAssets();
        assertGt(nav0, 1_000_000e6, "spread realised");
        assertLt(nav0, 1_000_000e6 + premium, "liability marked");
        vm.warp(block.timestamp + 3 days);
        tick(4000e8);
        uint256 nav1 = pool.totalAssets();
        assertGt(nav1, nav0, "theta accrues to LP");
    }

    // ------------------------------------------------------------ fix round 1 (security review)

    /// C-1: deposit -> redeem ALL shares in the same block must never leave the depositor with more than they put
    /// in. Before the fix, `_liabilityWad` priced open positions at `vol.sigmaMark(util)` where `util` shrinks as
    /// live cash grows -- so a large deposit lowers the marked liability (raises NAV) right before the same-block
    /// redeem, extracting LP value. After the fix (mark at `vol.sigmaMark(0)`, no cash/netVega dependence) this
    /// must hold for any deposit size.
    function testFuzz_deposit_redeem_roundtrip_never_profits(uint256 amount) public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4000e18, true);
        for (uint256 i = 0; i < 4; i++) traderBuy(id, 50e18); // util ~= 80%
        amount = bound(amount, 1e6, 20_000_000e6);
        address attacker = makeAddr("attacker");
        usdg.mint(attacker, amount);
        vm.startPrank(attacker);
        usdg.approve(address(pool), type(uint256).max);
        uint256 shares = pool.deposit(amount, attacker);
        pool.redeem(shares, attacker, attacker);
        vm.stopPrank();
        assertLe(usdg.balanceOf(attacker), amount, "deposit->redeem round trip must not profit");
    }

    /// I-1: both directions of the FR-36 math-failure path on a second pool wired to a switchable math mock.
    /// (a) totalAssets() must degrade to the conservative NAV (never revert) when `vol`/`math` goes down.
    /// (b) deposit must revert with MathUnavailable while down (never mint at the conservative NAV); withdraw
    ///     and buy behave as specified (withdraw still works, buy reverts because quoteBuy calls math directly).
    function test_math_down_paths() public {
        MockSwitchableMath sw = new MockSwitchableMath(address(mathSol));
        EquinoxPool p2 = EquinoxPool(factory.createPool(deployParams(address(sw))));
        vm.prank(lp);
        usdg.approve(address(p2), type(uint256).max);
        vm.prank(trader);
        usdg.approve(address(p2), type(uint256).max);

        vm.prank(lp);
        p2.deposit(1_000_000e6, lp);
        uint64 expiry = uint64(T0 + WEEK);
        uint128[] memory ks = new uint128[](3);
        ks[0] = 3800e18;
        ks[1] = 4000e18;
        ks[2] = 4200e18;
        p2.createBoard(expiry, ks);
        uint256 id = p2.token().seriesId(address(p2), expiry, 4200e18, true);
        vm.prank(trader);
        p2.buy(id, 10e18, type(uint256).max);
        uint256 navFresh = p2.totalAssets();
        assertGt(navFresh, 0);

        sw.setDown(true);
        uint256 navConservative = p2.totalAssets();
        assertEq(navConservative, usdg.balanceOf(address(p2)) - 42_000e6, "conservative NAV, no revert");

        vm.expectRevert(EquinoxPool.MathUnavailable.selector);
        vm.prank(lp);
        p2.deposit(1e6, lp);

        vm.prank(lp);
        p2.withdraw(1000e6, lp, lp); // withdraw still works on the conservative NAV

        vm.expectRevert();
        vm.prank(trader);
        p2.buy(id, 1e18, type(uint256).max); // reverts (quoteBuy calls math directly, no try/catch)

        sw.setDown(false);
        uint256 navRestored = p2.totalAssets();
        assertGt(navRestored, navConservative, "MtM NAV restored once math is back");
    }

    /// I-2: fractional (non-whole-USDG) strikes are rejected at listing time.
    function test_fractional_strike_rejected() public {
        lpDeposit(1_000_000e6);
        uint128[] memory ks = new uint128[](1);
        ks[0] = uint128(4000.5e18);
        vm.expectRevert(EquinoxPool.BadStrike.selector);
        pool.createBoard(uint64(T0 + WEEK), ks);
    }

    /// I-3: admin levers are bounded (heartbeat, sequencerGrace, settleBounty) and treasury can never be zero.
    /// I-2 (final review): the heartbeat also has a 1-hour floor -- a 1-second heartbeat would make the spot
    /// permanently stale and block close/settle/claim, an admin pause by other means (FR-33).
    function test_config_bounds_and_treasury() public {
        EquinoxPool.Config memory c = deployParams(address(mathSol)).cfg;
        c.heartbeat = 2 days;
        vm.expectRevert(abi.encodeWithSelector(EquinoxPool.ConfigOutOfBounds.selector, 4));
        pool.setConfig(c);

        c = deployParams(address(mathSol)).cfg;
        c.heartbeat = 59 minutes;
        vm.expectRevert(abi.encodeWithSelector(EquinoxPool.ConfigOutOfBounds.selector, 4));
        pool.setConfig(c);

        c = deployParams(address(mathSol)).cfg;
        c.sequencerGrace = 2 days;
        vm.expectRevert(abi.encodeWithSelector(EquinoxPool.ConfigOutOfBounds.selector, 9));
        pool.setConfig(c);

        c = deployParams(address(mathSol)).cfg;
        c.settleBounty = 101e6;
        vm.expectRevert(abi.encodeWithSelector(EquinoxPool.ConfigOutOfBounds.selector, 10));
        pool.setConfig(c);

        vm.expectRevert(EquinoxPool.ZeroAddress.selector);
        pool.setTreasury(address(0));

        EquinoxPool.Deploy memory d = deployParams(address(mathSol));
        d.treasury = address(0);
        vm.expectRevert(EquinoxPool.ZeroAddress.selector);
        factory.createPool(d);
    }

    /// ITM put settlement + claim on a non-ATM strike (regression coverage alongside the ITM call scenarios).
    function test_itm_put_settle_and_claim() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 3800e18, false);
        traderBuy(id, 5e18);
        vm.warp(expiry);
        tick(3500e8);
        pool.settle(boardId);
        (, , , , , , , uint256 payoutPerUnit) = pool.series(id);
        assertEq(payoutPerUnit, 300e18);
        vm.prank(trader);
        uint256 got = pool.claim(id, 5e18);
        assertEq(got, 1500e6);
        assertEq(pool.reserved(), 0);
        assertEq(pool.escrowedPayouts(), 0);
    }

    /// quoteClose recomputed independently against the formula (mirrors test_buy_premium_matches_formula for close).
    function test_quoteClose_matches_formula() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 10e18);

        uint256 size = 5e18;
        (, , , , , uint256 oi, uint256 vegaAcc, ) = pool.series(id);
        uint256 rel = vegaAcc * size / oi;
        // R2-a: util/cap pricing uses the lagged capital reference, not live cash -- still pinned at the
        // bootstrapped 1M since no CAPITAL_REF_DELAY window has elapsed in this test.
        assertEq(pool.capitalRefPrev(), 1_000_000e18);
        uint256 capital = 1_000_000e18;
        uint256 vegaCap = capital * 500 / 10_000;
        uint256 netVegaAfter = pool.netVega() - rel;
        uint256 util = netVegaAfter * WAD / vegaCap;
        uint256 sigmaClose = vol.sigmaMark(util) * (WAD - 0.05e18) / WAD;
        uint256 t = uint256(WEEK) * WAD / 31_536_000;
        (uint256 p, , ) = mathSol.cappedCall(4000e18, 4200e18, 8400e18, t, sigmaClose, 0);
        uint256 proceeds = (p * size / WAD) / 1e12;

        (uint256 qProceeds, uint256 qSigma, ) = pool.quoteClose(id, size);
        assertEq(qProceeds, proceeds, "proceeds");
        assertEq(qSigma, sigmaClose, "sigma");
    }

    /// Settling an unknown board id reverts cleanly instead of a raw array out-of-bounds panic.
    function test_settle_unknown_board() public {
        vm.expectRevert(EquinoxPool.BoardUnknown.selector);
        pool.settle(99);
    }

    // ------------------------------------------------------------ fix round 2 (security re-review)

    /// R2-a/R3-a: deposit-dilution sandwich in the LITERAL order -- deposit huge, buy, redeem ALL shares, close --
    /// must not profit. The trader's setup uses 4x45 (not 4x50 as in test_scenario2) so that ~80k WAD of headroom
    /// remains under the 80% cap of the lagged 1M capital: enough for a 5e18/19e18 probe to fit, not enough for
    /// the 40e18 exploit-sized attempt (that leg alone proves the capital-ref lag; the assertion at the end proves
    /// R3-a's p0 clamp closes the residual "buy cheap, redeem, close expensive" sandwich the re-review found).
    function test_dilution_sandwich_cannot_profit() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 idC4000 = sid(expiry, 4000e18, true);
        for (uint256 i = 0; i < 4; i++) traderBuy(idC4000, 45e18); // reserved = 720k, headroom = 80k to the 800k cap

        uint256 idC4200 = sid(expiry, 4200e18, true);
        address attacker = makeAddr("dilutionAttacker");
        // Mints exactly 20M total (matching the literal recipe); deposits slightly under 20M, keeping a small
        // trading reserve drawn from that SAME 20M so the final "< 20_000_000e6" check compares against their
        // true total starting capital, not an inflated baseline -- the literal deposit-all-then-buy order leaves
        // zero spare cash at deposit time to pay for the buy otherwise.
        usdg.mint(attacker, 20_000_000e6);
        vm.startPrank(attacker);
        usdg.approve(address(pool), type(uint256).max);
        uint256 shares = pool.deposit(19_995_000e6, attacker);

        vm.expectRevert(EquinoxPool.UtilizationExceeded.selector);
        pool.buy(idC4200, 40e18, type(uint256).max); // capital for caps is still the lagged 1M, not diluted live cash

        pool.buy(idC4200, 5e18, type(uint256).max); // fits inside the remaining ~80k headroom
        pool.redeem(shares, attacker, attacker);
        pool.close(idC4200, 5e18, 0);
        vm.stopPrank();

        assertLt(usdg.balanceOf(attacker), 20_000_000e6, "dilution sandwich must not profit");
    }

    /// Same sandwich at the maximum size that fits the ~80k headroom (19e18 * 4200 = 79,800e18 <= 80,000e18;
    /// 20e18 would exceed it).
    function test_dilution_sandwich_max_size_cannot_profit() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 idC4000 = sid(expiry, 4000e18, true);
        for (uint256 i = 0; i < 4; i++) traderBuy(idC4000, 45e18);

        uint256 idC4200 = sid(expiry, 4200e18, true);
        address attacker = makeAddr("dilutionAttackerMax");
        // Same reasoning as test_dilution_sandwich_cannot_profit above: mint exactly 20M, deposit slightly under
        // it, keep the rest (from the same 20M) as the trading reserve for the larger 19e18 leg's premium.
        usdg.mint(attacker, 20_000_000e6);
        vm.startPrank(attacker);
        usdg.approve(address(pool), type(uint256).max);
        uint256 shares = pool.deposit(19_990_000e6, attacker);

        vm.expectRevert(EquinoxPool.UtilizationExceeded.selector);
        pool.buy(idC4200, 40e18, type(uint256).max);

        pool.buy(idC4200, 19e18, type(uint256).max); // max size that fits the remaining ~80k headroom
        pool.redeem(shares, attacker, attacker);
        pool.close(idC4200, 19e18, 0);
        vm.stopPrank();

        assertLt(usdg.balanceOf(attacker), 20_000_000e6, "dilution sandwich must not profit at max size either");
    }

    /// R2-a: the capital-ref lag is an observable two-step delay matching CAPITAL_REF_DELAY, not just a
    /// single-buy trick -- a same-block deposit never moves capitalRefPrev/pricing; it takes two aged refreshes.
    function test_capital_lag_after_delay() public {
        lpDeposit(1_000_000e6);
        assertEq(pool.capitalRefPrev(), 1_000_000e18);
        assertEq(pool.capitalRefCur(), 1_000_000e18);

        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 10e18); // nonzero netVega so sigmaMarkNow() actually depends on capital-for-caps

        uint256 sigmaBefore = pool.sigmaMarkNow();

        address lp2 = makeAddr("lp2");
        usdg.mint(lp2, 2_000_000e6);
        vm.startPrank(lp2);
        usdg.approve(address(pool), type(uint256).max);
        pool.deposit(2_000_000e6, lp2);
        vm.stopPrank();

        // Same block: the reference hasn't aged past CAPITAL_REF_DELAY -- pricing/util still see the original 1M.
        assertEq(pool.capitalRefPrev(), 1_000_000e18, "unchanged same-block as the 2M deposit");
        assertEq(pool.sigmaMarkNow(), sigmaBefore, "quote unaffected by the same-block deposit");

        vm.warp(T0 + 1 days);
        tick(4000e8); // keep the oracle fresh across the warp (unchanged price)
        // ~3M plus the trader's earlier premium, which is already sitting in pool cash by this point.
        uint256 liveBeforeDust1 = usdg.balanceOf(address(pool)) * 1e12;
        assertGt(liveBeforeDust1, 3_000_000e18, "sanity: includes the trader's premium on top of the two deposits");
        address dust1 = makeAddr("dust1");
        usdg.mint(dust1, 1e6);
        vm.startPrank(dust1);
        usdg.approve(address(pool), type(uint256).max);
        pool.deposit(1e6, dust1); // any state-changing call triggers the refresh, as its first statement
        vm.stopPrank();
        assertEq(pool.capitalRefCur(), liveBeforeDust1, "cur snapshot taken just before this call's own deposit landed");
        assertEq(pool.capitalRefPrev(), 1_000_000e18, "prev still lags one window behind");
        // (sigmaMarkNow is not compared past this point: tick()'s own poke() legitimately decays varWad each
        // window even at an unchanged price, so it's no longer isolating the capital-lag effect alone.)

        vm.warp(T0 + 2 days);
        tick(4000e8); // keep the oracle fresh across the warp (unchanged price)
        address dust2 = makeAddr("dust2");
        usdg.mint(dust2, 1e6);
        vm.startPrank(dust2);
        usdg.approve(address(pool), type(uint256).max);
        pool.deposit(1e6, dust2);
        vm.stopPrank();
        assertEq(pool.capitalRefPrev(), liveBeforeDust1, "advanced to the previous cur after the second delay + call");
    }

    /// R2-b: buy must poke the vol engine forward when a fresh round is available (PRD Section 8.4 step 3), not
    /// leave realized vol stale until someone calls poke() separately.
    function test_buy_pokes_vol_engine() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);

        uint80 roundBefore = vol.lastRoundId();
        uint256 varBefore = vol.varWad();

        feed.set(4100e8, block.timestamp + 120);
        vm.warp(block.timestamp + 120);
        traderBuy(id, 1e18);

        assertGt(vol.lastRoundId(), roundBefore, "buy pokes the vol engine to the new round");
        assertTrue(vol.varWad() != varBefore, "varWad updates from the new observation");
    }

    /// R2-c: the spread must always work against the trader (quoteClose < quoteBuy) even where the capped call's
    /// unit vega is negative (K near S/2 at high sigma) -- unconditionally using (1+spread) for buy / (1-spread)
    /// for close could invert the spread's protective direction in that regime.
    function test_spread_direction_follows_vega_sign() public {
        EquinoxPool.Deploy memory d = deployParams(address(mathSol));
        d.sigmaSeed = 2.5e18;
        EquinoxPool p2 = EquinoxPool(factory.createPool(d));
        vm.prank(lp);
        usdg.approve(address(p2), type(uint256).max);
        vm.prank(lp);
        p2.deposit(1_000_000e6, lp);

        uint64 expiry = uint64(T0 + 4 * WEEK);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 2000e18; // = S/2, where the capped-call spread's unit vega can go negative at high sigma
        p2.createBoard(expiry, ks);
        uint256 id = p2.token().seriesId(address(p2), expiry, 2000e18, true);

        uint256 t = uint256(4 * WEEK) * WAD / 31_536_000;
        uint256 sigmaNow = p2.sigmaMarkNow();
        (, , int256 vegaUnit) = mathSol.cappedCall(4000e18, 2000e18, 4000e18, t, sigmaNow, 0);
        assertLt(vegaUnit, 0, "unit vega must be negative at this K/sigma to exercise R2-c");

        EquinoxPool.QuoteOut memory qb = p2.quoteBuy(id, 1e18);
        (uint256 qcProceeds, , ) = p2.quoteClose(id, 1e18);
        assertLt(qcProceeds, qb.premiumAssets, "quoteClose < quoteBuy even with negative unit vega");

        // Sanity: the same property holds for a normal ATM series (positive vega) too.
        lpDeposit(1_000_000e6);
        (, uint64 expiryAtm, ) = listBoard7d();
        uint256 idAtm = sid(expiryAtm, 4200e18, true);
        EquinoxPool.QuoteOut memory qbAtm = pool.quoteBuy(idAtm, 1e18);
        (uint256 qcAtmProceeds, , ) = pool.quoteClose(idAtm, 1e18);
        assertLt(qcAtmProceeds, qbAtm.premiumAssets, "quoteClose < quoteBuy for a normal ATM series too");
    }

    // ------------------------------------------------------------ fix round 3 (security re-review)

    /// R3-a: no trade may cross the NAV mark (sigma0 = vol.sigmaMark(0)) -- quoteBuy >= p0 >= quoteClose always,
    /// which is what makes the deposit/redeem sandwich structurally unprofitable (every trade is NAV-non-decreasing
    /// for the pool). Also confirms the clamp is actually engaged in this state (the unclamped close sigma sits
    /// above sigma0), not vacuously true because util happened to be low.
    function test_trades_never_cross_mark() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 idC4000 = sid(expiry, 4000e18, true);
        for (uint256 i = 0; i < 4; i++) traderBuy(idC4000, 45e18); // util well above 17.5%

        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 10e18); // open position on this series so quoteClose(size) has OI to release

        uint256 size = 1e18;
        uint256 t = uint256(WEEK) * WAD / 31_536_000;
        uint256 sigma0 = vol.sigmaMark(0);
        (uint256 p0Wad, , ) = mathSol.cappedCall(4000e18, 4200e18, 8400e18, t, sigma0, 0);
        uint256 p0ProceedsFloor = p0Wad * size / WAD / 1e12;
        uint256 p0PremiumCeil = (p0Wad * size / WAD + 1e12 - 1) / 1e12;

        (uint256 qc, , ) = pool.quoteClose(id, size);
        assertLe(qc, p0ProceedsFloor, "close must never pay above the mark");

        EquinoxPool.QuoteOut memory qb = pool.quoteBuy(id, size);
        assertGe(qb.premiumAssets, p0PremiumCeil, "buy must never charge below the mark");

        // Confirm the clamp is actually engaged here: the unclamped close sigma sits above sigma0.
        (, , , , , uint256 oi, uint256 vegaAcc, ) = pool.series(id);
        uint256 rel = vegaAcc * size / oi;
        uint256 vegaCap = 1_000_000e18 * 500 / 10_000; // capital-for-caps still pinned at the bootstrapped 1M
        uint256 netVegaAfter = pool.netVega() - rel;
        uint256 utilAfter = netVegaAfter * WAD / vegaCap;
        if (utilAfter > WAD) utilAfter = WAD;
        uint256 sigmaCloseUnclamped = vol.sigmaMark(utilAfter) * (WAD - vol.spread()) / WAD;
        assertGt(sigmaCloseUnclamped, sigma0, "the price clamp must actually be engaged in this state");
    }

    /// R2-c/R3-a large-release property test (the re-reviewer's probe). A sizeable position is bought while the
    /// strike is deep ITM (K=3000, S=4000), then the spot is rallied to 6000 over two ticks >= 1 day apart (so the
    /// strike drifts to exactly S/2 -- the negative-unit-vega regime -- and the EWMA reacts, sigma_base ~1.42) and
    /// most of the position is closed. quoteClose must never exceed quoteBuy for the same size, and (after R3-a)
    /// neither may cross the sigma0 mark.
    ///
    /// Reproduction note: despite a sustained, varied effort against this exact HEAD (unit vega at K=3000/S=4000
    /// measured directly at ~1.42 WAD/unit, not the "a few hundred WAD" estimated in the ruling; tried the full
    /// 264e18 release, a 1e18 sliver, and this 200e18 majority-release, all after the same two-tick rally to
    /// sigma_base ~1.42), quoteClose stayed strictly below quoteBuy at HEAD (f7661f7) in every variant tried --
    /// the inversion the re-reviewer measured (186,872 > 186,156) was not reproduced here, most likely because it
    /// depends on exact parameters (config/feed timing/vol seed) not fully specified in the ruling. Kept as a green
    /// property test per the ruling's explicit fallback, not silently skipped.
    function test_negative_vega_large_release_no_inversion() public {
        lpDeposit(1_000_000e6);
        uint64 expiry = uint64(T0 + WEEK);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 3000e18;
        pool.createBoard(expiry, ks);
        uint256 id = sid(expiry, 3000e18, true);

        for (uint256 i = 0; i < 6; i++) traderBuy(id, 44e18); // 264e18 total, near the 800k reserve cap (264*3000=792k)

        vm.warp(T0 + 1 days);
        tick(5000e8); // rally step 1
        vol.poke(); // quoteBuy/quoteClose are view -- poke explicitly so the EWMA actually reacts to the tick
        vm.warp(T0 + 2 days);
        tick(6000e8); // rally step 2: K = 3000 becomes S/2, and the EWMA has now reacted to two big jumps
        vol.poke();

        uint256 size = 200e18; // close most of the large existing position
        (uint256 qc, , ) = pool.quoteClose(id, size);
        EquinoxPool.QuoteOut memory qb = pool.quoteBuy(id, size);
        assertLe(qc, qb.premiumAssets, "quoteClose must never exceed quoteBuy after a large release");

        // R3-a: neither side may cross the sigma0 mark either.
        uint256 t = uint256(expiry - block.timestamp) * WAD / 31_536_000;
        uint256 sigma0 = vol.sigmaMark(0);
        (uint256 p0Wad, , int256 vega0) = mathSol.cappedCall(6000e18, 3000e18, 6000e18, t, sigma0, 0);
        // Pin the regime: the unit vega at sigma0 must actually be negative here, so parameter drift (seed, VRP,
        // lambda, tick sizes) cannot silently move this test out of the negative-vega case it exists to cover.
        assertLt(vega0, 0, "unit vega at sigma0 must be negative in the tested state");
        assertLe(qc, p0Wad * size / WAD / 1e12, "close must never pay above the mark");
        assertGe(qb.premiumAssets, (p0Wad * size / WAD + 1e12 - 1) / 1e12, "buy must never charge below the mark");
    }

    /// R2-c/R3-a regression for the round-2 inversion on a tenor the 7-day scenario cannot reach: a 4-week K=3000
    /// call position sized to ~33% of the vega cap (250 units: 750k reserved < 800k util cap, booked vega ~16.6k of
    /// the 50k cap = 5% x 1M), then a single 1-day 6000 print whose EWMA spike puts sigma_mark well above 2 and the
    /// strike at exactly S/2 -- the negative-unit-vega regime with a large release on close. Must be green at HEAD:
    /// close never above buy, and neither side crosses the sigma0 mark (the buy side is actively clamped up to p0
    /// in this state: the unclamped buy price sits below the mark because util impact outweighs the -spread).
    function test_negative_vega_inversion_regression_4w() public {
        lpDeposit(1_000_000e6);
        uint64 expiry = uint64(T0 + 4 * WEEK);
        uint128[] memory ks = new uint128[](2);
        ks[0] = 3000e18;
        ks[1] = 4000e18;
        pool.createBoard(expiry, ks);
        uint256 id = sid(expiry, 3000e18, true);

        uint256 size = 250e18;
        traderBuy(id, size);
        assertGe(pool.netVega(), 15_000e18, "booked vega >= 30% of the vega cap");
        assertLe(pool.netVega(), 22_500e18, "booked vega <= 45% of the vega cap");

        vm.warp(block.timestamp + 1 days);
        tick(6000e8);
        vol.poke(); // quoteBuy/quoteClose are view -- poke explicitly so the EWMA actually reacts to the tick

        uint256 t = uint256(expiry - block.timestamp) * WAD / 31_536_000;
        uint256 sigma0 = vol.sigmaMark(0);
        assertGt(sigma0, 2e18, "EWMA spike must put sigma_mark well above 2");
        (uint256 p0Wad, , int256 vega0) = mathSol.cappedCall(6000e18, 3000e18, 6000e18, t, sigma0, 0);
        assertLt(vega0, 0, "(a) unit vega at sigma0 must be negative in this state");

        (uint256 qc, , ) = pool.quoteClose(id, size);
        EquinoxPool.QuoteOut memory qb = pool.quoteBuy(id, size);
        assertLe(qc, qb.premiumAssets, "(b) quoteClose must never exceed quoteBuy");
        assertLe(qc, p0Wad * size / WAD / 1e12, "(c) close must never pay above the mark");
        assertGe(qb.premiumAssets, (p0Wad * size / WAD + 1e12 - 1) / 1e12, "(c) buy must never charge below the mark");
    }

    // ------------------------------------------------------------ fix wave (final review)

    /// @dev Decode the `Settled(boardId, settlementPriceWad, escrowedAddedWad, reservedReleasedWad)` event of `boardId`
    ///      from recorded logs (exactly one such event must be present).
    function _settledEvent(Vm.Log[] memory logs, uint256 boardId) internal view returns (uint256 sT, uint256 added, uint256 released) {
        bytes32 sig = keccak256("Settled(uint256,uint256,uint256,uint256)");
        uint256 found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(pool) || logs[i].topics.length != 2 || logs[i].topics[0] != sig) continue;
            if (uint256(logs[i].topics[1]) != boardId) continue;
            (sT, added, released) = abi.decode(logs[i].data, (uint256, uint256, uint256));
            found++;
        }
        assertEq(found, 1, "exactly one Settled event");
    }

    /// @dev Shared state for the settle-neutrality tests: 1M LP, 7-day board, 100 C4000 + 100 P4000 open (reserved
    ///      800k = the 80% util cap), spot unchanged at expiry and a fresh round exactly at `expiry`.
    function _atmBoardAtExpiry() internal returns (uint256 boardId) {
        lpDeposit(1_000_000e6);
        uint64 expiry;
        (boardId, expiry, ) = listBoard7d();
        traderBuy(sid(expiry, 4000e18, true), 100e18);
        traderBuy(sid(expiry, 4000e18, false), 100e18);
        assertEq(pool.reserved(), 800_000e18);
        vm.warp(expiry);
        tick(4000e8);
    }

    /// I-1 (final review): series in the pre-expiry blackout / past expiry are marked at intrinsic on the current spot,
    /// so `settle` on the same round moves NAV by exactly the bounty -- no time-value jump a JIT depositor could capture.
    function test_settle_is_nav_neutral_except_bounty() public {
        uint256 boardId = _atmBoardAtExpiry();
        uint256 before = pool.totalAssets();
        pool.settle(boardId);
        (, , , , , , , , , , uint128 settleBounty) = pool.cfg();
        assertEq(pool.totalAssets(), before - settleBounty, "settle moves NAV by the bounty only");
    }

    /// I-1 (final review): deposit -> settle -> redeem-all in one block must not pay more than the bounty the attacker
    /// legitimately earned as the settler (before the fix: +213,289,492 on this exact state).
    function test_jit_settle_sandwich_cannot_profit() public {
        uint256 boardId = _atmBoardAtExpiry();
        (, , , , , , , , , , uint128 settleBounty) = pool.cfg();
        address attacker = makeAddr("jitSettler");
        usdg.mint(attacker, 20_000_000e6);
        vm.startPrank(attacker);
        usdg.approve(address(pool), type(uint256).max);
        uint256 shares = pool.deposit(20_000_000e6, attacker);
        pool.settle(boardId);
        pool.redeem(shares, attacker, attacker);
        vm.stopPrank();
        assertLe(usdg.balanceOf(attacker), 20_000_000e6 + settleBounty, "JIT settle sandwich must not profit beyond the bounty");
    }

    // ------------------------------------------------------------ access control & re-entrancy (Task 6)

    /// Every privileged entry point rejects a non-owner / non-pool / non-deployer caller with the specific error,
    /// before any of its own checks run (e.g. setTreasury(trader) fails on ownership, not on ZeroAddress).
    function test_access_control_negatives() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        bytes memory notOwner = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, trader);

        uint128[] memory ks = new uint128[](1);
        ks[0] = 4100e18;
        vm.expectRevert(notOwner);
        vm.prank(trader);
        pool.createBoard(uint64(T0 + 2 * WEEK), ks);

        vm.expectRevert(notOwner);
        vm.prank(trader);
        pool.pauseTrading(true);

        EquinoxPool.Config memory c = deployParams(address(mathSol)).cfg;
        vm.expectRevert(notOwner);
        vm.prank(trader);
        pool.setConfig(c);

        vm.expectRevert(notOwner);
        vm.prank(trader);
        pool.setTreasury(trader);

        EquinoxVolEngine.Params memory p = deployParams(address(mathSol)).vol;
        vm.expectRevert(notOwner);
        vm.prank(trader);
        vol.setParams(p);

        vm.expectRevert(EquinoxOptionToken.OnlyPool.selector);
        vm.prank(trader);
        token.mint(trader, id, 1);
        vm.expectRevert(EquinoxOptionToken.OnlyPool.selector);
        vm.prank(trader);
        token.burn(trader, id, 1);

        // bindPool: the deployer guard fires first (the token's deployer is the factory, not this test contract),
        // then the already-bound guard for the deployer itself.
        assertEq(token.deployer(), address(factory));
        vm.expectRevert(EquinoxOptionToken.OnlyDeployer.selector);
        token.bindPool(address(pool));
        vm.expectRevert(EquinoxOptionToken.AlreadyBound.selector);
        vm.prank(address(factory));
        token.bindPool(address(pool));
        assertEq(token.pool(), address(pool), "binding unchanged");
    }

    /// The ERC-1155 mint inside `buy` hands control to the receiver before `buy` returns. A receiver that re-enters
    /// close/buy/claim from onERC1155Received must be rejected by the reentrancy guard specifically (not by some
    /// accident of state such as NotSettled), and the outer buy must still complete normally.
    function test_reentrancy_buyer_blocked() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        ReentrantBuyer buyer = new ReentrantBuyer(pool);
        usdg.mint(address(buyer), 100_000e6);

        uint256 size = 1e18;
        uint256 premium = buyer.attack(id, size);
        assertGt(premium, 0, "outer buy completes");
        assertEq(token.balanceOf(address(buyer), id), size, "buyer holds exactly the outer size");
        assertEq(token.totalSupply(id), size, "no re-entrant mint/burn slipped through");

        bytes4 guard = ReentrancyGuard.ReentrancyGuardReentrantCall.selector;
        assertEq(guard, bytes4(0x3ee5aeb5));
        assertEq(buyer.closeErr(), guard, "re-entrant close rejected by the guard");
        assertEq(buyer.buyErr(), guard, "re-entrant buy rejected by the guard");
        assertEq(buyer.claimErr(), guard, "re-entrant claim rejected by the guard");
    }
}

/// @notice Helper test_reentrancy_buyer_blocked: pembeli yang mencoba masuk kembali ke pool dari hook ERC-1155 saat
///         `buy` mencetak token. Setiap percobaan dibungkus try/catch sendiri dan selector error-nya dicatat
///         (bytes4(0) bila panggilan justru sukses), lalu hook mengembalikan selector agar buy luar selesai.
contract ReentrantBuyer is IERC1155Receiver {
    EquinoxPool public immutable pool;
    uint256 public id;
    uint256 public size;
    bytes4 public closeErr;
    bytes4 public buyErr;
    bytes4 public claimErr;

    constructor(EquinoxPool pool_) {
        pool = pool_;
        IERC20(pool_.asset()).approve(address(pool_), type(uint256).max);
    }

    function attack(uint256 id_, uint256 size_) external returns (uint256) {
        id = id_;
        size = size_;
        return pool.buy(id_, size_, type(uint256).max);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        try pool.close(id, size, 0) {
            closeErr = bytes4(0);
        } catch (bytes memory err) {
            closeErr = bytes4(err);
        }
        try pool.buy(id, size, type(uint256).max) {
            buyErr = bytes4(0);
        } catch (bytes memory err) {
            buyErr = bytes4(err);
        }
        try pool.claim(id, size) {
            claimErr = bytes4(0);
        } catch (bytes memory err) {
            claimErr = bytes4(err);
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
