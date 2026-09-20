// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console2 } from "forge-std/console2.sol";
import { PoolFixture } from "./PoolFixture.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";

/// @notice Narasi §13 (deterministik, Pool kontrol): LP deposit → beli 10 C 4.200 → beli P 2.600 (floor) → warp 7 hari →
///         feed 4.500 → settle → claim → NAV LP. Dicetak sebagai tabel untuk video; angka harus cocok dengan §6.7 & skenario 1.
///         Jalankan: forge test --match-contract NarrativeTest -vv
contract NarrativeTest is PoolFixture {
    function _usd(uint256 assets6) internal pure returns (string memory) {
        uint256 w = assets6 / 1e6; uint256 f = assets6 % 1e6;
        bytes memory fs = bytes(vm.toString(f + 1e6)); // padding 6 digit
        bytes memory out = new bytes(6);
        for (uint256 i = 0; i < 6; i++) out[i] = fs[i + 1];
        return string(abi.encodePacked(vm.toString(w), ".", out));
    }

    /// @dev nilai 18 dp (WAD) dicetak dengan 4 desimal, dibulatkan ke terdekat — mis. sigma 0.6325
    function _wad(uint256 wad) internal pure returns (string memory) {
        uint256 r = (wad + 5e13) / 1e14;
        uint256 w = r / 1e4; uint256 f = r % 1e4;
        bytes memory fs = bytes(vm.toString(f + 1e4)); // padding 4 digit
        bytes memory out = new bytes(4);
        for (uint256 i = 0; i < 4; i++) out[i] = fs[i + 1];
        return string(abi.encodePacked(vm.toString(w), ".", out));
    }

    function test_narrative_scenario1_prints_table() public {
        console2.log("| Langkah | Nilai |");
        console2.log("|---|---|");
        uint256 shares = lpDeposit(1_000_000e6);
        console2.log("| LP deposit | 1,000,000.000000 USDG -> %s share |", vm.toString(shares));
        uint64 expiry = uint64(T0 + WEEK);
        uint128[] memory ks = new uint128[](4);
        ks[0] = 2600e18; ks[1] = 3800e18; ks[2] = 4000e18; ks[3] = 4200e18;
        uint256 boardId = pool.createBoard(expiry, ks);
        uint256 idC = sid(expiry, 4200e18, true);
        uint256 idP = sid(expiry, 2600e18, false);
        // mid pada sigma_mark(0) = 0.55 x 1.15 = 0.6325 (§6.7: 64.87 USDG/unit)
        uint256 t = uint256(expiry - block.timestamp) * 1e18 / 31_536_000;
        (uint256 midWad, , ) = mathSol.cappedCall(4000e18, 4200e18, 8400e18, t, vol.sigmaMark(0), 0);
        uint256 mid6 = (midWad + 1e12 - 1) / 1e12;
        assertApproxEqAbs(mid6, 64_870_000, 20_000, "mid C4200 7d @ 63.25% = 64.87");
        EquinoxPool.QuoteOut memory q = pool.quoteBuy(idC, 10e18);
        console2.log("| sigma_mark(0) | %s (0.55 x VRP 1.15) |", _wad(vol.sigmaMark(0)));
        console2.log("| mid C4200 7d per unit | %s USDG |", _usd(mid6));
        console2.log("| quoteBuy 10 C4200 | premi %s USDG @ sigma_buy %s, fee %s |", _usd(q.premiumAssets), _wad(q.sigma), _usd(q.feeAssets));
        assertGt(q.premiumAssets, mid6 * 10, "harga beli > mid (spread + dampak inventaris)");
        uint256 premC = traderBuy(idC, 10e18);
        EquinoxPool.QuoteOut memory qp = pool.quoteBuy(idP, 1e18);
        uint256 floor6 = uint256(2600e18) * 5 / 10_000 / 1e12;
        assertEq(qp.premiumAssets, floor6, "P2600 deep-OTM: floor 5 bps x K menang");
        console2.log("| quoteBuy 1 P2600 | premi %s USDG = floor 5 bps x K (mid < floor) |", _usd(qp.premiumAssets));
        uint256 premP = traderBuy(idP, 1e18);
        console2.log("| reserved setelah beli | %s USDG (10 x 4200 + 1 x 2600) |", _usd(pool.reserved() / 1e12));
        console2.log("| NAV setelah beli | %s USDG |", _usd(pool.totalAssets()));
        vm.warp(expiry);
        tick(4500e8);
        address keeper = makeAddr("keeper");
        vm.prank(keeper);
        pool.settle(boardId);
        console2.log("| settle @ S_T = 4500 | payout C4200 = 300/unit, P2600 = 0; bounty 2 USDG ke keeper |");
        vm.prank(trader);
        uint256 got = pool.claim(idC, 10e18);
        assertEq(got, 3000e6);
        console2.log("| claim 10 C4200 | %s USDG |", _usd(got));
        uint256 nav = pool.totalAssets();
        assertEq(nav, 1_000_000e6 + premC + premP - 3000e6 - 2e6, "NAV LP = 1,000,000 + premi - 3,000 - bounty");
        console2.log("| NAV LP akhir | %s USDG (= 1,000,000 + premi %s + %s - 3,000 - 2) |", _usd(nav), _usd(premC), _usd(premP));
        console2.log("| fee ke treasury (tidak masuk NAV) | %s USDG |", _usd(usdg.balanceOf(treasury)));
    }
}
