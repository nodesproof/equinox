//! EWMA realized variance dengan Δt tak beraturan (§6.4, FR-7).
use crate::error::MathError;
use crate::exp::exp_wad;
use crate::fixed::{div_wad, i, mul_wad, WAD};
use crate::ln::ln_wad;
use alloy_primitives::I256;

pub const SECONDS_PER_DAY: i128 = 86_400;
pub const SECONDS_PER_YEAR: i128 = 31_536_000;

/// var_t = λ^(Δt_hari)·var_prev + (1 − λ^(Δt_hari))·r²/Δt_tahun, r = ln(p_now/p_prev).
/// Semua WAD kecuali dt_seconds (integer detik). lambda_per_day ∈ (0, 1).
pub fn ewma_update(var_prev: I256, p_prev: I256, p_now: I256, dt_seconds: I256, lambda_per_day: I256)
    -> Result<I256, MathError>
{
    if var_prev.is_negative() { return Err(MathError::OutOfDomain(0)); }
    if p_prev <= I256::ZERO { return Err(MathError::OutOfDomain(1)); }
    if p_now <= I256::ZERO { return Err(MathError::OutOfDomain(2)); }
    if dt_seconds <= I256::ZERO { return Err(MathError::OutOfDomain(3)); }
    if lambda_per_day <= I256::ZERO || lambda_per_day >= WAD { return Err(MathError::OutOfDomain(4)); }
    let dt_days = dt_seconds * WAD / i(SECONDS_PER_DAY);
    let w = exp_wad(mul_wad(dt_days, ln_wad(lambda_per_day)?)?)?;
    let r = ln_wad(div_wad(p_now, p_prev)?)?;
    let dt_years = dt_seconds * WAD / i(SECONDS_PER_YEAR);
    let inst = div_wad(mul_wad(r, r)?, dt_years)?;
    Ok(mul_wad(w, var_prev)? + mul_wad(WAD - w, inst)?)
}
