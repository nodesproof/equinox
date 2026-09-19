// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { EquinoxVolEngine } from "../src/pool/EquinoxVolEngine.sol";
import { BlackScholesSol } from "../src/math/BlackScholesSol.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";
import { VectorsGen } from "./VectorsGen.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Skenario 10 (§6.4 direproduksi bit-eksak lewat vektor EWMA), FR-12, FR-13, FR-15. Berdiri sendiri (tanpa pool).
contract EquinoxVolEngineTest is Test {
    uint256 constant T0 = 1_789_718_400;
    MockFeed feed;
    EquinoxVolEngine vol;
    address trader = makeAddr("trader");

    function setUp() public {
        vm.warp(T0);
        feed = new MockFeed(8);
        feed.set(4000e8, T0);
        BlackScholesSol math = new BlackScholesSol();
        vol = new EquinoxVolEngine(address(this), address(feed), address(math),
            EquinoxVolEngine.Params(0.94e18, 1.15e18, 0.3e18, 0.05e18, 0.2e18, 3e18), 0.55e18);
    }

    function test_seed_state() public view {
        assertEq(vol.varWad(), 0.55e18 * 0.55e18 / 1e18);
        assertEq(vol.lastPrice(), 4000e18);
        assertEq(vol.lastTs(), T0);
        assertEq(vol.sigmaBase(), 0.55e18);
    }

    /// Urutan §6.4: (4020, +0,25 h) (3960, +0,25 h) (4100, +0,5 h) (4080, +0,5 h) (3900, +0,5 h) — var harus == vektor.
    function test_poke_matches_ewma_vectors() public {
        (int256[] memory vp, int256[] memory p0, int256[] memory p1, int256[] memory dt, , int256[] memory vn) = VectorsGen.ewmaV();
        for (uint256 i = 0; i < vp.length; i++) {
            assertEq(int256(vol.varWad()), vp[i], "varPrev");
            assertEq(int256(vol.lastPrice()), p0[i], "pPrev");
            uint256 ts = vol.lastTs() + uint256(dt[i]);
            vm.warp(ts);
            feed.set(p1[i] / 1e10, ts); // vektor dalam WAD; feed 8 desimal
            vol.poke();
            assertEq(int256(vol.varWad()), vn[i], "varNew");
        }
        // 58,60% pada akhir urutan (§6.4)
        assertApproxEqRel(vol.sigmaBase(), 0.586e18, 0.002e18);
    }

    function test_poke_ignores_old_round_and_short_interval() public {
        uint256 v0 = vol.varWad();
        vol.poke(); // round sama
        assertEq(vol.varWad(), v0);
        vm.warp(T0 + 30);
        feed.set(4100e8, T0 + 30); // round baru tapi dt < 60 s
        vol.poke();
        assertEq(vol.varWad(), v0);
        assertEq(vol.lastRoundId(), 1);
        vm.warp(T0 + 120);
        feed.set(4100e8, T0 + 120);
        vol.poke();
        assertGt(vol.varWad(), v0);
        assertEq(vol.lastRoundId(), 3);
    }

    function test_sigmaMark_formula_and_clamp() public view {
        // σ_mark(0) = σ_base × VRP
        assertEq(vol.sigmaMark(0), 0.55e18 * 1.15e18 / 1e18);
        // util 1 → × (1 + α)
        assertEq(vol.sigmaMark(1e18), 0.55e18 * 1.15e18 / 1e18 * 1.3e18 / 1e18);
        // util > 1 di-clamp ke 1
        assertEq(vol.sigmaMark(5e18), vol.sigmaMark(1e18));
    }

    /// M-1 (final review, PRD §6.4 / FR-15): σ_mark clamps σ_base FIRST, then applies VRP × (1 + α·util) and clamps
    /// the product -- so a seed below σ_min marks at σ_min × VRP (0.20 × 1.15 = 0.23), not at a bare σ_min.
    function test_sigmaMark_clamps_sigmaBase_before_vrp() public {
        BlackScholesSol math2 = new BlackScholesSol();
        EquinoxVolEngine low = new EquinoxVolEngine(address(this), address(feed), address(math2),
            EquinoxVolEngine.Params(0.94e18, 1.15e18, 0.3e18, 0.05e18, 0.2e18, 3e18), 0.10e18);
        assertEq(low.sigmaBase(), 0.20e18, "sigma_base clamped to sigma_min");
        assertEq(low.sigmaMark(0), 0.20e18 * 1.15e18 / 1e18, "sigma_mark(0) = sigma_min x VRP = 0.23");
        assertEq(low.sigmaMark(0), low.sigmaBase() * 1.15e18 / 1e18, "sigmaBase() x vrp == sigmaMark(0) when in bounds");
        // the un-clamped engine (seed 0.55) is unaffected: sigmaMark(0) == sigmaBase() x VRP as before
        assertEq(vol.sigmaMark(0), vol.sigmaBase() * 1.15e18 / 1e18);
    }

    /// M-4 (final review): a future-dated round (updatedAt > block.timestamp) is ignored by poke, symmetric with
    /// OracleLib.read -- no observation, varWad/lastTs/lastRoundId unchanged.
    function test_poke_skips_future_round() public {
        uint256 v0 = vol.varWad();
        feed.set(4100e8, T0 + 1000); // round baru, tetapi updatedAt di masa depan
        vol.poke();
        assertEq(vol.varWad(), v0, "varWad unchanged");
        assertEq(vol.lastTs(), T0, "lastTs unchanged");
        assertEq(vol.lastRoundId(), 1, "round not consumed");
        vm.warp(T0 + 1000); // once the chain reaches updatedAt the same round is a normal observation
        vol.poke();
        assertGt(vol.varWad(), v0);
        assertEq(vol.lastRoundId(), 2);
    }

    function test_sigmaBase_clamped_to_bounds() public {
        // harga meledak → realized vol > σ_max → clamp 300%
        vm.warp(T0 + 3600);
        feed.set(8000e8, T0 + 3600);
        vol.poke();
        assertEq(vol.sigmaBase(), 3e18);
    }

    function test_setParams_bounds_and_rate_limit() public {
        EquinoxVolEngine.Params memory p = EquinoxVolEngine.Params(0.94e18, 1.15e18, 0.3e18, 0.05e18, 0.2e18, 3e18);
        vm.expectRevert(EquinoxVolEngine.ParamsRateLimited.selector);
        vol.setParams(p);
        vm.warp(T0 + 6 hours);
        p.vrp = 1.5e18; // +30% > 20%
        vm.expectRevert(abi.encodeWithSelector(EquinoxVolEngine.ParamDeltaTooLarge.selector, uint8(1)));
        vol.setParams(p);
        p.vrp = 1.3e18; // +13%
        p.alpha = 0.45e18; // +0,15 absolut ≤ 0,2
        vol.setParams(p);
        (, uint64 vrp, uint64 alpha, , , ) = vol.params();
        assertEq(vrp, 1.3e18);
        assertEq(alpha, 0.45e18);
        p.sigmaMax = 6e18; // > 500%
        vm.warp(T0 + 12 hours);
        vm.expectRevert(abi.encodeWithSelector(EquinoxVolEngine.ParamOutOfBounds.selector, uint8(5)));
        vol.setParams(p);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, trader));
        vol.setParams(p);
    }

    /// R3-b: sigmaMax*(1+spread) must stay within the math domain's SIGMA_MAX (5e18), or EquinoxPool's
    /// vega-sign-aware spread could price a close at an out-of-domain sigma. Constructor-level (not setParams,
    /// so the 6h rate limit doesn't get in the way).
    function test_sigmaMax_bounded_by_spread_headroom() public {
        BlackScholesSol math2 = new BlackScholesSol();
        EquinoxVolEngine.Params memory tooHigh = EquinoxVolEngine.Params(0.94e18, 1.15e18, 0.3e18, 0.05e18, 0.2e18, 4.8e18);
        vm.expectRevert(abi.encodeWithSelector(EquinoxVolEngine.ParamOutOfBounds.selector, uint8(5)));
        new EquinoxVolEngine(address(this), address(feed), address(math2), tooHigh, 0.55e18);

        EquinoxVolEngine.Params memory ok = EquinoxVolEngine.Params(0.94e18, 1.15e18, 0.3e18, 0.05e18, 0.2e18, 4.7e18);
        EquinoxVolEngine vol2 = new EquinoxVolEngine(address(this), address(feed), address(math2), ok, 0.55e18);
        assertEq(address(vol2.feed()), address(feed));
    }
}
