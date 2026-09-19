//! bs-stylus — program Stylus stateless yang membungkus `bs-math` dengan ABI Solidity (§8.1).
//! Semua fungsi `view` (&self); tidak ada storage, tidak ada panggilan keluar, tidak ada float.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
#![cfg_attr(not(any(test, feature = "export-abi")), no_std)]
extern crate alloc;

use alloc::vec;
use alloc::vec::Vec;
use bs_math::fixed::{to_i};
use bs_math::MathError;
use stylus_sdk::{
    alloy_primitives::{I256, U256},
    alloy_sol_types::sol,
    prelude::*,
};

sol! {
    /// Argumen ke-`arg` (0-based) di luar domain §6.6.
    error OutOfDomain(uint8 arg);
    /// Solver tidak konvergen dalam `iters` iterasi.
    error NoConvergence(uint8 iters);
    /// Panjang array tidak sama.
    error LengthMismatch();
    /// Overflow aritmetika 256-bit.
    error Overflow();
}

#[derive(SolidityError)]
pub enum BsError {
    OutOfDomain(OutOfDomain),
    NoConvergence(NoConvergence),
    LengthMismatch(LengthMismatch),
    Overflow(Overflow),
}

impl From<MathError> for BsError {
    fn from(e: MathError) -> Self {
        match e {
            MathError::OutOfDomain(a) => BsError::OutOfDomain(OutOfDomain { arg: a }),
            MathError::NoConvergence(n) => BsError::NoConvergence(NoConvergence { iters: n }),
            MathError::LengthMismatch => BsError::LengthMismatch(LengthMismatch {}),
            MathError::Overflow => BsError::Overflow(Overflow {}),
        }
    }
}

/// U256 (ABI) → I256; ≥ 2^255 dianggap overflow.
#[inline]
fn si(x: U256) -> Result<I256, BsError> {
    I256::try_from(x).map_err(|_| BsError::Overflow(Overflow {}))
}
/// I256 non-negatif → U256 (ABI). Negatif = bug internal → Overflow.
#[inline]
fn ui(x: I256) -> Result<U256, BsError> {
    if x.is_negative() { return Err(BsError::Overflow(Overflow {})); }
    Ok(x.into_raw())
}

sol_storage! {
    #[entrypoint]
    pub struct BlackScholes {}
}

#[public]
impl BlackScholes {
    /// e^x, x WAD (boleh negatif).
    pub fn exp(&self, x: I256) -> Result<U256, BsError> { ui(bs_math::exp::exp_wad(x)?) }
    /// ln(x), x WAD > 0.
    pub fn ln(&self, x: U256) -> Result<I256, BsError> { Ok(bs_math::ln::ln_wad(si(x)?)?) }
    /// sqrt(x), x WAD.
    pub fn sqrt(&self, x: U256) -> Result<U256, BsError> { Ok(bs_math::fixed::sqrt_wad(x)?) }
    /// Φ(x), x WAD → [0, 1e18].
    pub fn norm_cdf(&self, x: I256) -> Result<U256, BsError> { ui(bs_math::normal::norm_cdf(x)?) }
    /// φ(x), x WAD.
    pub fn norm_pdf(&self, x: I256) -> Result<U256, BsError> { ui(bs_math::normal::norm_pdf(x)?) }

    /// Harga opsi Eropa (WAD).
    pub fn price(&self, s: U256, k: U256, t: U256, sigma: U256, r: I256, is_call: bool) -> Result<U256, BsError> {
        ui(bs_math::price(si(s)?, si(k)?, si(t)?, si(sigma)?, r, is_call)?)
    }
    /// (price, delta, gamma, vega, theta) — WAD; vega per 1,00 vol; theta per tahun.
    pub fn quote(&self, s: U256, k: U256, t: U256, sigma: U256, r: I256, is_call: bool)
        -> Result<(U256, I256, U256, U256, I256), BsError>
    {
        let q = bs_math::quote(si(s)?, si(k)?, si(t)?, si(sigma)?, r, is_call)?;
        Ok((ui(q.price)?, q.delta, ui(q.gamma)?, ui(q.vega)?, q.theta))
    }
    /// (price, delta, vega) untuk C(k) − C(cap). vega bisa negatif (deep-ITM).
    pub fn capped_call(&self, s: U256, k: U256, cap: U256, t: U256, sigma: U256, r: I256)
        -> Result<(U256, I256, I256), BsError>
    {
        let c = bs_math::capped_call(si(s)?, si(k)?, si(cap)?, si(t)?, si(sigma)?, r)?;
        Ok((ui(c.price)?, c.delta, c.vega))
    }
    /// (sigma, iterasi). lo/hi bracket WAD.
    pub fn implied_vol(&self, target: U256, s: U256, k: U256, t: U256, r: I256, is_call: bool, lo: U256, hi: U256)
        -> Result<(U256, u8), BsError>
    {
        let (sg, it) = bs_math::implied_vol(si(target)?, si(s)?, si(k)?, si(t)?, r, is_call, si(lo)?, si(hi)?)?;
        Ok((ui(sg)?, it))
    }
    /// var_new (WAD) — lihat §6.4.
    pub fn ewma_update(&self, var_prev: U256, p_prev: U256, p_now: U256, dt_seconds: U256, lambda_per_day: U256)
        -> Result<U256, BsError>
    {
        ui(bs_math::ewma_update(si(var_prev)?, si(p_prev)?, si(p_now)?, si(dt_seconds)?, si(lambda_per_day)?)?)
    }
    /// (Σ oi·mid, Σ oi·vega) untuk ≤ 32 seri; cap_mult WAD untuk call.
    pub fn mark_portfolio(&self, s: U256, r: I256, sigma: U256, cap_mult: U256,
                          k: Vec<U256>, t: Vec<U256>, is_call: Vec<bool>, oi: Vec<U256>)
        -> Result<(U256, I256), BsError>
    {
        let conv = |v: &Vec<U256>| -> Result<Vec<I256>, BsError> { v.iter().map(|x| si(*x)).collect() };
        let (k, t, oi) = (conv(&k)?, conv(&t)?, conv(&oi)?);
        let (mid, vega) = bs_math::mark_portfolio(si(s)?, r, si(sigma)?, si(cap_mult)?, &k, &t, &is_call, &oi)?;
        Ok((ui(mid)?, vega))
    }
}

// `to_i` dipakai crate lain; simpan re-export kecil agar tidak ada warning unused.
#[allow(dead_code)]
fn _keep(x: U256) -> Result<I256, MathError> { to_i(x) }
