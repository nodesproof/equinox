//! Black-Scholes: harga, Greeks, capped call. Semua nilai WAD; r WAD (boleh negatif); T dalam tahun WAD.
use crate::error::MathError;
use crate::exp::exp_wad;
use crate::fixed::{div_wad, i, mul_wad, sqrt_wad_i, WAD};
use crate::ln::ln_wad;
use crate::normal::{norm_cdf, norm_pdf};
use alloy_primitives::I256;

/// Batas domain (§6.6, FR-9). Semua WAD.
pub const S_MIN: i128 = 1_000_000_000_000;                     // 1e-6
pub const S_MAX: i128 = 1_000_000_000_000_000_000_000_000_000_000; // 1e12
pub const T_MIN: i128 = 1_902_587_519_025;                     // 60 s / 31 536 000 s
pub const T_MAX: i128 = 1_000_000_000_000_000_000;             // 1 tahun
pub const SIGMA_MIN: i128 = 10_000_000_000_000_000;            // 1%
pub const SIGMA_MAX: i128 = 5_000_000_000_000_000_000;         // 500%
pub const R_ABS_MAX: i128 = 1_000_000_000_000_000_000;         // |r| ≤ 100%

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quote {
    pub price: I256,
    pub delta: I256,
    pub gamma: I256,
    /// per 1,00 vol (bagi 100 untuk per poin)
    pub vega: I256,
    /// per tahun (bagi 365 untuk per hari)
    pub theta: I256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CappedQuote {
    pub price: I256,
    pub delta: I256,
    pub vega: I256,
}

/// Validasi domain; indeks argumen: 0=s 1=k 2=t 3=sigma 4=r.
pub fn check_domain(s: I256, k: I256, t: I256, sigma: I256, r: I256) -> Result<(), MathError> {
    if s < i(S_MIN) || s > i(S_MAX) { return Err(MathError::OutOfDomain(0)); }
    if k < i(S_MIN) || k > i(S_MAX) { return Err(MathError::OutOfDomain(1)); }
    if t < i(T_MIN) || t > i(T_MAX) { return Err(MathError::OutOfDomain(2)); }
    if sigma < i(SIGMA_MIN) || sigma > i(SIGMA_MAX) { return Err(MathError::OutOfDomain(3)); }
    if r < -i(R_ABS_MAX) || r > i(R_ABS_MAX) { return Err(MathError::OutOfDomain(4)); }
    Ok(())
}

/// Harga + lima Greeks dalam satu evaluasi (FR-4).
pub fn quote(s: I256, k: I256, t: I256, sigma: I256, r: I256, is_call: bool) -> Result<Quote, MathError> {
    check_domain(s, k, t, sigma, r)?;
    let sqrt_t = sqrt_wad_i(t)?;
    let sq = mul_wad(sigma, sqrt_t)?;                         // σ√T
    let half_var = mul_wad(sigma, sigma)? / i(2);
    let d1 = div_wad(ln_wad(div_wad(s, k)?)? + mul_wad(r + half_var, t)?, sq)?;
    let d2 = d1 - sq;
    let disc = exp_wad(-mul_wad(r, t)?)?;
    let kd = mul_wad(k, disc)?;
    let nd1 = norm_cdf(d1)?;
    let nd2 = norm_cdf(d2)?;
    let (price, delta, theta_r) = if is_call {
        (mul_wad(s, nd1)? - mul_wad(kd, nd2)?, nd1, nd2)
    } else {
        (mul_wad(kd, WAD - nd2)? - mul_wad(s, WAD - nd1)?, nd1 - WAD, -(WAD - nd2))
    };
    let pdf = norm_pdf(d1)?;
    let s_pdf = mul_wad(s, pdf)?;
    let gamma = div_wad(pdf, mul_wad(s, sq)?)?;
    let vega = mul_wad(s_pdf, sqrt_t)?;
    let theta = -div_wad(mul_wad(s_pdf, sigma)?, sqrt_t * i(2))? - mul_wad(mul_wad(r, kd)?, theta_r)?;
    let price = if price.is_negative() { I256::ZERO } else { price };
    Ok(Quote { price, delta, gamma, vega, theta })
}

/// Hanya harga.
pub fn price(s: I256, k: I256, t: I256, sigma: I256, r: I256, is_call: bool) -> Result<I256, MathError> {
    Ok(quote(s, k, t, sigma, r, is_call)?.price)
}

/// Call dengan payout cap: C(k) − C(cap); delta & vega gabungan (§6.3, FR-5). cap > k wajib.
pub fn capped_call(s: I256, k: I256, cap: I256, t: I256, sigma: I256, r: I256) -> Result<CappedQuote, MathError> {
    if cap <= k { return Err(MathError::OutOfDomain(2)); }
    let a = quote(s, k, t, sigma, r, true)?;
    let b = quote(s, cap, t, sigma, r, true)?;
    Ok(CappedQuote { price: a.price - b.price, delta: a.delta - b.delta, vega: a.vega - b.vega })
}
