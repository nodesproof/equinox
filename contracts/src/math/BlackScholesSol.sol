// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { sd, exp as prbExp, ln as prbLn } from "@prb/math/src/SD59x18.sol";
import { UD60x18, ud, sqrt as prbSqrt } from "@prb/math/src/UD60x18.sol";
import { IBlackScholes } from "../interfaces/IBlackScholes.sol";
import { BsConstants as K_ } from "./BsConstants.sol";

/// @title BlackScholesSol — implementasi KONTROL (Solidity) dari bs-math.
/// @notice Algoritma dan urutan operasi identik dengan crate Rust `bs-math` agar hasil bit-identik
///         (INV-12) dan perbandingan gas apples-to-apples (§13). exp/ln/sqrt memakai PRBMath v4,
///         yang di-port ke Rust. Tidak untuk produksi — hanya benchmark, test L3, dan Rencana B3.
contract BlackScholesSol is IBlackScholes {
    int256 private constant WAD = 1e18;
    uint8 private constant MAX_ITER = 40;

    // ---------- primitif WAD (trunc toward zero, sama dengan I256 Rust) ----------
    function _mul(int256 a, int256 b) internal pure returns (int256) { return (a * b) / WAD; }
    function _div(int256 a, int256 b) internal pure returns (int256) {
        if (b == 0) revert OutOfDomain(1);
        return (a * WAD) / b;
    }
    function _abs(int256 a) internal pure returns (int256) { return a < 0 ? -a : a; }
    function _si(uint256 x) internal pure returns (int256) {
        if (x > uint256(type(int256).max)) revert Overflow();
        return int256(x);
    }
    function _ui(int256 x) internal pure returns (uint256) {
        if (x < 0) revert Overflow();
        return uint256(x);
    }

    // ---------- exp / ln / sqrt (PRBMath v4) ----------
    function _exp(int256 x) internal pure returns (int256) {
        if (x > K_.EXP_MAX_INPUT) revert OutOfDomain(0);
        if (x < K_.EXP_MIN_THRESHOLD) return 0;
        return prbExp(sd(x)).unwrap();
    }
    function _ln(int256 x) internal pure returns (int256) {
        if (x <= 0) revert OutOfDomain(0);
        return prbLn(sd(x)).unwrap();
    }
    function _sqrt(uint256 x) internal pure returns (uint256) {
        return prbSqrt(ud(x)).unwrap();
    }
    function _sqrtI(int256 x) internal pure returns (int256) {
        if (x < 0) revert OutOfDomain(0);
        return _si(_sqrt(uint256(x)));
    }

    function exp(int256 x) external pure returns (uint256) { return _ui(_exp(x)); }
    function ln(uint256 x) external pure returns (int256) { return _ln(_si(x)); }
    function sqrt(uint256 x) external pure returns (uint256) { return _sqrt(x); }

    // ---------- Φ, φ (Cody / calerf) ----------
    function _erfc(int256 x) internal pure returns (int256) {
        int256 y = _abs(x);
        int256 r;
        if (y <= K_.CODY_THRESH) {
            int256 ysq = y > 111000 ? _mul(y, y) : int256(0);
            int256 xnum = _mul(K_.A4, ysq);
            int256 xden = ysq;
            xnum = _mul(xnum + K_.A0, ysq); xden = _mul(xden + K_.B0, ysq);
            xnum = _mul(xnum + K_.A1, ysq); xden = _mul(xden + K_.B1, ysq);
            xnum = _mul(xnum + K_.A2, ysq); xden = _mul(xden + K_.B2, ysq);
            int256 erf = _mul(x, _div(xnum + K_.A3, xden + K_.B3));
            return WAD - erf;
        } else if (y <= 4 * WAD) {
            int256 xnum = _mul(K_.C8, y);
            int256 xden = y;
            xnum = _mul(xnum + K_.C0, y); xden = _mul(xden + K_.D0, y);
            xnum = _mul(xnum + K_.C1, y); xden = _mul(xden + K_.D1, y);
            xnum = _mul(xnum + K_.C2, y); xden = _mul(xden + K_.D2, y);
            xnum = _mul(xnum + K_.C3, y); xden = _mul(xden + K_.D3, y);
            xnum = _mul(xnum + K_.C4, y); xden = _mul(xden + K_.D4, y);
            xnum = _mul(xnum + K_.C5, y); xden = _mul(xden + K_.D5, y);
            xnum = _mul(xnum + K_.C6, y); xden = _mul(xden + K_.D6, y);
            int256 q = _div(xnum + K_.C7, xden + K_.D7);
            r = _mul(_exp(-_mul(y, y)), q);
        } else {
            int256 ysq = _div(WAD, _mul(y, y));
            int256 xnum = _mul(K_.P5, ysq);
            int256 xden = ysq;
            xnum = _mul(xnum + K_.P0, ysq); xden = _mul(xden + K_.Q0, ysq);
            xnum = _mul(xnum + K_.P1, ysq); xden = _mul(xden + K_.Q1, ysq);
            xnum = _mul(xnum + K_.P2, ysq); xden = _mul(xden + K_.Q2, ysq);
            xnum = _mul(xnum + K_.P3, ysq); xden = _mul(xden + K_.Q3, ysq);
            int256 q = _mul(ysq, _div(xnum + K_.P4, xden + K_.Q4));
            q = _div(K_.SQRPI - q, y);
            r = _mul(_exp(-_mul(y, y)), q);
        }
        return x < 0 ? 2 * WAD - r : r;
    }
    function _normCdf(int256 x) internal pure returns (int256) {
        if (x < -8 * WAD) return 0;
        if (x > 8 * WAD) return WAD;
        return _erfc(_mul(-x, K_.INV_SQRT2)) / 2;
    }
    function _normPdf(int256 x) internal pure returns (int256) {
        return _mul(K_.INV_SQRT_2PI, _exp(-(_mul(x, x) / 2)));
    }
    function normCdf(int256 x) external pure returns (uint256) { return _ui(_normCdf(x)); }
    function normPdf(int256 x) external pure returns (uint256) { return _ui(_normPdf(x)); }

    // ---------- Black-Scholes ----------
    struct Q { int256 price; int256 delta; int256 gamma; int256 vega; int256 theta; }

    function _checkDomain(int256 s, int256 k, int256 t, int256 sigma, int256 r) internal pure {
        if (s < K_.S_MIN || s > K_.S_MAX) revert OutOfDomain(0);
        if (k < K_.S_MIN || k > K_.S_MAX) revert OutOfDomain(1);
        if (t < K_.T_MIN || t > K_.T_MAX) revert OutOfDomain(2);
        if (sigma < K_.SIGMA_MIN || sigma > K_.SIGMA_MAX) revert OutOfDomain(3);
        if (r < -K_.R_ABS_MAX || r > K_.R_ABS_MAX) revert OutOfDomain(4);
    }

    function _quote(int256 s, int256 k, int256 t, int256 sigma, int256 r, bool isCall) internal pure returns (Q memory q) {
        _checkDomain(s, k, t, sigma, r);
        int256 sqrtT = _sqrtI(t);
        int256 sq = _mul(sigma, sqrtT);
        int256 halfVar = _mul(sigma, sigma) / 2;
        int256 d1 = _div(_ln(_div(s, k)) + _mul(r + halfVar, t), sq);
        int256 d2 = d1 - sq;
        int256 disc = _exp(-_mul(r, t));
        int256 kd = _mul(k, disc);
        int256 nd1 = _normCdf(d1);
        int256 nd2 = _normCdf(d2);
        int256 thetaR;
        if (isCall) {
            q.price = _mul(s, nd1) - _mul(kd, nd2); q.delta = nd1; thetaR = nd2;
        } else {
            q.price = _mul(kd, WAD - nd2) - _mul(s, WAD - nd1); q.delta = nd1 - WAD; thetaR = -(WAD - nd2);
        }
        int256 pdf = _normPdf(d1);
        int256 sPdf = _mul(s, pdf);
        q.gamma = _div(pdf, _mul(s, sq));
        q.vega = _mul(sPdf, sqrtT);
        q.theta = -_div(_mul(sPdf, sigma), sqrtT * 2) - _mul(_mul(r, kd), thetaR);
        if (q.price < 0) q.price = 0;
    }

    function price(uint256 s, uint256 k, uint256 t, uint256 sigma, int256 r, bool isCall) external pure returns (uint256) {
        return _ui(_quote(_si(s), _si(k), _si(t), _si(sigma), r, isCall).price);
    }
    function quote(uint256 s, uint256 k, uint256 t, uint256 sigma, int256 r, bool isCall)
        external pure returns (uint256, int256, uint256, uint256, int256)
    {
        Q memory q = _quote(_si(s), _si(k), _si(t), _si(sigma), r, isCall);
        return (_ui(q.price), q.delta, _ui(q.gamma), _ui(q.vega), q.theta);
    }
    function _capped(int256 s, int256 k, int256 cap, int256 t, int256 sigma, int256 r)
        internal pure returns (int256 p, int256 d, int256 v)
    {
        if (cap <= k) revert OutOfDomain(2);
        Q memory a = _quote(s, k, t, sigma, r, true);
        Q memory b = _quote(s, cap, t, sigma, r, true);
        return (a.price - b.price, a.delta - b.delta, a.vega - b.vega);
    }
    function cappedCall(uint256 s, uint256 k, uint256 cap, uint256 t, uint256 sigma, int256 r)
        external pure returns (uint256, int256, int256)
    {
        (int256 p, int256 d, int256 v) = _capped(_si(s), _si(k), _si(cap), _si(t), _si(sigma), r);
        return (_ui(p), d, v);
    }

    // ---------- implied vol (Newton + bracket + bisection) ----------
    function impliedVol(uint256 target_, uint256 s_, uint256 k_, uint256 t_, int256 r, bool isCall, uint256 lo_, uint256 hi_)
        external pure returns (uint256, uint8)
    {
        int256 target = _si(target_); int256 s = _si(s_); int256 k = _si(k_); int256 t = _si(t_);
        int256 lo = _si(lo_); int256 hi = _si(hi_);
        if (target <= 0 || lo <= 0 || hi <= lo) revert OutOfDomain(0);
        int256 tolA = target / 1e8; int256 tolB = s / 1e14;
        int256 tol = tolA > tolB ? tolA : tolB;
        int256 sigma = _mul(_sqrtI(_div(K_.TWO_PI, t)), _div(target, s));
        if (sigma < lo) sigma = lo;
        if (sigma > hi) sigma = hi;
        for (uint8 it = 1; it <= MAX_ITER; it++) {
            Q memory q = _quote(s, k, t, sigma, r, isCall);
            int256 diff = q.price - target;
            if (_abs(diff) <= tol) return (_ui(sigma), it);
            if (diff > 0) hi = sigma; else lo = sigma;
            if (q.vega > 1e9) {
                int256 cand = sigma - _div(diff, q.vega);
                if (cand > lo && cand < hi) { sigma = cand; continue; }
            }
            sigma = (lo + hi) / 2;
        }
        revert NoConvergence(MAX_ITER);
    }

    // ---------- EWMA ----------
    function ewmaUpdate(uint256 varPrev_, uint256 pPrev_, uint256 pNow_, uint256 dt_, uint256 lambda_) external pure returns (uint256) {
        int256 varPrev = _si(varPrev_); int256 pPrev = _si(pPrev_); int256 pNow = _si(pNow_);
        int256 dt = _si(dt_); int256 lambda = _si(lambda_);
        if (pPrev <= 0) revert OutOfDomain(1);
        if (pNow <= 0) revert OutOfDomain(2);
        if (dt <= 0) revert OutOfDomain(3);
        if (lambda <= 0 || lambda >= WAD) revert OutOfDomain(4);
        if (dt > type(int256).max / WAD) revert Overflow();   // paritas dengan checked_mul Rust (selector Overflow, bukan Panic 0x11)
        int256 dtDays = dt * WAD / 86400;
        int256 w = _exp(_mul(dtDays, _ln(lambda)));
        int256 lr = _ln(_div(pNow, pPrev));
        int256 dtYears = dt * WAD / 31536000;
        int256 inst = _div(_mul(lr, lr), dtYears);
        return _ui(_mul(w, varPrev) + _mul(WAD - w, inst));
    }

    // ---------- batch mark-to-market ----------
    function markPortfolio(uint256 s_, int256 r, uint256 sigma_, uint256 capMult_,
        uint256[] memory k, uint256[] memory t, bool[] memory isCall, uint256[] memory oi)
        external pure returns (uint256, int256)
    {
        uint256 n = k.length;
        if (t.length != n || isCall.length != n || oi.length != n) revert LengthMismatch();
        if (n > 32) revert OutOfDomain(4);
        int256 s = _si(s_); int256 sigma = _si(sigma_); int256 capMult = _si(capMult_);
        int256 sumMid; int256 sumVega;
        for (uint256 i = 0; i < n; i++) {
            if (oi[i] == 0) continue;
            int256 oiI = _si(oi[i]);
            int256 mid; int256 vega;
            if (isCall[i]) {
                int256 kk = _si(k[i]);
                (mid, , vega) = _capped(s, kk, _mul(kk, capMult), _si(t[i]), sigma, r);
            } else {
                Q memory q = _quote(s, _si(k[i]), _si(t[i]), sigma, r, false);
                (mid, vega) = (q.price, q.vega);
            }
            sumMid += _mul(oiI, mid);
            sumVega += _mul(oiI, vega);
        }
        return (_ui(sumMid), sumVega);
    }
}
