//! Task 7: harga, Greeks, capped call — bit-eksak, toleransi float, INV-6..8, FR-9.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::{capped_call, price, quote, I256, MathError};
use common::f;
use common::vectors_gen::{CAPPED, FLOAT_PRICE, QUOTE};

#[test]
fn quote_bit_exact() {
    for &(s, k, t, sg, r, c, p, d, g, v, th) in QUOTE {
        let q = quote(i(s), i(k), i(t), i(sg), i(r), c).unwrap();
        assert_eq!(q.price, i(p), "price k={k} sg={sg} t={t} r={r} c={c}");
        assert_eq!(q.delta, i(d), "delta");
        assert_eq!(q.gamma, i(g), "gamma");
        assert_eq!(q.vega, i(v), "vega");
        assert_eq!(q.theta, i(th), "theta");
    }
}
#[test]
fn price_vs_float_reference() {
    // ≤ 1e-9 relatif bila harga ≥ 1e-6·S; selain itu ≤ 1e-12·S absolut (granularitas WAD)
    for &(s, k, t, sg, r, c, ref_price) in FLOAT_PRICE {
        let got = f(price(i(s), i(k), i(t), i(sg), i(r), c).unwrap());
        let sf = f(i(s));
        if ref_price >= 1e-6 * sf {
            assert!(((got - ref_price) / ref_price).abs() <= 1e-9, "k={k} sg={sg} t={t}: {got} vs {ref_price}");
        } else {
            assert!((got - ref_price).abs() <= 1e-12 * sf, "k={k} sg={sg} t={t}: {got} vs {ref_price}");
        }
    }
}
#[test]
fn bounds_parity_monotone() {
    let s = i(4000) * WAD; let k = i(4200) * WAD; let t = i(7) * WAD / i(365); let r = I256::ZERO;
    let sg = i(6) * WAD / i(10);
    let c = price(s, k, t, sg, r, true).unwrap();
    let p = price(s, k, t, sg, r, false).unwrap();
    assert!(c >= I256::ZERO && c <= s);                                    // INV-6
    assert!(p >= I256::ZERO && p <= k);
    assert!(((c - p) - (s - k)).abs() <= s / i(1_000_000_000), "parity");  // INV-7
    assert!(price(s, k, t, i(7) * WAD / i(10), r, true).unwrap() > c);     // INV-8: σ ↑
    assert!(price(s, k, i(30) * WAD / i(365), sg, r, true).unwrap() > c);  // T ↑
    assert!(price(s, i(4300) * WAD, t, sg, r, true).unwrap() < c);         // K ↑ → call ↓
}
#[test]
fn domain_errors() {
    let s = i(4000) * WAD; let k = i(4200) * WAD; let t = i(7) * WAD / i(365); let sg = i(6) * WAD / i(10);
    assert_eq!(quote(I256::ZERO, k, t, sg, I256::ZERO, true).unwrap_err(), MathError::OutOfDomain(0));
    assert_eq!(quote(s, k, i(1), sg, I256::ZERO, true).unwrap_err(), MathError::OutOfDomain(2));
    assert_eq!(quote(s, k, t, i(6) * WAD, I256::ZERO, true).unwrap_err(), MathError::OutOfDomain(3));
    assert_eq!(quote(s, k, t, sg, i(2) * WAD, true).unwrap_err(), MathError::OutOfDomain(4));
}
#[test]
fn capped_bit_exact_and_domain() {
    for &(s, k, cap, t, sg, r, p, d, v) in CAPPED {
        let c = capped_call(i(s), i(k), i(cap), i(t), i(sg), i(r)).unwrap();
        assert_eq!(c.price, i(p)); assert_eq!(c.delta, i(d)); assert_eq!(c.vega, i(v));
    }
    let s = i(4000) * WAD;
    assert_eq!(capped_call(s, s, s, WAD, WAD, I256::ZERO).unwrap_err(), MathError::OutOfDomain(2));
}
