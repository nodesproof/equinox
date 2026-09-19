//! Task 10: batch mark-to-market — Σ sama dengan jumlah kuotasi individual, FR-8.
use bs_math::fixed::{i, mul_wad, WAD};
use bs_math::{capped_call, mark_portfolio, quote, I256, MathError};

#[test]
fn portfolio_equals_sum_of_quotes() {
    let s = i(4000) * WAD; let r = I256::ZERO; let sg = i(6) * WAD / i(10); let t7 = i(7) * WAD / i(365);
    let k = [i(4200) * WAD, i(3800) * WAD, i(4000) * WAD];
    let t = [t7, t7, i(30) * WAD / i(365)];
    let is_call = [true, false, true];
    let oi = [i(10) * WAD, i(5) * WAD, I256::ZERO];                       // seri ke-3 OI 0 → dilewati
    let (mid, vega) = mark_portfolio(s, r, sg, i(2) * WAD, &k, &t, &is_call, &oi).unwrap();
    let a = capped_call(s, k[0], k[0] * i(2), t[0], sg, r).unwrap();
    let b = quote(s, k[1], t[1], sg, r, false).unwrap();
    assert_eq!(mid, mul_wad(oi[0], a.price).unwrap() + mul_wad(oi[1], b.price).unwrap());
    assert_eq!(vega, mul_wad(oi[0], a.vega).unwrap() + mul_wad(oi[1], b.vega).unwrap());
}
#[test]
fn portfolio_length_and_size_limits() {
    let s = i(4000) * WAD; let sg = i(6) * WAD / i(10); let t7 = i(7) * WAD / i(365);
    let k = [s, s]; let t = [t7, t7, t7]; let c = [true, false]; let oi = [WAD, WAD];
    assert_eq!(mark_portfolio(s, I256::ZERO, sg, i(2) * WAD, &k, &t, &c, &oi).unwrap_err(), MathError::LengthMismatch);
    let k33 = [s; 33]; let t33 = [t7; 33]; let c33 = [false; 33]; let oi33 = [WAD; 33];
    assert_eq!(mark_portfolio(s, I256::ZERO, sg, i(2) * WAD, &k33, &t33, &c33, &oi33).unwrap_err(), MathError::OutOfDomain(4));
}
