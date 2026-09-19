//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;
pub mod exp;
pub mod ln;
pub mod normal;
pub mod bs;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
pub use bs::{quote, price, capped_call, Quote, CappedQuote};
