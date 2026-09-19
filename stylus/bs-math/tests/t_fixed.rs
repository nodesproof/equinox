//! Task 3: primitif WAD — semantik trunc-toward-zero dan sqrt bit-eksak.
mod common;
use bs_math::fixed::{div_wad, i, mul_wad, sqrt_wad, u, WAD};
use bs_math::{I256, MathError};
use common::vectors_gen::SQRT;

#[test]
fn mul_div_truncate_toward_zero() {
    assert_eq!(mul_wad(i(2) * WAD, i(3) * WAD).unwrap(), i(6) * WAD);
    assert_eq!(mul_wad(-i(7), i(2)).unwrap(), I256::ZERO);            // −14 / 1e18 → 0 (bukan −1)
    assert_eq!(div_wad(-i(7) * WAD, i(2) * WAD).unwrap(), -i(35) * WAD / i(10));
    assert_eq!(div_wad(-i(1), i(3) * WAD).unwrap(), I256::ZERO);     // −0,33 → 0
    assert_eq!(div_wad(WAD, I256::ZERO), Err(MathError::OutOfDomain(1)));
}
#[test]
fn mul_overflow_is_error() {
    let big = i(i128::MAX) * i(i128::MAX);
    assert_eq!(mul_wad(big, big), Err(MathError::Overflow));
}
#[test]
fn sqrt_bit_exact() {
    for &(x, y) in SQRT { assert_eq!(sqrt_wad(u(x)).unwrap(), u(y), "sqrt({x})"); }
}
