// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { BlackScholesSol } from "../src/math/BlackScholesSol.sol";
import { IBlackScholes } from "../src/interfaces/IBlackScholes.sol";
import { VectorsGen } from "./VectorsGen.sol";

/// L3: kontrol Solidity harus BIT-IDENTIK dengan vektor (emulasi Python == crate Rust).
contract BlackScholesSolTest is Test {
    IBlackScholes bs;

    function setUp() public { bs = IBlackScholes(address(new BlackScholesSol())); }

    function test_exp_bit_exact() public view {
        (int256[] memory x, int256[] memory y) = VectorsGen.expV();
        for (uint256 i = 0; i < x.length; i++) assertEq(int256(bs.exp(x[i])), y[i], "exp");
    }
    function test_ln_bit_exact() public view {
        (int256[] memory x, int256[] memory y) = VectorsGen.lnV();
        for (uint256 i = 0; i < x.length; i++) assertEq(bs.ln(uint256(x[i])), y[i], "ln");
    }
    function test_sqrt_bit_exact() public view {
        (uint256[] memory x, uint256[] memory y) = VectorsGen.sqrtV();
        for (uint256 i = 0; i < x.length; i++) assertEq(bs.sqrt(x[i]), y[i], "sqrt");
    }
    function test_phi_bit_exact() public view {
        (int256[] memory x, int256[] memory y) = VectorsGen.phiV();
        for (uint256 i = 0; i < x.length; i++) assertEq(int256(bs.normCdf(x[i])), y[i], "phi");
    }
    function test_quote_bit_exact() public view {
        (int256[] memory s, int256[] memory k, int256[] memory t, int256[] memory sg, int256[] memory r,
         bool[] memory c, int256[] memory p, int256[] memory d, int256[] memory g, int256[] memory v, int256[] memory th) = VectorsGen.quoteV();
        for (uint256 i = 0; i < s.length; i++) {
            (uint256 price, int256 delta, uint256 gamma, uint256 vega, int256 theta) = bs.quote(uint256(s[i]), uint256(k[i]), uint256(t[i]), uint256(sg[i]), r[i], c[i]);
            assertEq(int256(price), p[i], "price");
            assertEq(delta, d[i], "delta");
            assertEq(int256(gamma), g[i], "gamma");
            assertEq(int256(vega), v[i], "vega");
            assertEq(theta, th[i], "theta");
        }
    }
    function test_capped_bit_exact() public view {
        (int256[] memory s, int256[] memory k, int256[] memory cap, int256[] memory t, int256[] memory sg, int256[] memory r,
         int256[] memory p, int256[] memory d, int256[] memory v) = VectorsGen.cappedV();
        for (uint256 i = 0; i < s.length; i++) {
            (uint256 price, int256 delta, int256 vega) = bs.cappedCall(uint256(s[i]), uint256(k[i]), uint256(cap[i]), uint256(t[i]), uint256(sg[i]), r[i]);
            assertEq(int256(price), p[i], "price");
            assertEq(delta, d[i], "delta");
            assertEq(vega, v[i], "vega");
        }
    }
    function test_ewma_bit_exact() public view {
        (int256[] memory vp, int256[] memory p0, int256[] memory p1, int256[] memory dt, int256[] memory lam, int256[] memory vn) = VectorsGen.ewmaV();
        for (uint256 i = 0; i < vp.length; i++) {
            assertEq(int256(bs.ewmaUpdate(uint256(vp[i]), uint256(p0[i]), uint256(p1[i]), uint256(dt[i]), uint256(lam[i]))), vn[i], "ewma");
        }
    }
    function test_portfolio_bit_exact() public view {
        for (uint256 c = 0; c < VectorsGen.PORTFOLIO_CASES; c++) {
            (int256[] memory k, int256[] memory t, bool[] memory isCall, int256[] memory oi,
             int256 s, int256 r, int256 sigma, int256 capMult, int256 sumMid, int256 sumVega) = VectorsGen.portfolioV(c);
            (uint256 mid, int256 vega) = bs.markPortfolio(uint256(s), r, uint256(sigma), uint256(capMult), _u(k), _u(t), isCall, _u(oi));
            assertEq(int256(mid), sumMid, "sumMid");
            assertEq(vega, sumVega, "sumVega");
        }
    }
    function _u(int256[] memory a) internal pure returns (uint256[] memory b) {
        b = new uint256[](a.length);
        for (uint256 i = 0; i < a.length; i++) b[i] = uint256(a[i]);
    }
    function test_ewma_dt_overflow_reverts() public {
        // dt·1e18 melampaui int256: harus revert dengan error bertipe Overflow() (paritas selector dengan Rust), bukan Panic(0x11).
        uint256 dt = uint256(type(int256).max) / 1e18 + 1;
        vm.expectRevert(IBlackScholes.Overflow.selector);
        bs.ewmaUpdate(0.3025e18, 4000e18, 4020e18, dt, 0.94e18);
    }
    function test_parity_and_bounds() public view {
        uint256 s = 4000e18; uint256 k = 4200e18; uint256 t = uint256(7e18) / 365; uint256 sg = 0.6e18;
        uint256 c = bs.price(s, k, t, sg, 0, true);
        uint256 p = bs.price(s, k, t, sg, 0, false);
        assertLe(c, s); assertLe(p, k);
        assertApproxEqAbs(int256(c) - int256(p), int256(s) - int256(k), 4e9, "parity"); // 1e-9·S
    }
    function test_implied_vol_recovers_sigma() public view {
        uint256 s = 4000e18; uint256 t = uint256(7e18) / 365;
        uint256[3] memory ks = [uint256(4200e18), 3000e18, 2600e18];
        bool[3] memory cs = [true, false, false];
        for (uint256 i = 0; i < 3; i++) {
            uint256 target = bs.price(s, ks[i], t, 0.6e18, 0, cs[i]);
            (uint256 sg, uint8 it) = bs.impliedVol(target, s, ks[i], t, 0, cs[i], 0.01e18, 5e18);
            assertApproxEqRel(sg, 0.6e18, 1e9, "iv"); // ≤ 1e-9 relatif
            assertLe(it, 40);
        }
    }
    function test_domain_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IBlackScholes.OutOfDomain.selector, uint8(3)));
        bs.quote(4000e18, 4200e18, uint256(7e18) / 365, 6e18, 0, true);
        vm.expectRevert(abi.encodeWithSelector(IBlackScholes.OutOfDomain.selector, uint8(0)));
        bs.ln(0);
    }
}
