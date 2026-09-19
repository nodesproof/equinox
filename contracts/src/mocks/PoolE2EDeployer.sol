// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EquinoxPool } from "../pool/EquinoxPool.sol";
import { EquinoxFactory } from "../pool/EquinoxFactory.sol";
import { EquinoxVolEngine } from "../pool/EquinoxVolEngine.sol";
import { MockUSDG } from "./MockUSDG.sol";
import { MockFeed } from "./MockFeed.sol";
import { MockSequencerFeed } from "./MockSequencerFeed.sol";

/// @title PoolE2EDeployer — satu `forge create` men-deploy mock + factory + dua pool identik (A = kontrol, B = Stylus).
/// @notice Dipakai tools/e2e/pool-e2e.sh di chain sungguhan (devnode/Sepolia). Tidak ada panggilan ke `math` di jalur deploy,
///         sehingga simulasi Foundry tidak menyentuh WASM (Foundry tidak bisa mengeksekusi program Stylus, §9.7).
contract PoolE2EDeployer {
    MockUSDG public immutable usdg;
    MockFeed public immutable feed;
    MockSequencerFeed public immutable seq;
    EquinoxFactory public immutable factory;
    EquinoxPool public immutable poolA;
    EquinoxPool public immutable poolB;

    constructor(address owner, address mathA, address mathB) {
        usdg = new MockUSDG();
        feed = new MockFeed(8);
        seq = new MockSequencerFeed();
        feed.set(4000e8, block.timestamp);
        seq.set(0, block.timestamp - 2 hours);
        factory = new EquinoxFactory();
        poolA = EquinoxPool(factory.createPool(_params(owner, mathA, "Equinox LP (control)", "eqA")));
        poolB = EquinoxPool(factory.createPool(_params(owner, mathB, "Equinox LP (Stylus)", "eqB")));
        usdg.mint(owner, 4_000_000e6);
    }

    /// @notice Round Chainlink baru "sekarang" (harga 8 desimal) — untuk demo/keeper.
    function tick(int256 price8) external {
        feed.set(price8, block.timestamp);
    }

    /// @notice Expiry grid berikutnya (Jumat 08:00 UTC) yang ≥ now + minTenor.
    function nextExpiry(uint256 minTenor) external view returns (uint64) {
        return uint64(((block.timestamp + minTenor - 115_200) / 604_800 + 1) * 604_800 + 115_200);
    }

    function _params(address owner, address math, string memory name, string memory symbol) internal view returns (EquinoxPool.Deploy memory d) {
        d.owner = owner;
        d.usdg = address(usdg);
        d.feed = address(feed);
        d.sequencerFeed = address(seq);
        d.math = math;
        d.treasury = owner;
        d.cfg = EquinoxPool.Config({ feeBps: 300, maxUtilBps: 8000, vegaCapBps: 500, minPremiumBps: 5, heartbeat: 3600, staleMult: 3, sequencerGrace: 3600, maxOpenSeries: 32, tenorMax: 30 days, minSize: 1e16, settleBounty: 2e6 });
        d.vol = EquinoxVolEngine.Params({ lambdaPerDay: 0.94e18, vrp: 1.15e18, alpha: 0.3e18, spread: 0.05e18, sigmaMin: 0.2e18, sigmaMax: 3e18 });
        d.sigmaSeed = 0.55e18;
        d.rWad = 0;
        d.name = name;
        d.symbol = symbol;
    }
}
