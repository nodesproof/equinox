// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EquinoxPool } from "../pool/EquinoxPool.sol";
import { EquinoxFactory } from "../pool/EquinoxFactory.sol";
import { EquinoxVolEngine } from "../pool/EquinoxVolEngine.sol";
import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";
import { MockUSDG } from "./MockUSDG.sol";
import { MockFeed } from "./MockFeed.sol";
import { MockSequencerFeed } from "./MockSequencerFeed.sol";

/// @title PoolE2EDeployer — satu `forge create` men-deploy mock + factory + dua pool identik (A = kontrol, B = Stylus).
/// @notice Dipakai tools/e2e/pool-e2e.sh (devnode: feed mock, dua engine) dan tools/sepolia/deploy-pools.sh (Sepolia: feed
///         Chainlink asli, engine bersama — K4). Tidak ada panggilan ke `math` di jalur deploy, sehingga simulasi Foundry
///         tidak menyentuh WASM (Foundry tidak bisa mengeksekusi program Stylus, §9.7).
contract PoolE2EDeployer {
    error NotMockFeed();

    MockUSDG public immutable usdg;
    IAggregatorV3 public immutable feed;   // mock (devnode) atau eksternal (Chainlink)
    MockFeed public immutable mockFeed;    // address(0) bila feed eksternal
    MockSequencerFeed public immutable seq;
    EquinoxFactory public immutable factory;
    EquinoxPool public immutable poolA;
    EquinoxPool public immutable poolB;
    bool public immutable sharedVol;

    /// @param feed_ address(0) → deploy MockFeed(8) dengan round 4000e8 "sekarang"; selain itu dipakai apa adanya (tanpa `set`).
    /// @param sharedVol_ true → Pool A memakai engine Pool B (`createPoolWithVol`); false → dua engine (`createPool` ×2).
    constructor(address owner, address mathA, address mathB, address feed_, bool sharedVol_) {
        usdg = new MockUSDG();
        MockFeed m = MockFeed(address(0));
        IAggregatorV3 f = IAggregatorV3(feed_);
        if (feed_ == address(0)) {
            m = new MockFeed(8);
            m.set(4000e8, block.timestamp);
            f = IAggregatorV3(address(m));
        }
        mockFeed = m;
        feed = f;
        seq = new MockSequencerFeed();
        seq.set(0, block.timestamp - 2 hours);
        factory = new EquinoxFactory();
        sharedVol = sharedVol_;
        // Pool B dulu: engine-nya (math Stylus di chain sungguhan) menjadi engine bersama bila sharedVol.
        EquinoxPool b = EquinoxPool(factory.createPool(_params(owner, mathB, address(f), "Equinox LP (Stylus)", "eqB")));
        EquinoxPool.Deploy memory pa = _params(owner, mathA, address(f), "Equinox LP (control)", "eqA");
        EquinoxPool a = sharedVol_
            ? EquinoxPool(factory.createPoolWithVol(pa, address(b.vol())))
            : EquinoxPool(factory.createPool(pa));
        poolA = a;
        poolB = b;
        usdg.mint(owner, 4_000_000e6);
    }

    /// @notice Round baru "sekarang" pada feed mock (harga 8 desimal) — hanya untuk devnode/demo lokal.
    function tick(int256 price8) external {
        if (address(mockFeed) == address(0)) revert NotMockFeed();
        mockFeed.set(price8, block.timestamp);
    }

    /// @notice Expiry grid berikutnya (Jumat 08:00 UTC) yang ≥ now + minTenor.
    function nextExpiry(uint256 minTenor) external view returns (uint64) {
        return uint64(((block.timestamp + minTenor - 115_200) / 604_800 + 1) * 604_800 + 115_200);
    }

    function _params(address owner, address math, address feed_, string memory name, string memory symbol) internal view returns (EquinoxPool.Deploy memory d) {
        d.owner = owner;
        d.usdg = address(usdg);
        d.feed = feed_;
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
