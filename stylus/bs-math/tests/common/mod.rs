//! Helper bersama untuk test integrasi (di-include lewat `mod common;`).
//! `vectors_gen.rs` dihasilkan oleh tools/reference/gen_vectors.py — jangan diedit manual.
#![allow(dead_code)]
pub mod vectors_gen;
use bs_math::I256;

/// I256 WAD → f64 (hanya untuk pembanding referensi float).
pub fn f(x: I256) -> f64 {
    let neg = x.is_negative();
    let mag: u128 = x.unsigned_abs().to::<u128>();
    let v = mag as f64 / 1e18;
    if neg { -v } else { v }
}
