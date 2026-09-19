# Benchmark gas — Stylus vs Solidity (bit-identik)

Lingkungan: `nitro-devnode` `offchainlabs/nitro-node:v3.11.4-7d5ac27` di-upgrade ke ArbOS 61 (Stylus v3), L1 fee = 0;
`cargo-stylus`/`stylus-sdk` 0.10.9, rustc 1.92, `opt-level = 3`, stack 16 KiB, 2 fragmen, tanpa cache;
kontrol `solc 0.8.28` via-IR (200 runs), PRBMath v4.1.0. Pengukuran: `gasleft()` di sekitar `STATICCALL` dari `Bench.sol`.
Kolom "cached" = terukur − (programInitGas uncached − cached), turunan (CacheManager devnode adalah stub).
Angka referensi di PRD §13 berasal dari build spike dengan WASM 34.346 byte (programInitGas 31.376/4.997); build repo ini 34.294 byte (30.938/4.623) — selisih sel ≤ 1,3% pada kolom terukur dan hingga 4,6% pada kolom turunan; kesimpulan tidak berubah.
Semua keluaran identik antara kedua implementasi (`tools/bench/onchain-check.sh`).

programInitGas: uncached=30938 cached=4623 (kolom cached = terukur − 26315, turunan)

| Operasi | Solidity (kontrol) | Stylus tanpa cache | Stylus cached (turunan) | Rasio cached |
|---|---|---|---|---|
| normCdf(-0.5456)                           |      5435 |     34642 |      8327 |   0.6× |
| exp(-1)                                    |      6144 |     35275 |      8960 |   0.7× |
| ln(2)                                      |      3559 |     33993 |      7678 |   0.5× |
| quote C4200 7d 60% (harga+4 Greeks)        |     24536 |     41152 |     14837 |   1.6× |
| cappedCall C4200 cap 8400                  |     40886 |     46530 |     20215 |   2.0× |
| impliedVol C4200 (5 iterasi)               |    121321 |     73504 |     47189 |   2.6× |
| impliedVol P2600 deep-OTM (20 iterasi)     |    616839 |    249688 |    223373 |   2.8× |
| ewmaUpdate                                 |     22082 |     40740 |     14425 |   1.5× |
| markPortfolio 32 seri (1 panggilan)        |   1242892 |    453763 |    427448 |   2.9× |

## Micro-benchmark biaya marjinal (gas per pasangan mul_wad + div_wad, loop 1.000 iterasi)

| Tipe | gas / pasangan |
|---|---|
| EVM Solidity (`MUL`/`DIV` 5 gas) | ≈ 30–40 |
| Stylus `I256` (ruint, limb 64-bit) | 105 |
| Stylus `i128` Q64.64 | 29 |
| Stylus `u64` | 0,5 |

Kesimpulan: rasio 2,6–2,9× pada lingkaran datang dari alur kontrol/loop/ABI yang murah di WASM; aritmetika 256-bit itu sendiri 3× lebih mahal daripada opcode EVM. Bukan 10×. Lihat PRD §13 dan §2.4.
