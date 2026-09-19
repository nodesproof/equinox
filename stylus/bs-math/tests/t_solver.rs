//! Task 8: implied vol — bit-eksak (σ dan jumlah iterasi), FR-6.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::{implied_vol, I256, MathError};
use common::vectors_gen::IV;

#[test]
fn implied_vol_bit_exact() {
    let lo = WAD / i(100); let hi = i(5) * WAD;
    for &(tgt, s, k, t, r, c, sg_exp, it_exp) in IV {
        let (sg, it) = implied_vol(i(tgt), i(s), i(k), i(t), i(r), c, lo, hi).unwrap();
        assert_eq!(sg, i(sg_exp), "sigma k={k}");
        assert_eq!(it, it_exp, "iter k={k}");
        assert!(it <= 40);
    }
}
#[test]
fn implied_vol_no_convergence_and_domain() {
    let lo = WAD / i(100); let hi = i(5) * WAD;
    let s = i(4000) * WAD;
    let e = implied_vol(s * i(2), s, s, WAD / i(52), I256::ZERO, true, lo, hi).unwrap_err();
    assert_eq!(e, MathError::NoConvergence(40));                          // target > S mustahil
    assert_eq!(implied_vol(I256::ZERO, s, s, WAD, I256::ZERO, true, lo, hi).unwrap_err(), MathError::OutOfDomain(0));
    assert_eq!(implied_vol(WAD, s, s, WAD, I256::ZERO, true, hi, lo).unwrap_err(), MathError::OutOfDomain(0));
}
