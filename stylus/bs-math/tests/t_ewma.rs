//! Task 9: EWMA — bit-eksak terhadap urutan §6.4, FR-7.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::{ewma_update, I256, MathError};
use common::vectors_gen::EWMA;

#[test]
fn ewma_bit_exact() {
    for &(vp, p0, p1, dt, lam, vn) in EWMA {
        assert_eq!(ewma_update(i(vp), i(p0), i(p1), i(dt), i(lam)).unwrap(), i(vn));
    }
}
#[test]
fn ewma_domain() {
    let v = WAD / i(4); let p = i(4000) * WAD;
    assert_eq!(ewma_update(v, I256::ZERO, p, i(60), WAD / i(2)).unwrap_err(), MathError::OutOfDomain(1));
    assert_eq!(ewma_update(v, p, p, I256::ZERO, WAD / i(2)).unwrap_err(), MathError::OutOfDomain(3));
    assert_eq!(ewma_update(v, p, p, i(60), WAD).unwrap_err(), MathError::OutOfDomain(4));
}
#[test]
fn ewma_dt_overflow_is_typed() {
    // dt·1e18 harus melampaui 2^255 (≈ 5,8e76): dt = 1e63 → 1e81. Tanpa checked_mul: panic (debug) / wrap (release).
    let v = WAD / i(4); let p = i(4000) * WAD; let lam = WAD / i(2);
    let dt = i(1_000_000_000_000_000_000) * i(1_000_000_000_000_000_000) * i(1_000_000_000_000_000_000) * i(1_000_000_000);
    assert_eq!(ewma_update(v, p, p, dt, lam), Err(MathError::Overflow));
}
