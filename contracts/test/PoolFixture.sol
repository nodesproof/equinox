// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { BlackScholesSol } from "../src/math/BlackScholesSol.sol";
import { IBlackScholes } from "../src/interfaces/IBlackScholes.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { EquinoxFactory } from "../src/pool/EquinoxFactory.sol";
import { EquinoxOptionToken } from "../src/pool/EquinoxOptionToken.sol";
import { EquinoxVolEngine } from "../src/pool/EquinoxVolEngine.sol";
import { MockUSDG } from "../src/mocks/MockUSDG.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";
import { MockSequencerFeed } from "../src/mocks/MockSequencerFeed.sol";

/// @notice Fixture bersama: pool dengan kontrol Solidity sebagai `math` (L3 tanpa node Stylus), parameter §6.8.
abstract contract PoolFixture is Test {
    uint256 internal constant WAD = 1e18;
    /// 2026-09-18 08:00:00 UTC — sebuah Jumat 08:00 (grid expiry), 115200 + 2959·604800.
    uint256 internal constant T0 = 1_789_718_400;
    uint256 internal constant WEEK = 604_800;

    MockUSDG internal usdg;
    MockFeed internal feed;
    MockSequencerFeed internal seq;
    BlackScholesSol internal mathSol;
    EquinoxFactory internal factory;
    EquinoxPool internal pool;
    EquinoxOptionToken internal token;
    EquinoxVolEngine internal vol;

    address internal lp = makeAddr("lp");
    address internal trader = makeAddr("trader");
    address internal treasury = makeAddr("treasury");

    function setUp() public virtual {
        vm.warp(T0);
        usdg = new MockUSDG();
        feed = new MockFeed(8);
        seq = new MockSequencerFeed();
        feed.set(4000e8, T0);
        seq.set(0, T0 - 2 hours);
        mathSol = new BlackScholesSol();
        factory = new EquinoxFactory();
        pool = EquinoxPool(factory.createPool(deployParams(address(mathSol))));
        token = pool.token();
        vol = pool.vol();
        usdg.mint(lp, 10_000_000e6);
        usdg.mint(trader, 10_000_000e6);
        vm.prank(lp);
        usdg.approve(address(pool), type(uint256).max);
        vm.prank(trader);
        usdg.approve(address(pool), type(uint256).max);
    }

    function deployParams(address math_) internal view returns (EquinoxPool.Deploy memory d) {
        d.owner = address(this);
        d.usdg = address(usdg);
        d.feed = address(feed);
        d.sequencerFeed = address(seq);
        d.math = math_;
        d.treasury = treasury;
        d.cfg = EquinoxPool.Config({
            feeBps: 300,
            maxUtilBps: 8000,
            vegaCapBps: 500,
            minPremiumBps: 5,
            heartbeat: 3600,
            staleMult: 3,
            sequencerGrace: 3600,
            maxOpenSeries: 32,
            tenorMax: 30 days,
            minSize: 1e16,
            settleBounty: 2e6
        });
        d.vol = EquinoxVolEngine.Params({
            lambdaPerDay: 0.94e18,
            vrp: 1.15e18,
            alpha: 0.3e18,
            spread: 0.05e18,
            sigmaMin: 0.2e18,
            sigmaMax: 3e18
        });
        d.sigmaSeed = 0.55e18;
        d.rWad = 0;
        d.name = "Equinox ETH/USDG LP";
        d.symbol = "eqETH";
    }

    /// @dev Board 7 hari dengan strike 3800 / 4000 / 4200 (call+put masing-masing → 6 seri).
    function listBoard7d() internal returns (uint256 boardId, uint64 expiry, uint256[] memory ids) {
        expiry = uint64(T0 + WEEK);
        uint128[] memory ks = new uint128[](3);
        ks[0] = 3800e18;
        ks[1] = 4000e18;
        ks[2] = 4200e18;
        boardId = pool.createBoard(expiry, ks);
        (, , , ids) = pool.board(boardId);
    }

    function sid(uint64 expiry, uint128 strike, bool isCall) internal view returns (uint256) {
        return token.seriesId(address(pool), expiry, strike, isCall);
    }

    function lpDeposit(uint256 assets) internal returns (uint256 shares) {
        vm.prank(lp);
        shares = pool.deposit(assets, lp);
    }

    function traderBuy(uint256 id, uint256 size) internal returns (uint256 premium) {
        vm.prank(trader);
        premium = pool.buy(id, size, type(uint256).max);
    }

    /// @dev Round Chainlink baru "sekarang" dengan harga tertentu (8 desimal).
    function tick(int256 price8) internal {
        feed.set(price8, block.timestamp);
    }
}
