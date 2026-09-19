//! Task 4: exp/exp2 — port bit-identik PRBMath.
mod common;
use bs_math::exp::{exp_wad, EXP_MAX_INPUT, EXP_MIN_THRESHOLD};
use bs_math::fixed::{i, WAD};
use bs_math::{I256, MathError};
use common::vectors_gen::EXP;

#[test]
fn exp_bit_exact() {
    for &(x, y) in EXP { assert_eq!(exp_wad(i(x)).unwrap(), i(y), "exp({x})"); }
}
#[test]
fn exp_domain() {
    assert!(exp_wad(i(EXP_MAX_INPUT)).is_ok());
    assert_eq!(exp_wad(i(EXP_MAX_INPUT + 1)), Err(MathError::OutOfDomain(0)));
    assert_eq!(exp_wad(i(EXP_MIN_THRESHOLD - 1)).unwrap(), I256::ZERO);
    assert_eq!(exp_wad(I256::ZERO).unwrap(), WAD);
}
