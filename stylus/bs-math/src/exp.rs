//! exp dan exp2 — port bit-identik PRBMath v4 `SD59x18.exp` / `exp2` / `Common.exp2`.
use crate::constants::EXP2_TABLE;
use crate::error::MathError;
use crate::fixed::{i, to_i, WAD, WAD2, WAD_U};
use alloy_primitives::{I256, U256};

pub const EXP_MAX_INPUT: i128 = 133_084258667509499440;      // 133.084…e18
pub const EXP_MIN_THRESHOLD: i128 = -41_446531673892822322;  // −41.446…e18 → hasil 0
pub const EXP2_MAX_INPUT: i128 = 192_000000000000000000 - 1;
pub const EXP2_MIN_THRESHOLD: i128 = -59_794705707972522261;
pub const LOG2_E: i128 = 1_442695040888963407;

/// 2^x untuk x dalam format 192.64 (Common.exp2). Hasil dalam WAD.
fn exp2_192x64(x: U256) -> Result<U256, MathError> {
    let mut result = U256::from(1u64) << 191usize; // 0.5 dalam 192.64
    for (j, c) in EXP2_TABLE.iter().enumerate() {
        if x.bit(63 - j) {
            result = result.checked_mul(U256::from(*c)).ok_or(MathError::Overflow)? >> 64usize;
        }
    }
    result = result.checked_mul(WAD_U).ok_or(MathError::Overflow)?;
    let n: usize = (x >> 64usize).to::<usize>();
    Ok(result >> (191 - n))
}

/// 2^x, x WAD (boleh negatif). Port `SD59x18.exp2`.
pub fn exp2_wad(x: I256) -> Result<I256, MathError> {
    if x.is_negative() {
        if x < i(EXP2_MIN_THRESHOLD) { return Ok(I256::ZERO); }
        let pos = exp2_wad(-x)?;
        return Ok(WAD2 / pos);
    }
    if x > i(EXP2_MAX_INPUT) { return Err(MathError::OutOfDomain(0)); }
    let x_192x64 = (x.into_raw() << 64usize) / WAD_U;
    to_i(exp2_192x64(x_192x64)?)
}

/// e^x, x WAD. Port `SD59x18.exp`: exp2(x·log2(e)).
pub fn exp_wad(x: I256) -> Result<I256, MathError> {
    if x > i(EXP_MAX_INPUT) { return Err(MathError::OutOfDomain(0)); }
    if x < i(EXP_MIN_THRESHOLD) { return Ok(I256::ZERO); }
    let dbl = x.checked_mul(i(LOG2_E)).ok_or(MathError::Overflow)?;
    exp2_wad(dbl / WAD)
}
