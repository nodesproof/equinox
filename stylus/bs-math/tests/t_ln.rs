//! Task 5: log2/ln — port bit-identik PRBMath.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::ln::ln_wad;
use bs_math::{I256, MathError};
use common::vectors_gen::LN;

#[test]
fn ln_bit_exact() {
    for &(x, y) in LN { assert_eq!(ln_wad(i(x)).unwrap(), i(y), "ln({x})"); }
}
#[test]
fn ln_domain_and_identity() {
    assert_eq!(ln_wad(I256::ZERO), Err(MathError::OutOfDomain(0)));
    assert_eq!(ln_wad(-WAD), Err(MathError::OutOfDomain(0)));
    assert_eq!(ln_wad(WAD).unwrap(), I256::ZERO);
}
