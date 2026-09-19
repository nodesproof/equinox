# Benchmark gas — Stylus vs Solidity (bit-identik)

Lingkungan: `nitro-devnode` `offchainlabs/nitro-node:v3.11.4-7d5ac27` di-upgrade ke ArbOS 61 (Stylus v3), L1 fee = 0;
`cargo-stylus`/`stylus-sdk` 0.10.9, rustc 1.92, `opt-level = 3`, stack 16 KiB, 2 fragmen, tanpa cache;
kontrol `solc 0.8.28` via-IR (200 runs), PRBMath v4.1.0. Pengukuran: `gasleft()` di sekitar `STATICCALL` dari `Bench.sol`.
Kolom "cached" = terukur − (programInitGas uncached − cached), turunan (CacheManager devnode adalah stub).
Angka di PRD §13 berasal dari build spike (WASM 34.346 byte; programInitGas 31.333/4.961; tabel referensi di rencana Task 14 memakai 31.376/4.997). Build repo ini: lihat baris programInitGas di bawah — selisih sel ≤ ~2% pada kolom terukur dan hingga ~5% pada kolom turunan; kesimpulan tidak berubah.
Setiap operasi yang di-benchmark menghasilkan bytes return yang identik pada kedua implementasi (dibandingkan otomatis oleh tools/bench/bench.sh); 20 pemeriksaan bit-eksak tambahan terhadap emulasi Python ada di tools/bench/onchain-check.sh.

programInitGas: uncached=30919 cached=4623 (kolom cached = terukur − 26296, turunan)

| Operasi | Solidity (kontrol) | Stylus tanpa cache | Stylus cached (turunan) | Rasio cached |
|---|---|---|---|---|
| normCdf(-0.5456)                           |      5435 |     34623 |      8327 |   0.6× |
| exp(-1)                                    |      6144 |     35256 |      8960 |   0.7× |
| ln(2)                                      |      3559 |     33974 |      7678 |   0.5× |
| quote C4200 7d 60% (harga+4 Greeks)        |     24536 |     41133 |     14837 |   1.6× |
| cappedCall C4200 cap 8400                  |     40886 |     46511 |     20215 |   2.0× |
| impliedVol C4200 (5 iterasi)               |    121321 |     73485 |     47189 |   2.6× |
| impliedVol P2600 deep-OTM (20 iterasi)     |    616839 |    249669 |    223373 |   2.8× |
| ewmaUpdate                                 |     22104 |     40725 |     14429 |   1.5× |
| markPortfolio 32 seri (1 panggilan)        |   1242892 |    453744 |    427448 |   2.9× |

## Micro-benchmark biaya marjinal (gas per pasangan mul_wad + div_wad, loop 1.000 iterasi)

Program micro-benchmark (loop 1.000 iterasi) berasal dari spike 19 Sep 2026 dan tidak disertakan di repo; angkanya tidak dapat direproduksi dari tooling repo ini.

| Tipe | gas / pasangan |
|---|---|
| EVM Solidity (`MUL`/`DIV` 5 gas) | ≈ 30–40 |
| Stylus `I256` (ruint, limb 64-bit) | 105 |
| Stylus `i128` Q64.64 | 29 |
| Stylus `u64` | 0,5 |

Kesimpulan: rasio 2,6–2,9× pada lingkaran datang dari alur kontrol/loop/ABI yang murah di WASM; aritmetika 256-bit itu sendiri 3× lebih mahal daripada opcode EVM. Bukan 10×. Lihat PRD §13 dan §2.4.
