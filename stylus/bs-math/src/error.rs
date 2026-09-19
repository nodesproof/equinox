/// Error bertipe; wrapper Stylus memetakannya ke `SolidityError` (FR-9).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// Argumen ke-`n` (0-based) di luar domain §6.6.
    OutOfDomain(u8),
    /// Solver tidak konvergen dalam `n` iterasi.
    NoConvergence(u8),
    /// Panjang array tidak sama (mark_portfolio).
    LengthMismatch,
    /// Overflow aritmetika 256-bit.
    Overflow,
}
