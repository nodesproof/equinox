//! Φ (CDF) dan φ (PDF) normal standar dalam WAD. erfc via aproksimasi rasional Cody (calerf).
use crate::constants::*;
use crate::error::MathError;
use crate::exp::exp_wad;
use crate::fixed::{div_wad, i, mul_wad, WAD};
use alloy_primitives::I256;

/// erfc(x), x WAD, hasil WAD ∈ [0, 2].
pub fn erfc_wad(x: I256) -> Result<I256, MathError> {
    let y = if x.is_negative() { -x } else { x };
    let four = i(4) * WAD;
    let r = if y <= i(CODY_THRESH) {
        let ysq = if y > i(111_000) { mul_wad(y, y)? } else { I256::ZERO }; // 1.11e-16 → 111000 wei
        let mut xnum = mul_wad(i(CODY_A[4]), ysq)?;
        let mut xden = ysq;
        for k in 0..3 {
            xnum = mul_wad(xnum + i(CODY_A[k]), ysq)?;
            xden = mul_wad(xden + i(CODY_B[k]), ysq)?;
        }
        let erf = mul_wad(x, div_wad(xnum + i(CODY_A[3]), xden + i(CODY_B[3]))?)?;
        return Ok(WAD - erf);
    } else if y <= four {
        let mut xnum = mul_wad(i(CODY_C[8]), y)?;
        let mut xden = y;
        for k in 0..7 {
            xnum = mul_wad(xnum + i(CODY_C[k]), y)?;
            xden = mul_wad(xden + i(CODY_D[k]), y)?;
        }
        let q = div_wad(xnum + i(CODY_C[7]), xden + i(CODY_D[7]))?;
        mul_wad(exp_wad(-mul_wad(y, y)?)?, q)?
    } else {
        let ysq = div_wad(WAD, mul_wad(y, y)?)?;
        let mut xnum = mul_wad(i(CODY_P[5]), ysq)?;
        let mut xden = ysq;
        for k in 0..4 {
            xnum = mul_wad(xnum + i(CODY_P[k]), ysq)?;
            xden = mul_wad(xden + i(CODY_Q[k]), ysq)?;
        }
        let q = mul_wad(ysq, div_wad(xnum + i(CODY_P[4]), xden + i(CODY_Q[4]))?)?;
        let q = div_wad(i(SQRPI) - q, y)?;
        mul_wad(exp_wad(-mul_wad(y, y)?)?, q)?
    };
    Ok(if x.is_negative() { i(2) * WAD - r } else { r })
}

/// Φ(x) = ½·erfc(−x/√2); |x| > 8 → 0/1 (tanpa revert).
pub fn norm_cdf(x: I256) -> Result<I256, MathError> {
    let eight = i(8) * WAD;
    if x < -eight { return Ok(I256::ZERO); }
    if x > eight { return Ok(WAD); }
    let arg = mul_wad(-x, i(INV_SQRT2))?;
    Ok(erfc_wad(arg)? / i(2))
}

/// φ(x) = exp(−x²/2)/√(2π).
pub fn norm_pdf(x: I256) -> Result<I256, MathError> {
    let e = exp_wad(-(mul_wad(x, x)? / i(2)))?;
    mul_wad(i(INV_SQRT_2PI), e)
}
