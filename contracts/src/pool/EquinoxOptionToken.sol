// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import { ERC1155Supply } from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

/// @title EquinoxOptionToken — satu id ERC-1155 per seri (expiry, strike, call/put) (§8.3, FR-18).
/// @notice Hanya pool yang boleh mint/burn; `totalSupply(id)` == open interest seri (INV-4).
contract EquinoxOptionToken is ERC1155Supply {
    address public pool;                 // diikat sekali oleh deployer (factory) setelah pool ada
    address public immutable deployer;

    error OnlyPool();
    error OnlyDeployer();
    error AlreadyBound();

    constructor() ERC1155("") {
        deployer = msg.sender;
    }

    /// @notice Mengikat pool sekali; dipanggil factory tepat setelah pool di-deploy (chicken-egg alamat).
    function bindPool(address pool_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (pool != address(0)) revert AlreadyBound();
        pool = pool_;
    }

    modifier onlyPool() {
        if (msg.sender != pool || pool == address(0)) revert OnlyPool();
        _;
    }

    function seriesId(address pool_, uint64 expiry, uint128 strike, bool isCall) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(pool_, expiry, strike, isCall)));
    }

    function mint(address to, uint256 id, uint256 amount) external onlyPool {
        _mint(to, id, amount, "");
    }

    function burn(address from, uint256 id, uint256 amount) external onlyPool {
        _burn(from, id, amount);
    }
}
