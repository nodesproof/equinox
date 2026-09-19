//! log2 dan ln — port bit-identik PRBMath v4 `SD59x18.log2` / `ln`.
use crate::error::MathError;
use crate::exp::LOG2_E;
use crate::fixed::{i, HALF_WAD_U, WAD, WAD2_U, WAD_U};
use alloy_primitives::{I256, U256};

#[inline]
fn msb(x: U256) -> usize { 255 - x.leading_zeros() }

/// log2(x), x WAD > 0.
pub fn log2_wad(x: I256) -> Result<I256, MathError> {
    if x <= I256::ZERO { return Err(MathError::OutOfDomain(0)); }
    let mut xu = x.into_raw();
    let neg = xu < WAD_U;
    if neg { xu = WAD2_U / xu; }
    let n = msb(xu / WAD_U);
    let mut result = U256::from(n as u64) * WAD_U;
    let mut y = xu >> n;
    if y != WAD_U {
        let two_wad = WAD_U << 1usize;
        let mut delta = HALF_WAD_U;
        while !delta.is_zero() {
            y = (y * y) / WAD_U;
            if y >= two_wad { result += delta; y >>= 1usize; }
            delta >>= 1usize;
        }
    }
    let r = I256::from_raw(result);
    Ok(if neg { -r } else { r })
}

/// ln(x) = log2(x)·1e18 / log2(e).
pub fn ln_wad(x: I256) -> Result<I256, MathError> {
    Ok(log2_wad(x)? * WAD / i(LOG2_E))
}
