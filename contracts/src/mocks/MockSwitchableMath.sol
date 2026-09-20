// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IBlackScholes } from "../interfaces/IBlackScholes.sol";

/// @notice Wraps a real `IBlackScholes` and can be switched "down" (every call reverts) — simulates a paused or
///         unreachable Stylus math program so the pool's FR-36 conservative-NAV / MathUnavailable paths (I-1) can
///         be exercised deterministically in tests.
contract MockSwitchableMath is IBlackScholes {
    IBlackScholes public immutable inner;
    bool public down;

    constructor(address inner_) {
        inner = IBlackScholes(inner_);
    }

    function setDown(bool down_) external {
        down = down_;
    }

    function exp(int256 x) external view returns (uint256) {
        if (down) revert("math down");
        return inner.exp(x);
    }

    function ln(uint256 x) external view returns (int256) {
        if (down) revert("math down");
        return inner.ln(x);
    }

    function sqrt(uint256 x) external view returns (uint256) {
        if (down) revert("math down");
        return inner.sqrt(x);
    }

    function normCdf(int256 x) external view returns (uint256) {
        if (down) revert("math down");
        return inner.normCdf(x);
    }

    function normPdf(int256 x) external view returns (uint256) {
        if (down) revert("math down");
        return inner.normPdf(x);
    }

    function price(uint256 s, uint256 k, uint256 t, uint256 sigma, int256 r, bool is_call) external view returns (uint256) {
        if (down) revert("math down");
        return inner.price(s, k, t, sigma, r, is_call);
    }

    function quote(uint256 s, uint256 k, uint256 t, uint256 sigma, int256 r, bool is_call)
        external
        view
        returns (uint256, int256, uint256, uint256, int256)
    {
        if (down) revert("math down");
        return inner.quote(s, k, t, sigma, r, is_call);
    }

    function cappedCall(uint256 s, uint256 k, uint256 cap, uint256 t, uint256 sigma, int256 r) external view returns (uint256, int256, int256) {
        if (down) revert("math down");
        return inner.cappedCall(s, k, cap, t, sigma, r);
    }

    function impliedVol(uint256 target, uint256 s, uint256 k, uint256 t, int256 r, bool is_call, uint256 lo, uint256 hi)
        external
        view
        returns (uint256, uint8)
    {
        if (down) revert("math down");
        return inner.impliedVol(target, s, k, t, r, is_call, lo, hi);
    }

    function ewmaUpdate(uint256 var_prev, uint256 p_prev, uint256 p_now, uint256 dt_seconds, uint256 lambda_per_day) external view returns (uint256) {
        if (down) revert("math down");
        return inner.ewmaUpdate(var_prev, p_prev, p_now, dt_seconds, lambda_per_day);
    }

    function markPortfolio(
        uint256 s,
        int256 r,
        uint256 sigma,
        uint256 cap_mult,
        uint256[] memory k,
        uint256[] memory t,
        bool[] memory is_call,
        uint256[] memory oi
    ) external view returns (uint256, int256) {
        if (down) revert("math down");
        return inner.markPortfolio(s, r, sigma, cap_mult, k, t, is_call, oi);
    }
}
