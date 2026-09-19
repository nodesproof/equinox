//! Batch mark-to-market: Σ OI·mid dan Σ OI·vega dalam satu panggilan (FR-8).
use crate::bs::{capped_call, quote};
use crate::error::MathError;
use crate::fixed::mul_wad;
use alloy_primitives::I256;

/// `cap_mult` WAD (mis. 2e18 → cap = 2K) untuk call; put tanpa cap.
/// Mengembalikan (Σ oi_i·mid_i, Σ oi_i·vega_i). Panjang k/t/is_call/oi harus sama, ≤ 32.
pub fn mark_portfolio(
    s: I256, r: I256, sigma: I256, cap_mult: I256,
    k: &[I256], t: &[I256], is_call: &[bool], oi: &[I256],
) -> Result<(I256, I256), MathError> {
    let n = k.len();
    if t.len() != n || is_call.len() != n || oi.len() != n { return Err(MathError::LengthMismatch); }
    if n > 32 { return Err(MathError::OutOfDomain(4)); }
    let mut sum_mid = I256::ZERO;
    let mut sum_vega = I256::ZERO;
    for idx in 0..n {
        if oi[idx].is_zero() { continue; }
        let (mid, vega) = if is_call[idx] {
            let cap = mul_wad(k[idx], cap_mult)?;
            let c = capped_call(s, k[idx], cap, t[idx], sigma, r)?;
            (c.price, c.vega)
        } else {
            let q = quote(s, k[idx], t[idx], sigma, r, false)?;
            (q.price, q.vega)
        };
        sum_mid = sum_mid + mul_wad(oi[idx], mid)?;
        sum_vega = sum_vega + mul_wad(oi[idx], vega)?;
    }
    Ok((sum_mid, sum_vega))
}
