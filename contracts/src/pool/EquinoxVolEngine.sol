// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";
import { IBlackScholes } from "../interfaces/IBlackScholes.sol";

/// @title EquinoxVolEngine — σ_base dari EWMA realized vol on-chain, σ_mark dari VRP × dampak inventaris (§6.4, §8.5).
/// @notice Tidak ada `setSigma`: σ_base hanya berubah lewat observasi harga (FR-11). Parameter dibatasi keras & rate-limited (FR-15).
contract EquinoxVolEngine is Ownable2Step {
    struct Params {
        uint64 lambdaPerDay; // WAD, ∈ [0.80, 0.99]
        uint64 vrp;          // WAD, ∈ [1.0, 2.0]
        uint64 alpha;        // WAD, ∈ [0, 1.0]
        uint64 spread;       // WAD, ∈ [0.5%, 20%]
        uint64 sigmaMin;     // WAD, ≥ 5%
        uint64 sigmaMax;     // WAD, ≤ 500%
    }

    uint256 private constant WAD = 1e18;
    uint64 public constant MIN_OBS_INTERVAL = 60;          // detik (FR-12)
    uint64 public constant PARAMS_MIN_INTERVAL = 6 hours;   // rate limit setParams
    uint256 public constant MAX_PARAM_DELTA_BPS = 2000;     // |Δ| ≤ 20% per update (relatif)
    uint64 public constant MAX_ALPHA_DELTA = 0.2e18;        // alpha: absolut (boleh mulai dari 0)

    IAggregatorV3 public immutable feed;
    IBlackScholes public immutable math;
    uint256 public immutable priceScale; // 10^(18 − feed.decimals())

    uint256 public varWad;      // varians tahunan (WAD)
    uint256 public lastPrice;   // WAD
    uint80 public lastRoundId;
    uint64 public lastTs;
    Params public params;
    uint64 public lastParamsUpdate;

    event Observed(uint80 indexed roundId, uint256 priceWad, uint256 dtSeconds, uint256 varWad, uint256 sigmaBase);
    event ParamsUpdated(Params params);

    error BadFeed();
    error ParamOutOfBounds(uint8 which);
    error ParamDeltaTooLarge(uint8 which);
    error ParamsRateLimited();

    constructor(address owner_, address feed_, address math_, Params memory p, uint256 sigmaSeed) Ownable(owner_) {
        feed = IAggregatorV3(feed_);
        math = IBlackScholes(math_);
        priceScale = 10 ** (18 - IAggregatorV3(feed_).decimals());
        _checkBounds(p);
        params = p;
        lastParamsUpdate = uint64(block.timestamp);
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert BadFeed();
        lastPrice = uint256(answer) * priceScale;
        lastRoundId = roundId;
        lastTs = uint64(updatedAt);
        varWad = sigmaSeed * sigmaSeed / WAD; // seed σ → varians; satu-satunya input σ manusia, meluruh dengan λ
        emit ParamsUpdated(p);
    }

    /// @notice Permissionless. Mengabaikan round lama dan Δt < MIN_OBS_INTERVAL (FR-12).
    function poke() external returns (uint256) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (roundId <= lastRoundId || answer <= 0 || updatedAt <= lastTs) return sigmaBase();
        uint256 dt = updatedAt - lastTs;
        if (dt < MIN_OBS_INTERVAL) return sigmaBase();
        uint256 p = uint256(answer) * priceScale;
        uint256 v = math.ewmaUpdate(varWad, lastPrice, p, dt, params.lambdaPerDay);
        varWad = v;
        lastPrice = p;
        lastRoundId = roundId;
        lastTs = uint64(updatedAt);
        uint256 sb = sigmaBase();
        emit Observed(roundId, p, dt, v, sb);
        return sb;
    }

    /// @notice σ_base = clamp(√var, σ_min, σ_max).
    function sigmaBase() public view returns (uint256) {
        return _clamp(math.sqrt(varWad));
    }

    /// @notice σ_mark = clamp(σ_base × VRP × (1 + α·util)), util WAD ∈ [0, 1] (FR-13).
    function sigmaMark(uint256 utilWad) external view returns (uint256) {
        if (utilWad > WAD) utilWad = WAD;
        Params memory p = params;
        uint256 s = math.sqrt(varWad);
        s = s * p.vrp / WAD;
        s = s * (WAD + uint256(p.alpha) * utilWad / WAD) / WAD;
        return _clamp(s);
    }

    function spread() external view returns (uint256) {
        return params.spread;
    }

    /// @notice Batas keras + rate limit: ≥ 6 jam antar update, |Δ| ≤ 20% relatif (alpha: ≤ 0,2 absolut).
    function setParams(Params calldata p) external onlyOwner {
        if (block.timestamp - lastParamsUpdate < PARAMS_MIN_INTERVAL) revert ParamsRateLimited();
        _checkBounds(p);
        Params memory o = params;
        if (!_withinRel(o.lambdaPerDay, p.lambdaPerDay)) revert ParamDeltaTooLarge(0);
        if (!_withinRel(o.vrp, p.vrp)) revert ParamDeltaTooLarge(1);
        uint256 da = p.alpha > o.alpha ? p.alpha - o.alpha : o.alpha - p.alpha;
        if (da > MAX_ALPHA_DELTA) revert ParamDeltaTooLarge(2);
        if (!_withinRel(o.spread, p.spread)) revert ParamDeltaTooLarge(3);
        if (!_withinRel(o.sigmaMin, p.sigmaMin)) revert ParamDeltaTooLarge(4);
        if (!_withinRel(o.sigmaMax, p.sigmaMax)) revert ParamDeltaTooLarge(5);
        params = p;
        lastParamsUpdate = uint64(block.timestamp);
        emit ParamsUpdated(p);
    }

    function _checkBounds(Params memory p) internal pure {
        if (p.lambdaPerDay < 0.80e18 || p.lambdaPerDay > 0.99e18) revert ParamOutOfBounds(0);
        if (p.vrp < 1e18 || p.vrp > 2e18) revert ParamOutOfBounds(1);
        if (p.alpha > 1e18) revert ParamOutOfBounds(2);
        if (p.spread < 0.005e18 || p.spread > 0.2e18) revert ParamOutOfBounds(3);
        if (p.sigmaMin < 0.05e18) revert ParamOutOfBounds(4);
        if (p.sigmaMax > 5e18 || p.sigmaMax <= p.sigmaMin) revert ParamOutOfBounds(5);
    }

    function _withinRel(uint256 oldV, uint256 newV) internal pure returns (bool) {
        uint256 lo = oldV * (10_000 - MAX_PARAM_DELTA_BPS) / 10_000;
        uint256 hi = oldV * (10_000 + MAX_PARAM_DELTA_BPS) / 10_000;
        return newV >= lo && newV <= hi;
    }

    function _clamp(uint256 s) internal view returns (uint256) {
        Params memory p = params;
        if (s < p.sigmaMin) return p.sigmaMin;
        if (s > p.sigmaMax) return p.sigmaMax;
        return s;
    }
}
