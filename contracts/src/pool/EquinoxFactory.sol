// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EquinoxPool } from "./EquinoxPool.sol";
import { EquinoxOptionToken } from "./EquinoxOptionToken.sol";
import { EquinoxVolEngine } from "./EquinoxVolEngine.sol";

/// @title PoolDeployer — hanya `new EquinoxPool`. Dipisah agar initcode pool (~18 KB) tidak menumpuk di runtime factory (batas 24 KB).
contract PoolDeployer {
    address public immutable factory;

    error OnlyFactory();

    constructor(address factory_) {
        factory = factory_;
    }

    function deploy(EquinoxPool.Deploy calldata d, address token, address vol) external returns (address) {
        if (msg.sender != factory) revert OnlyFactory();
        return address(new EquinoxPool(d, token, vol));
    }
}

/// @title EquinoxFactory — men-deploy vol engine + token ERC-1155, lalu pool lewat PoolDeployer, mengikat token, mencatat (§8.6).
/// @notice Demo memanggil createPool (Pool B, engine baru) lalu createPoolWithVol (Pool A memakai engine Pool B) — K4.
contract EquinoxFactory {
    PoolDeployer public immutable poolDeployer;
    address[] public pools;

    event PoolCreated(address indexed pool, address token, address vol, address indexed math, address usdg, address feed);

    constructor() {
        poolDeployer = new PoolDeployer(address(this));
    }

    function createPool(EquinoxPool.Deploy calldata d) external returns (address pool) {
        EquinoxVolEngine vol = new EquinoxVolEngine(d.owner, d.feed, d.math, d.vol, d.sigmaSeed);
        EquinoxOptionToken token = new EquinoxOptionToken();
        pool = poolDeployer.deploy(d, address(token), address(vol));
        token.bindPool(pool);
        pools.push(pool);
        emit PoolCreated(pool, address(token), address(vol), d.math, d.usdg, d.feed);
    }

    error VolFeedMismatch();

    /// @notice Seperti `createPool`, tetapi memakai `EquinoxVolEngine` yang sudah ada (K4: dua pool berbagi σ yang identik
    ///         by construction — pada feed hidup dua engine terpisah menyimpang karena histori observasinya berbeda).
    ///         `d.vol` dan `d.sigmaSeed` diabaikan; `d.feed` harus sama dengan `vol.feed()`.
    function createPoolWithVol(EquinoxPool.Deploy calldata d, address vol) external returns (address pool) {
        if (address(EquinoxVolEngine(vol).feed()) != d.feed) revert VolFeedMismatch();
        EquinoxOptionToken token = new EquinoxOptionToken();
        pool = poolDeployer.deploy(d, address(token), vol);
        token.bindPool(pool);
        pools.push(pool);
        emit PoolCreated(pool, address(token), vol, d.math, d.usdg, d.feed);
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }
}
