// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PoolFixture } from "./PoolFixture.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { IBlackScholes } from "../src/interfaces/IBlackScholes.sol";
import { MockSwitchableMath } from "../src/mocks/MockSwitchableMath.sol";

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
        vm.prank(keeper);
        pool.settle(boardId);
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
        pool.settle(boardId);
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
    function test_config_bounds_and_treasury() public {
        EquinoxPool.Config memory c = deployParams(address(mathSol)).cfg;
        c.heartbeat = 2 days;
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

    /// R2-a: deposit-dilution sandwich (deposit huge -> buy/close at diluted util -> redeem) must not profit, and
    /// the live-capital util/cap bypass at buy time must be closed by the capital-ref lag. The trader's setup uses
    /// 4x45 (not 4x50 as in test_scenario2) so that ~80k WAD of headroom remains under the 80% cap of the lagged
    /// 1M capital: enough for the attacker's 5e18 probe to fit, not enough for the 40e18 exploit-sized attempt.
    function test_dilution_sandwich_cannot_profit() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 idC4000 = sid(expiry, 4000e18, true);
        for (uint256 i = 0; i < 4; i++) traderBuy(idC4000, 45e18); // reserved = 720k, headroom = 80k to the 800k cap

        uint256 idC4200 = sid(expiry, 4200e18, true);
        address attacker = makeAddr("dilutionAttacker");
        usdg.mint(attacker, 20_000_000e6);
        vm.startPrank(attacker);
        usdg.approve(address(pool), type(uint256).max);
        uint256 shares = pool.deposit(20_000_000e6, attacker);

        vm.expectRevert(EquinoxPool.UtilizationExceeded.selector);
        pool.buy(idC4200, 40e18, type(uint256).max); // capital for caps is still the lagged 1M, not diluted live cash

        // Undilute first: redeem all LP shares before trading the option, so the small trade's spread-profit
        // accrues to the (now sole) original LP rather than being partly recaptured by the attacker's own
        // redeem -- isolating the R2-a property (mispriced buy/close via util manipulation) from that unrelated
        // large-depositor-owns-most-of-the-NAV effect. capitalForCaps was pinned at 1M throughout regardless
        // (min(live, capitalRefPrev), and capitalRefPrev never ages within this single block either way).
        pool.redeem(shares, attacker, attacker);
        pool.buy(idC4200, 5e18, type(uint256).max); // fits inside the remaining ~80k headroom, paid from redeemed cash
        pool.close(idC4200, 5e18, 0);
        vm.stopPrank();

        assertLt(usdg.balanceOf(attacker), 20_000_000e6, "dilution sandwich must not profit");
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
}
