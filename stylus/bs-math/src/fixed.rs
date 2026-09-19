//! Primitif WAD: konstanta, konversi, mul/div trunc-toward-zero (semantik PRBMath/Solidity), sqrt.
use crate::error::MathError;
use alloy_primitives::{I256, U256};

/// 1e18 sebagai U256.
pub const WAD_U: U256 = U256::from_limbs([1_000_000_000_000_000_000u64, 0, 0, 0]);
/// 1e36 sebagai U256 (limbs dihitung oleh gen_constants.py).
pub const WAD2_U: U256 = U256::from_limbs([12919594847110692864u64, 54210108624275221u64, 0, 0]);
/// 1e18 sebagai I256.
pub const WAD: I256 = I256::from_raw(WAD_U);
/// 1e36 sebagai I256.
pub const WAD2: I256 = I256::from_raw(WAD2_U);
/// 0.5e18.
pub const HALF_WAD_U: U256 = U256::from_limbs([500_000_000_000_000_000u64, 0, 0, 0]);

/// i128 → I256 (tidak pernah gagal untuk 128-bit).
#[inline]
pub fn i(x: i128) -> I256 {
    let mag = U256::from(x.unsigned_abs());
    let v = I256::from_raw(mag);
    if x < 0 { -v } else { v }
}
/// u128 → U256.
#[inline]
pub fn u(x: u128) -> U256 { U256::from(x) }
/// I256 non-negatif → U256 (panik jika negatif — hanya untuk nilai yang sudah divalidasi).
#[inline]
pub fn to_u(x: I256) -> U256 {
    debug_assert!(!x.is_negative());
    x.into_raw()
}
/// U256 → I256 (Overflow jika ≥ 2^255).
#[inline]
pub fn to_i(x: U256) -> Result<I256, MathError> {
    I256::try_from(x).map_err(|_| MathError::Overflow)
}

/// a·b / 1e18, trunc toward zero (identik dengan PRBMath `mul` dan Solidity `(a*b)/1e18`).
#[inline]
pub fn mul_wad(a: I256, b: I256) -> Result<I256, MathError> {
    let p = a.checked_mul(b).ok_or(MathError::Overflow)?;
    Ok(p / WAD)
}
/// a·1e18 / b, trunc toward zero.
#[inline]
pub fn div_wad(a: I256, b: I256) -> Result<I256, MathError> {
    if b.is_zero() { return Err(MathError::OutOfDomain(1)); }
    let p = a.checked_mul(WAD).ok_or(MathError::Overflow)?;
    Ok(p / b)
}

/// floor(sqrt(x)) untuk U256 — port PRBMath `Common.sqrt` (tebakan msb + 7 iterasi Babylonian).
pub fn sqrt_u(x: U256) -> U256 {
    if x.is_zero() { return U256::ZERO; }
    let one = U256::from(1u64);
    let mut xa = x;
    let mut result = one;
    if xa >= (one << 128) { xa >>= 128; result <<= 64; }
    if xa >= (one << 64)  { xa >>= 64;  result <<= 32; }
    if xa >= (one << 32)  { xa >>= 32;  result <<= 16; }
    if xa >= (one << 16)  { xa >>= 16;  result <<= 8; }
    if xa >= (one << 8)   { xa >>= 8;   result <<= 4; }
    if xa >= (one << 4)   { xa >>= 4;   result <<= 2; }
    if xa >= (one << 2)   { result <<= 1; }
    for _ in 0..7 { result = (result + x / result) >> 1; }
    let rounded = x / result;
    if result >= rounded { rounded } else { result }
}
/// sqrt dalam WAD: sqrt(x·1e18) — port PRBMath `UD60x18.sqrt`.
pub fn sqrt_wad(x: U256) -> Result<U256, MathError> {
    let y = x.checked_mul(WAD_U).ok_or(MathError::Overflow)?;
    Ok(sqrt_u(y))
}
/// sqrt untuk I256 non-negatif.
pub fn sqrt_wad_i(x: I256) -> Result<I256, MathError> {
    if x.is_negative() { return Err(MathError::OutOfDomain(0)); }
    to_i(sqrt_wad(to_u(x))?)
}
