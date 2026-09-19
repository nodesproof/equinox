//! Task 6: Φ dan φ — Cody erfc; FR-3 dan INV-5.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::normal::{norm_cdf, norm_pdf};
use bs_math::I256;
use common::vectors_gen::{PDF, PHI};

#[test]
fn phi_bit_exact_monotone_bounded() {
    let mut prev = I256::ZERO;
    for &(x, y) in PHI {
        let got = norm_cdf(i(x)).unwrap();
        assert_eq!(got, i(y), "Phi({x})");
        assert!(got >= prev, "Phi monoton di {x}");
        assert!(got >= I256::ZERO && got <= WAD);
        prev = got;
    }
}
#[test]
fn phi_symmetry_and_tails() {
    assert_eq!(norm_cdf(I256::ZERO).unwrap(), WAD / i(2));
    for x in [1i128, 5, 10, 20, 30, 40, 50, 60, 70] {
        let x = i(x) * WAD / i(10);
        let s = norm_cdf(x).unwrap() + norm_cdf(-x).unwrap();
        assert!((s - WAD).abs() <= I256::ONE, "simetri di {x}");   // ± 1 wei
    }
    assert_eq!(norm_cdf(i(-9) * WAD).unwrap(), I256::ZERO);
    assert_eq!(norm_cdf(i(9) * WAD).unwrap(), WAD);
}
#[test]
fn pdf_bit_exact() {
    for &(x, y) in PDF { assert_eq!(norm_pdf(i(x)).unwrap(), i(y), "pdf({x})"); }
}
