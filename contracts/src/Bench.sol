// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Harness gas: mengukur biaya STATICCALL ke `target` (termasuk overhead panggilan & init program Stylus).
contract Bench {
    function bench(address target, bytes calldata data) external view returns (uint256 gasUsed, bytes memory ret) {
        uint256 g0 = gasleft();
        (bool ok, bytes memory r) = target.staticcall(data);
        gasUsed = g0 - gasleft();
        require(ok, "target reverted");
        ret = r;
    }
}
