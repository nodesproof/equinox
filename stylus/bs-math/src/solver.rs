//! Implied-vol solver: Newton dengan bracket + fallback bisection (§6.5, FR-6).
use crate::bs::quote;
use crate::constants::TWO_PI;
use crate::error::MathError;
use crate::fixed::{div_wad, i, mul_wad, sqrt_wad_i};
use alloy_primitives::I256;

pub const MAX_ITER: u8 = 40;
/// Vega minimum (WAD) agar langkah Newton dipakai.
const VEGA_MIN: i128 = 1_000_000_000; // 1e-9

/// Mengembalikan (sigma, iterasi). `lo`/`hi` bracket awal (WAD), mis. 1% dan 500%.
/// Toleransi: |ΔP| ≤ max(target/1e8, s/1e14) — relatif untuk harga mikro, absolut untuk harga besar.
pub fn implied_vol(
    target: I256, s: I256, k: I256, t: I256, r: I256, is_call: bool, lo: I256, hi: I256,
) -> Result<(I256, u8), MathError> {
    if target <= I256::ZERO || lo <= I256::ZERO || hi <= lo { return Err(MathError::OutOfDomain(0)); }
    let tol = core::cmp::max(target / i(100_000_000), s / i(100_000_000_000_000));
    // seed Brenner–Subrahmanyam: √(2π/T) · price/S
    let seed = mul_wad(sqrt_wad_i(div_wad(i(TWO_PI), t)?)?, div_wad(target, s)?)?;
    let mut sigma = seed.clamp(lo, hi);
    let (mut lo, mut hi) = (lo, hi);
    for it in 1..=MAX_ITER {
        let q = quote(s, k, t, sigma, r, is_call)?;
        let diff = q.price - target;
        if diff.abs() <= tol { return Ok((sigma, it)); }
        if diff > I256::ZERO { hi = sigma } else { lo = sigma }
        if q.vega > i(VEGA_MIN) {
            let cand = sigma - div_wad(diff, q.vega)?;
            if cand > lo && cand < hi { sigma = cand; continue; }
        }
        sigma = (lo + hi) / i(2);
    }
    Err(MathError::NoConvergence(MAX_ITER))
}
